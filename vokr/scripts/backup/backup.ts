/**
 * Scheduled database backup (plan §5 Phase 18, R17).
 *
 *   tsx scripts/backup/backup.ts --out <dir> [--upload] [--apply] [--prune] [--apply-prune] [--result <file>]
 *
 * 1. `pg_dump -Fc` of the whole database (auth schema included — a restore
 *    without `auth.users` loses every account) into `<out>/<stamp>/full.dump`,
 *    plus `checksums.txt` (SHA-256) and `manifest.json`. The connection is
 *    `BACKUP_DATABASE_URL` (parsed into the libpq environment of the child
 *    process) or, if that is unset, the standard libpq environment
 *    (`PGHOST`, `PGUSER`, `PGPASSFILE`/`PGPASSWORD`, `PGSSLMODE=require`…) —
 *    never an argument, never logged. Same flags as the manual
 *    pre-migration exports (`vokr-backups/*\/meta/dump.sh`).
 * 2. `--upload`: encrypts with `age` to `BACKUP_AGE_RECIPIENT` (a public key;
 *    the private key stays offline with the owner). **Refuses to upload
 *    unencrypted.** With `--apply` it puts `db/<stamp>/full.dump.age`,
 *    `checksums.txt` and `manifest.json` in the private bucket
 *    `R2_BACKUP_BUCKET`, reads each one back and compares its SHA-256, and
 *    only then writes `db/<stamp>/COMPLETE` (and reads that back too). A
 *    folder without `COMPLETE` is not a backup (`planRetention`), so an
 *    interrupted upload can never pass for a good one. The plaintext dump is
 *    deleted once the upload is verified.
 * 3. `--prune`: lists the bucket and prints what `planRetention` would
 *    delete (read-only; skipped without R2 credentials). Deleting needs
 *    `--apply-prune` as well, and only runs after this run's backup is
 *    complete and in the keep set.
 * 4. `--result <file>`: written only after `COMPLETE` is verified — the
 *    workflow's success heartbeat (`BACKUP_OK`) is based on it.
 *
 * Without `--apply`, step 2 prints what it would do and needs no R2
 * credentials. The local dump in step 1 is always made.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { backupFolder, BACKUP_PREFIX, COMPLETE_MARKER, planRetention } from "../lib/backup-retention";
import { pgEnvFromUrl } from "../lib/pg-url";
import { deleteKeys, getObjectBytes, hasR2Config, listKeys, putObject, r2Client, readR2Config } from "../lib/r2";

const has = (flag: string) => process.argv.includes(`--${flag}`);
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(command, args, { encoding: "utf8", env, maxBuffer: 16 * 1024 * 1024 });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function main(): Promise<void> {
  const out = arg("out");
  if (!out) throw new Error("--out <directory for the local dump> is required.");
  const apply = has("apply");
  const applyPrune = has("apply-prune");
  if (applyPrune && !(apply && has("upload") && has("prune"))) {
    throw new Error("--apply-prune needs --upload --apply --prune: retention only deletes after this run's backup is complete.");
  }
  const now = new Date();
  const folder = backupFolder(now); // db/<stamp>/
  const dir = path.join(out, folder.slice(BACKUP_PREFIX.length, -1));
  mkdirSync(dir, { recursive: true });

  const url = process.env.BACKUP_DATABASE_URL;
  const pgEnv: NodeJS.ProcessEnv = url ? { ...process.env, ...pgEnvFromUrl(url), BACKUP_DATABASE_URL: undefined } : process.env;

  const dumpFile = path.join(dir, "full.dump");
  const dump = run("pg_dump", ["-w", "-Fc", "--quote-all-identifiers", "-f", dumpFile], pgEnv);
  if (dump.status !== 0) {
    // libpq errors name the host/user, never the password; still, print only the last line.
    throw new Error(`pg_dump failed (exit ${dump.status}): ${(dump.stderr.trim().split("\n").pop() ?? dump.error?.message ?? "").slice(0, 200)}`);
  }
  const toc = run("pg_restore", ["--list", dumpFile]);
  const tableData = toc.stdout.split(/\r?\n/).filter((line) => line.includes(" TABLE DATA ")).length;
  const authUsers = /TABLE DATA "?auth"? "?users"?/.test(toc.stdout);
  if (toc.status !== 0 || tableData === 0) throw new Error("The new dump is not a readable archive; nothing uploaded.");
  if (!authUsers) throw new Error("The new dump has no auth.users data (every account would be lost); nothing uploaded.");

  const dumpSha = sha256(readFileSync(dumpFile));
  const serverVersion = /Dumped from database version: (\S+)/.exec(toc.stdout)?.[1] ?? "unknown";
  const manifest = {
    createdAt: now.toISOString(),
    pgDump: run("pg_dump", ["--version"]).stdout.trim(),
    serverVersion,
    files: { "full.dump": { bytes: statSync(dumpFile).size, sha256: dumpSha } } as Record<string, { bytes: number; sha256: string }>,
    tableDataEntries: tableData,
    encryptedWith: null as string | null,
  };
  writeFileSync(path.join(dir, "checksums.txt"), `${dumpSha} *full.dump\n`);
  console.log(`dumped ${folder}full.dump: ${manifest.files["full.dump"]!.bytes} bytes, ${tableData} TABLE DATA entries, server ${serverVersion}`);

  let completed = false;
  if (has("upload")) {
    const recipient = process.env.BACKUP_AGE_RECIPIENT;
    if (!recipient || !/^age1[0-9a-z]{58}$/.test(recipient)) {
      throw new Error("BACKUP_AGE_RECIPIENT (an age1… public key) is required: backups hold customer data and are never uploaded unencrypted.");
    }
    const encrypted = `${dumpFile}.age`;
    const age = run("age", ["-r", recipient, "-o", encrypted, dumpFile]);
    if (age.status !== 0) throw new Error(`age failed (exit ${age.status}): ${age.stderr.trim().slice(0, 200) || age.error?.message}`);
    const encSha = sha256(readFileSync(encrypted));
    manifest.encryptedWith = `age:${recipient.slice(0, 12)}…`;
    manifest.files["full.dump.age"] = { bytes: statSync(encrypted).size, sha256: encSha };
    writeFileSync(path.join(dir, "checksums.txt"), `${dumpSha} *full.dump\n${encSha} *full.dump.age\n`);
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const uploads = [
      { key: `${folder}full.dump.age`, file: encrypted, type: "application/octet-stream" },
      { key: `${folder}checksums.txt`, file: path.join(dir, "checksums.txt"), type: "text/plain" },
      { key: `${folder}manifest.json`, file: path.join(dir, "manifest.json"), type: "application/json" },
    ];
    if (!apply) {
      for (const upload of uploads) console.log(`[dry-run] would upload ${upload.key} (${statSync(upload.file).size} bytes)`);
      console.log(`[dry-run] would read each back, compare SHA-256, then write ${folder}${COMPLETE_MARKER}`);
    } else {
      const config = readR2Config(process.env, "R2_BACKUP_BUCKET");
      const client = r2Client(config);
      const verified: Record<string, { bytes: number; sha256: string }> = {};
      const putVerified = async (key: string, body: Uint8Array, type: string) => {
        await putObject(client, config.bucket, key, body, { contentType: type });
        const back = await getObjectBytes(client, config.bucket, key);
        if (back.byteLength !== body.byteLength || sha256(back) !== sha256(body)) {
          throw new Error(`Read-back of ${key} does not match what was uploaded; the backup is NOT complete.`);
        }
        verified[key] = { bytes: body.byteLength, sha256: sha256(body) };
        console.log(`uploaded + verified ${key} (${body.byteLength} bytes)`);
      };
      for (const upload of uploads) await putVerified(upload.key, readFileSync(upload.file), upload.type);
      const marker = Buffer.from(JSON.stringify({ createdAt: now.toISOString(), objects: verified }, null, 2));
      await putVerified(`${folder}${COMPLETE_MARKER}`, marker, "application/json");
      completed = true;
      rmSync(dumpFile, { force: true }); // plaintext no longer needed once the encrypted copy is verified
    }
  } else {
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  }

  if (has("prune")) {
    if (!hasR2Config(process.env, "R2_BACKUP_BUCKET")) {
      console.log("[dry-run] retention: no R2 credentials, bucket not listed.");
    } else {
      const config = readR2Config(process.env, "R2_BACKUP_BUCKET");
      const client = r2Client(config);
      const plan = planRetention(await listKeys(client, config.bucket, BACKUP_PREFIX), now);
      console.log(
        `retention plan: keep ${plan.keepFolders.length} backup folder(s), delete ${plan.deleteFolders.length} (${plan.deleteKeys.length} objects); ${plan.incompleteFolders.length} incomplete folder(s)`,
      );
      for (const doomed of plan.deleteFolders) console.log(`  ${applyPrune ? "deleting" : "[plan] would delete"} ${doomed}`);
      if (applyPrune) {
        if (!completed || !plan.keepFolders.includes(folder)) throw new Error(`Refusing to prune: the backup just made (${folder}) is not complete and kept.`);
        await deleteKeys(client, config.bucket, plan.deleteKeys);
        console.log(`retention: deleted ${plan.deleteFolders.length} folder(s)`);
      } else {
        console.log("retention: deletion disabled (no --apply-prune); nothing deleted.");
      }
    }
  }

  const result = arg("result");
  if (result && completed) {
    writeFileSync(result, JSON.stringify({ folder, createdAt: now.toISOString(), encryptedBytes: manifest.files["full.dump.age"]?.bytes, tableData, serverVersion }));
  }
  console.log(`BACKUP_RESULT ${JSON.stringify({ folder, completed, uploaded: completed, tableData })}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
