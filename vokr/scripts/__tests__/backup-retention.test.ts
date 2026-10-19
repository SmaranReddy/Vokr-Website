import { describe, expect, it } from "vitest";

import { backupFolder, parseBackupTime, planRetention } from "../lib/backup-retention";

const now = new Date("2026-10-19T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const keysFor = (at: Date) => [`${backupFolder(at)}full.dump.age`, `${backupFolder(at)}manifest.json`];

describe("backup retention", () => {
  it("names and parses backup folders", () => {
    expect(backupFolder(new Date("2026-10-19T06:00:00.123Z"))).toBe("db/20261019T060000Z/");
    expect(parseBackupTime("db/20261019T060000Z/full.dump.age")?.toISOString()).toBe("2026-10-19T06:00:00.000Z");
    expect(parseBackupTime("db/latest/full.dump")).toBeNull();
    expect(parseBackupTime("other/20261019T060000Z/x")).toBeNull();
  });

  it("keeps every 6-hourly backup of the last 48 hours", () => {
    const keys = [0, 6, 12, 18, 24, 30, 36, 42, 48].flatMap((h) => keysFor(hoursAgo(h)));
    expect(planRetention(keys, now).deleteKeys).toEqual([]);
  });

  it("thins to one per day for 14 days, one per week for 8 weeks, then deletes", () => {
    const keys = Array.from({ length: 4 * 120 }, (_, i) => hoursAgo(i * 6)).flatMap(keysFor); // 120 days of 6-hourly runs
    const plan = planRetention(keys, now);
    const kept = plan.keepFolders.map((folder) => parseBackupTime(folder)!);
    const oldestKeptDays = (now.getTime() - Math.min(...kept.map((d) => d.getTime()))) / 86_400_000;
    expect(oldestKeptDays).toBeLessThanOrEqual(8 * 7);
    const beyond48h = kept.filter((d) => now.getTime() - d.getTime() > 48 * 3_600_000);
    // At most one per day inside 14 days plus one per ISO week inside 8 weeks.
    expect(beyond48h.length).toBeLessThanOrEqual(14 + 9);
    expect(plan.keepFolders.length + plan.deleteFolders.length).toBe(480);
    // Each deleted folder takes both its objects with it.
    expect(plan.deleteKeys.length).toBe(plan.deleteFolders.length * 2);
  });

  it("never deletes the newest backup, even when it is ancient", () => {
    const keys = [...keysFor(hoursAgo(24 * 400)), ...keysFor(hoursAgo(24 * 500))];
    const plan = planRetention(keys, now);
    expect(plan.keepFolders).toEqual([backupFolder(hoursAgo(24 * 400))]);
    expect(plan.deleteFolders).toEqual([backupFolder(hoursAgo(24 * 500))]);
  });

  it("never deletes a key it cannot parse, nor one dated in the future", () => {
    const keys = ["db/README.txt", "db/notastamp/full.dump", ...keysFor(new Date(now.getTime() + 3_600_000)), ...keysFor(hoursAgo(24 * 200))];
    const plan = planRetention(keys, now);
    expect(plan.deleteKeys.every((key) => key.startsWith(backupFolder(hoursAgo(24 * 200))))).toBe(true);
    expect(plan.keepFolders).toContain(backupFolder(new Date(now.getTime() + 3_600_000)));
  });

  it("an empty bucket plans nothing", () => {
    expect(planRetention([], now)).toEqual({ keepFolders: [], deleteFolders: [], deleteKeys: [] });
  });
});
