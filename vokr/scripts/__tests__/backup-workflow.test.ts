import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The scheduled backup runs only in GitHub Actions, where nothing can be
 * rehearsed before it touches production — so its safety properties are
 * pinned here: off by default, deletion off by default, one run at a time,
 * secrets from Secret Manager via Workload Identity (no Actions secrets),
 * masked before use, and a success heartbeat only after verification.
 */
const workflow = readFileSync(path.resolve(import.meta.dirname, "../../../.github/workflows/backup.yml"), "utf8");
const stepIndex = (name: string) => workflow.indexOf(`- name: ${name}`);

describe("backup workflow", () => {
  it("runs every 6 hours and only when BACKUP_ENABLED is true", () => {
    expect(workflow).toContain('cron: "17 */6 * * *"');
    expect(workflow).toContain("if: vars.BACKUP_ENABLED == 'true'");
  });

  it("never overlaps and never cancels a running backup", () => {
    expect(workflow).toMatch(/concurrency:\n\s+group: database-backup\n\s+cancel-in-progress: false/);
  });

  it("deletes old backups only when BACKUP_PRUNE_ENABLED is true", () => {
    expect(workflow).toContain('if [ "${PRUNE_ENABLED:-}" = "true" ]; then args+=(--apply-prune); fi');
    expect(workflow.match(/--apply-prune/g)).toHaveLength(1);
    expect(workflow).toContain("PRUNE_ENABLED: ${{ vars.BACKUP_PRUNE_ENABLED }}");
  });

  it("uses Workload Identity from the backups environment and no Actions secrets", () => {
    expect(workflow).toContain("environment: backups");
    expect(workflow).toContain("service_account: ${{ vars.BACKUP_SERVICE_ACCOUNT }}");
    expect(workflow).toContain("id-token: write");
    expect(workflow).not.toMatch(/\$\{\{\s*secrets\./);
  });

  it("masks every secret before it is exported or used", () => {
    for (const name of ["BACKUP_DATABASE_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "DB_PASSWORD"]) {
      const assigned = workflow.indexOf(`${name}=$(`);
      const mask = workflow.indexOf(`echo "::add-mask::$${name}"`);
      expect(assigned, name).toBeGreaterThan(-1);
      expect(mask, name).toBeGreaterThan(assigned);
      const exported = workflow.indexOf("export ", mask);
      expect(workflow.slice(assigned, mask)).not.toContain("export");
      expect(exported, name).toBeGreaterThan(mask);
    }
    expect(workflow).not.toContain("GITHUB_ENV");
  });

  it("reads exactly the three backup secrets", () => {
    expect([...workflow.matchAll(/\$\(secret ([A-Z0-9_]+)\)/g)].map((match) => match[1])).toEqual([
      "BACKUP_DATABASE_URL",
      "R2_BACKUP_ACCESS_KEY_ID",
      "R2_BACKUP_SECRET_ACCESS_KEY",
    ]);
  });

  it("writes BACKUP_OK only after the backup step, from the verified result file; BACKUP_FAILED on failure", () => {
    expect(stepIndex("Heartbeat (BACKUP_OK)")).toBeGreaterThan(stepIndex("Back up, encrypt, upload, verify"));
    expect(workflow).toContain('test -s "$RUNNER_TEMP/backup-result.json"');
    expect(workflow).toMatch(/- name: Report failure \(BACKUP_FAILED\)\n\s+if: failure\(\)/);
  });

  it("never points the client at a test endpoint, and always cleans up the runner", () => {
    expect(workflow).not.toContain("R2_ENDPOINT_OVERRIDE");
    expect(workflow).toMatch(/- name: Remove local backup files\n\s+if: always\(\)/);
  });

  it("dumps with the client major the server runs (17)", () => {
    expect(workflow).toContain("postgresql-client-17");
    expect(workflow).toContain("/usr/lib/postgresql/17/bin");
  });
});
