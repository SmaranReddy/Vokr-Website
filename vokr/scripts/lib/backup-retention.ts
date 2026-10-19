/**
 * Which backups to keep (plan §5 Phase 18, R17). Pure, so the rule that
 * decides what gets deleted is unit-tested rather than trusted.
 *
 * A backup is one R2 "folder": `db/<YYYYMMDDTHHMMSSZ>/…` (the dump, its
 * checksum file and manifest). Policy, newest wins inside each bucket:
 *   - every backup from the last `hourlyHours` (default 48 h — the 6-hourly
 *     runs of the last two days)
 *   - the newest backup of each UTC day for `dailyDays` days (default 14)
 *   - the newest backup of each ISO week for `weeklyWeeks` weeks (default 8)
 *   - always the newest backup, whatever its age, so a stalled schedule can
 *     never prune the last good copy
 * Anything else is deleted. A key that does not parse is never deleted.
 */
export interface RetentionPolicy {
  hourlyHours: number;
  dailyDays: number;
  weeklyWeeks: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { hourlyHours: 48, dailyDays: 14, weeklyWeeks: 8 };

export const BACKUP_PREFIX = "db/";

const STAMP = /^db\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\//;

/** `2026-10-19T06:00:00Z` → `db/20261019T060000Z/` */
export function backupFolder(at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${BACKUP_PREFIX}${stamp}/`;
}

export function parseBackupTime(key: string): Date | null {
  const match = STAMP.exec(key);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const at = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  return Number.isNaN(at.getTime()) ? null : at;
}

function isoWeek(at: Date): string {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${week}`;
}

export interface RetentionPlan {
  keepFolders: string[];
  deleteFolders: string[];
  deleteKeys: string[];
}

export function planRetention(keys: readonly string[], now: Date, policy: RetentionPolicy = DEFAULT_RETENTION): RetentionPlan {
  const folders = new Map<string, Date>();
  for (const key of keys) {
    const at = parseBackupTime(key);
    if (at) folders.set(key.slice(0, key.indexOf("/", BACKUP_PREFIX.length) + 1), at);
  }
  const newestFirst = [...folders.entries()].sort((a, b) => b[1].getTime() - a[1].getTime());
  const keep = new Set<string>();
  if (newestFirst[0]) keep.add(newestFirst[0][0]);

  const hour = 3_600_000;
  const day = 24 * hour;
  const seenDays = new Set<string>();
  const seenWeeks = new Set<string>();
  for (const [folder, at] of newestFirst) {
    const age = now.getTime() - at.getTime();
    if (age < 0) {
      keep.add(folder); // from the future: a clock problem, not something to prune
      continue;
    }
    if (age <= policy.hourlyHours * hour) keep.add(folder);
    const dayKey = at.toISOString().slice(0, 10);
    if (age <= policy.dailyDays * day && !seenDays.has(dayKey)) {
      seenDays.add(dayKey);
      keep.add(folder);
    }
    const weekKey = isoWeek(at);
    if (age <= policy.weeklyWeeks * 7 * day && !seenWeeks.has(weekKey)) {
      seenWeeks.add(weekKey);
      keep.add(folder);
    }
  }

  const deleteFolders = newestFirst.map(([folder]) => folder).filter((folder) => !keep.has(folder));
  const doomed = new Set(deleteFolders);
  return {
    keepFolders: newestFirst.map(([folder]) => folder).filter((folder) => keep.has(folder)),
    deleteFolders,
    deleteKeys: keys.filter((key) => {
      const at = parseBackupTime(key);
      return at !== null && doomed.has(key.slice(0, key.indexOf("/", BACKUP_PREFIX.length) + 1));
    }),
  };
}
