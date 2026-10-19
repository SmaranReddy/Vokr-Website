/**
 * Scheduled database backup (plan §5 Phase 18, R17).
 *
 *   tsx scripts/backup/backup.ts --out <dir> [--upload] [--prune] [--apply]
 *
 * 1. `pg_dump -Fc` of the whole database (auth schema included — a restore
 *    without `auth.users` loses every account) into `<out>/<stamp>/full.dump`,
 *    plus `checksums.txt` (SHA-256) and `manifest.json`. Connection comes
 *    only from the standard libpq environment (`PGHOST`, `PGUSER`,
 *    `PGPASSFILE`/`PGPASSWORD`, `PGSSLMODE=require`…) — never an argument,
 *    never logged. Same flags as the manual pre-migration exports
 *    (`vokr-backups/*\/meta/dump.sh`).
 * 2. `--upload`: encrypts with `age` to `BACKUP_AGE_RECIPIENT` (a public key;
 *    the private key stays offline with the owner) and puts
 *    `db/<stamp>/full.dump.age`, `checksums.txt` and `manifest.json` in the
 *    private bucket `R2_BACKUP_BUCKET`. **Refuses to upload unencrypted.**
 * 3. `--prune`: applies `planRetention` to the bucket.
 *
 * Without `--apply`, steps 2–3 print what they would do and touch nothing
 * (and need no R2 credentials). The local dump in step 1 is always made.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { backupFolder, BACKUP_PREFIX, planRetention } from "../lib/backup-retention";
import { deleteKeys, listKeys, putObject, r2Client, readR2Config } from "../lib/r2";

const has = (flag: string) => process.argv.includes(`--${flag}`);
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest();

async function main(): Promise<void> {
  const out = arg("out");
  if (!out) throw new Error("--out <directory for the local dump> is required.");
  const apply = has("apply");
  const now = new Date();
  const folder = backupFolder(now); // db/<stamp>/
  const dir = path.join(out, folder.slice(BACKUP_PREFIX.length, -1));
  mkdirSync(dir, { recursive: true });

  const dumpFile = path.join(dir, "full.dump");
  const dump = run("pg_dump", ["-w", "-Fc", "--quote-all-identifiers", "-f", dumpFile]);
  if (dump.status !== 0) {
    // libpq errors name the host/user, never the password; still, print only the last line.
    throw new Error(`pg_dump failed (exit ${dump.status}): ${(dump.stderr.trim().split("\n").pop() ?? dump.error?.message ?? "").slice(0, 200)}`);
  }
  const toc = run("pg_restore", ["--list", dumpFile]);
  const tableData = toc.stdout.split(/\r?\n/).filter((line) => line.includes(" TABLE DATA ")).length;
  if (toc.status !== 0 || tableData === 0) throw new Error("The new dump is not a readable archive; nothing uploaded.");

  const dumpSha = sha256(dumpFile);
  const version = run("pg_dump", ["--version"]).stdout.trim();
  const manifest = {
    createdAt: now.toISOString(),
    pgDump: version,
    files: { "full.dump": { bytes: statSync(dumpFile).size, sha256: dumpSha.toString("hex") } } as Record<string, { bytes: number; sha256: string }>,
    tableDataEntries: tableData,
    encryptedWith: null as string | null,
  };
  writeFileSync(path.join(dir, "checksums.txt"), `${dumpSha.toString("hex")} *full.dump\n`);
  console.log(`dumped ${folder}full.dump: ${manifest.files["full.dump"]!.bytes} bytes, ${tableData} TABLE DATA entries`);

  if (has("upload")) {
    const recipient = process.env.BACKUP_AGE_RECIPIENT;
    if (!recipient || !/^age1[0-9a-z]{58}$/.test(recipient)) {
      throw new Error("BACKUP_AGE_RECIPIENT (an age1… public key) is required: backups hold customer data and are never uploaded unencrypted.");
    }
    const encrypted = `${dumpFile}.age`;
    const age = run("age", ["-r", recipient, "-o", encrypted, dumpFile]);
    if (age.status !== 0) throw new Error(`age failed (exit ${age.status}): ${age.stderr.trim().slice(0, 200) || age.error?.message}`);
    const encSha = sha256(encrypted);
    manifest.encryptedWith = `age:${recipient.slice(0, 12)}…`;
    manifest.files["full.dump.age"] = { bytes: statSync(encrypted).size, sha256: encSha.toString("hex") };
    writeFileSync(path.join(dir, "checksums.txt"), `${dumpSha.toString("hex")} *full.dump\n${encSha.toString("hex")} *full.dump.age\n`);
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const uploads = [
      { key: `${folder}full.dump.age`, file: encrypted, type: "application/octet-stream", sha: encSha },
      { key: `${folder}checksums.txt`, file: path.join(dir, "checksums.txt"), type: "text/plain" },
      { key: `${folder}manifest.json`, file: path.join(dir, "manifest.json"), type: "application/json" },
    ];
    if (!apply) {
      for (const upload of uploads) console.log(`[dry-run] would upload ${upload.key} (${statSync(upload.file).size} bytes)`);
    } else {
      const config = readR2Config(process.env, "R2_BACKUP_BUCKET");
      const client = r2Client(config);
      for (const upload of uploads) {
        const body = readFileSync(upload.file);
        await putObject(client, config.bucket, upload.key, body, {
          contentType: upload.type,
          sha256Base64: (upload.sha ?? createHash("sha256").update(body).digest()).toString("base64"),
        });
        console.log(`uploaded ${upload.key}`);
      }
    }
  } else {
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  }

  if (has("prune")) {
    if (!apply) {
      console.log("[dry-run] would list the backup bucket and delete what planRetention selects (run `prune --apply`).");
    } else {
      const config = readR2Config(process.env, "R2_BACKUP_BUCKET");
      const client = r2Client(config);
      const plan = planRetention(await listKeys(client, config.bucket, BACKUP_PREFIX), now);
      if (!plan.keepFolders.includes(folder)) throw new Error(`Refusing to prune: the backup just made (${folder}) is not in the keep set.`);
      await deleteKeys(client, config.bucket, plan.deleteKeys);
      console.log(`retention: kept ${plan.keepFolders.length} backups, deleted ${plan.deleteFolders.length}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
