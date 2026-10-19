/**
 * Restore drill (plan §5 Phase 18, R17): prove a backup restores, not just
 * that it exists.
 *
 *   tsx scripts/backup/restore-drill.ts --dump <path to full.dump> [--report <dir>]
 *   tsx scripts/backup/restore-drill.ts --from-r2 <latest|YYYYMMDDTHHMMSSZ> --identity <age key file> --report <dir>
 *
 * `--from-r2` (R2 credentials in the environment, read-only use) picks the
 * newest folder with a `COMPLETE` marker (or the named one, which must be
 * complete), downloads it into a private temp directory, checks the
 * ciphertext SHA-256 against both `checksums.txt` and the marker, decrypts
 * with `age -d -i <identity>`, and then runs the drill below on the
 * plaintext, whose SHA-256 must match too. The temp directory (plaintext
 * included) is deleted afterwards, pass or fail.
 *
 * 1. Verifies the dump's SHA-256 against `checksums.txt` beside it (or
 *    `--sha256 <hex>`). A mismatch stops the drill.
 * 2. Lists the archive's table of contents (`pg_restore --list`) — the
 *    whole archive must be readable, auth schema included.
 * 3. Starts a throwaway Postgres in Docker (127.0.0.1 only, `--rm`), restores
 *    the `public` schema into it, and checks: migrations applied (and that
 *    they are a prefix of this checkout's `prisma/migrations`), row counts of
 *    the core tables, RLS still on for every public table.
 * 4. Removes the container and writes `restore-drill-<stamp>.json` + `.md`.
 *
 * Never connects to anything but the throwaway container. The dump holds
 * customer data and auth hashes: it is read in place, nothing is copied.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { BACKUP_PREFIX, COMPLETE_MARKER, newestCompleteBackup } from "../lib/backup-retention";
import { getObjectBytes, listKeys, r2Client, readR2Config } from "../lib/r2";

const PG_IMAGE = process.env.RESTORE_DRILL_PG_IMAGE ?? "postgres:17-alpine";
const PORT = Number(process.env.RESTORE_DRILL_PORT ?? "55441");
const PASSWORD = "restore_drill_throwaway";
/** Core tables and the migration that creates each: a table is required only once its migration is in the dump. */
const CORE_TABLES: Record<string, string> = {
  products: "20260908055107_init_catalog",
  product_variants: "20260908055107_init_catalog",
  inventory: "20260908055107_init_catalog",
  app_users: "20260908102243_auth_guest_sessions",
  payments: "20261014095422_payments",
  orders: "20261015145320_orders",
  order_items: "20261015145320_orders",
  audit_log: "20261016175750_admin_ops",
};
/** Prisma's own bookkeeping table: no RLS by design, and the API roles hold no SELECT on it. */
const RLS_EXEMPT = new Set(["_prisma_migrations"]);

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function run(command: string, args: string[], options: { env?: Record<string, string>; input?: string } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", env: { ...process.env, ...options.env }, input: options.input, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function expectedSha(dump: string): string | undefined {
  const given = arg("sha256");
  if (given) return given.toLowerCase();
  const checksums = path.join(path.dirname(dump), "checksums.txt");
  if (!existsSync(checksums)) return undefined;
  const name = path.basename(dump);
  const line = readFileSync(checksums, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().endsWith(name) && entry.trim().split(/\s+\*?/).pop() === name);
  return line?.trim().split(/\s+/)[0]?.toLowerCase();
}

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

/** Downloads, verifies and decrypts one R2 backup into `work`; returns the plaintext dump's path. */
async function fetchFromR2(which: string, identity: string, work: string): Promise<{ dump: string; folder: string }> {
  if (!existsSync(identity)) throw new Error("--identity <age private key file> is required with --from-r2.");
  if (which !== "latest" && !/^\d{8}T\d{6}Z$/.test(which)) throw new Error("--from-r2 takes `latest` or a backup stamp like 20261019T061700Z.");
  const config = readR2Config(process.env, "R2_BACKUP_BUCKET");
  const client = r2Client(config);
  const keys = await listKeys(client, config.bucket, BACKUP_PREFIX);
  const folder = which === "latest" ? newestCompleteBackup(keys)?.folder : `${BACKUP_PREFIX}${which}/`;
  if (!folder) throw new Error("No complete backup in the bucket.");
  if (!keys.includes(`${folder}${COMPLETE_MARKER}`)) throw new Error(`${folder} has no ${COMPLETE_MARKER} marker: it is not a finished backup.`);
  const marker = JSON.parse(Buffer.from(await getObjectBytes(client, config.bucket, `${folder}${COMPLETE_MARKER}`)).toString("utf8")) as {
    objects: Record<string, { sha256: string }>;
  };
  for (const name of ["full.dump.age", "checksums.txt", "manifest.json"]) {
    writeFileSync(path.join(work, name), await getObjectBytes(client, config.bucket, `${folder}${name}`));
  }
  const encrypted = path.join(work, "full.dump.age");
  const encSha = sha256File(encrypted);
  const listed = readFileSync(path.join(work, "checksums.txt"), "utf8").match(/^([0-9a-f]{64}) \*full\.dump\.age$/m)?.[1];
  if (encSha !== listed || encSha !== marker.objects[`${folder}full.dump.age`]?.sha256) {
    throw new Error(`Ciphertext SHA-256 of ${folder}full.dump.age does not match checksums.txt and the ${COMPLETE_MARKER} marker.`);
  }
  console.log(`PASS  ciphertext checksum  (${folder}full.dump.age sha256 ${encSha.slice(0, 16)}…)`);
  const dump = path.join(work, "full.dump");
  const age = run("age", ["-d", "-i", identity, "-o", dump, encrypted]);
  if (age.status !== 0) throw new Error(`age -d failed (exit ${age.status}): ${age.stderr.trim().slice(0, 200)}`);
  return { dump, folder };
}

async function main(): Promise<void> {
  const fromR2 = arg("from-r2");
  if (!fromR2) return drill(arg("dump"), arg("report"));
  const report = arg("report");
  if (!report) throw new Error("--report <dir> is required with --from-r2 (the download directory is deleted afterwards).");
  const work = mkdtempSync(path.join(tmpdir(), "vokr-restore-"));
  try {
    const { dump, folder } = await fetchFromR2(fromR2, arg("identity") ?? "", work);
    await drill(dump, report, folder);
  } finally {
    rmSync(work, { recursive: true, force: true }); // plaintext dump included
    if (existsSync(work)) console.error(`WARNING: could not remove ${work} (holds a decrypted dump) — delete it by hand.`);
    else console.log("removed the temporary download directory (decrypted dump included)");
  }
}

async function drill(dump: string | undefined, reportArg: string | undefined, source?: string): Promise<void> {
  if (!dump || !existsSync(dump)) throw new Error("--dump <path to a pg_dump custom-format archive> (or --from-r2) is required.");
  const reportDir = reportArg ?? path.dirname(dump);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const container = `vokr-restore-drill-${stamp.toLowerCase()}`;
  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  };
  const started = Date.now();

  const expected = expectedSha(dump);
  const actual = sha256File(dump);
  check("checksum matches", expected !== undefined && expected === actual, expected ? `sha256 ${actual.slice(0, 16)}…` : "no checksum recorded");
  if (expected !== actual) return finish();

  const toc = run("pg_restore", ["--list", dump]);
  const tocLines = toc.stdout.split(/\r?\n/).filter((line) => /^\d+;/.test(line));
  const tableData = tocLines.filter((line) => line.includes(" TABLE DATA "));
  check(
    "archive fully readable",
    toc.status === 0 && tocLines.length > 0,
    `${tocLines.length} TOC entries, ${tableData.length} TABLE DATA, auth.users data ${tableData.some((l) => / auth "?users"? /.test(l)) ? "present" : "absent"}`,
  );
  if (toc.status !== 0) return finish();

  const up = run("docker", ["run", "-d", "--rm", "--name", container, "-e", `POSTGRES_PASSWORD=${PASSWORD}`, "-p", `127.0.0.1:${PORT}:5432`, PG_IMAGE]);
  if (up.status !== 0) {
    check("throwaway postgres started", false, up.stderr.trim().split("\n").pop() ?? "docker run failed");
    return finish();
  }
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (run("docker", ["exec", container, "pg_isready", "-U", "postgres"]).status === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const pgEnv = { PGHOST: "127.0.0.1", PGPORT: String(PORT), PGUSER: "postgres", PGPASSWORD: PASSWORD, PGSSLMODE: "disable" };
    run("psql", ["-d", "postgres", "-c", "CREATE DATABASE restore_drill"], { env: pgEnv });
    const restore = run("pg_restore", ["--no-owner", "--no-acl", "-n", "public", "-d", "restore_drill", dump], { env: pgEnv });
    const errors = restore.stderr.split(/\r?\n/).filter((line) => /error:/i.test(line));
    // Restoring into a fresh database, `schema "public" already exists` is the one expected error.
    const unexpected = errors.filter((line) => !/schema "public" already exists/.test(line));
    check("public schema restored", unexpected.length === 0, `${errors.length} error line(s), ${unexpected.length} unexpected${unexpected[0] ? `: ${unexpected[0].slice(0, 160)}` : ""}`);

    const sql = (query: string) => run("psql", ["-d", "restore_drill", "-At", "-c", query], { env: pgEnv });
    const applied = sql(`SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`).stdout.split(/\r?\n/).filter(Boolean);
    const repo = readdirSync(path.resolve(import.meta.dirname, "../../prisma/migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const isPrefix = applied.length > 0 && applied.every((name, i) => repo[i] === name);
    check("migrations are a prefix of this checkout", isPrefix, `${applied.length} applied, last ${applied.at(-1) ?? "none"}; ${repo.length} in repo (${repo.length - applied.length} pending)`);

    const counts: Record<string, string> = {};
    let missingRequired = 0;
    for (const [table, migration] of Object.entries(CORE_TABLES)) {
      const required = applied.includes(migration);
      const result = sql(`SELECT count(*) FROM public."${table}"`);
      counts[table] = result.status === 0 ? result.stdout.trim() : required ? "MISSING" : "not yet (later migration)";
      if (required && result.status !== 0) missingRequired += 1;
    }
    check("core tables present", missingRequired === 0, Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(" "));

    const noRls = sql(`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity ORDER BY 1`).stdout.split(/\r?\n/).filter((table) => Boolean(table) && !RLS_EXEMPT.has(table));
    check("RLS on every public table (except _prisma_migrations)", noRls.length === 0, noRls.length === 0 ? "all on" : `off: ${noRls.join(", ")}`);
  } finally {
    run("docker", ["rm", "-f", container]);
    const left = run("docker", ["ps", "-a", "-q", "--filter", `name=${container}`]).stdout.trim();
    check("throwaway container removed", left === "", left === "" ? container : `still present: ${left}`);
  }
  return finish();

  function finish(): void {
    const pass = checks.length > 0 && checks.every((entry) => entry.pass);
    const report = { drill: "restore", dump: source ? `${source}full.dump.age` : path.basename(dump!), image: PG_IMAGE, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), pass, checks };
    mkdirSync(reportDir, { recursive: true });
    const base = path.join(reportDir, `restore-drill-${stamp}`);
    writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
    writeFileSync(
      `${base}.md`,
      [`# Restore drill ${report.at}`, "", `Dump: \`${report.dump}\` · image \`${PG_IMAGE}\` · ${report.seconds} s · **${pass ? "PASS" : "FAIL"}**`, "", ...checks.map((c) => `- ${c.pass ? "PASS" : "FAIL"} ${c.name} — ${c.detail}`), ""].join("\n"),
    );
    console.log(JSON.stringify({ pass, report: `${base}.json` }));
    if (!pass) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
