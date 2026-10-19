/**
 * Which backups to keep (plan §5 Phase 18, R17). Pure, so the rule that
 * decides what gets deleted is unit-tested rather than trusted.
 *
 * A backup is one R2 "folder": `db/<YYYYMMDDTHHMMSSZ>/…` (the dump, its
 * checksum file, manifest and the `COMPLETE` marker). A folder counts as a
 * backup only once its `COMPLETE` marker exists — the marker is written
 * last, after every object was read back and its SHA-256 matched — so a run
 * that died mid-upload is never "the newest backup", never satisfies the
 * prune guard and never feeds the freshness alert.
 *
 * Policy for complete backups, newest wins inside each bucket:
 *   - every backup from the last `hourlyHours` (default 48 h — the 6-hourly
 *     runs of the last two days)
 *   - the newest backup of each UTC day for `dailyDays` days (default 14)
 *   - the newest backup of each ISO week for `weeklyWeeks` weeks (default 8)
 *   - always the newest backup, whatever its age, so a stalled schedule can
 *     never prune the last good copy
 * Incomplete folders are left alone for `incompleteGraceHours` (default
 * 24 h — a run may still be uploading) and then deleted as debris.
 * Anything else is deleted. A key that does not parse is never deleted.
 */
export interface RetentionPolicy {
  hourlyHours: number;
  dailyDays: number;
  weeklyWeeks: number;
  incompleteGraceHours: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { hourlyHours: 48, dailyDays: 14, weeklyWeeks: 8, incompleteGraceHours: 24 };

export const BACKUP_PREFIX = "db/";

/** Written last; its presence is what makes a folder a backup. */
export const COMPLETE_MARKER = "COMPLETE";

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

const folderOf = (key: string) => key.slice(0, key.indexOf("/", BACKUP_PREFIX.length) + 1);

function isoWeek(at: Date): string {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${week}`;
}

/** The newest folder that has its `COMPLETE` marker, or null. */
export function newestCompleteBackup(keys: readonly string[]): { folder: string; at: Date } | null {
  let newest: { folder: string; at: Date } | null = null;
  for (const key of keys) {
    const at = parseBackupTime(key);
    if (!at || key !== `${folderOf(key)}${COMPLETE_MARKER}`) continue;
    if (!newest || at > newest.at) newest = { folder: folderOf(key), at };
  }
  return newest;
}

export interface RetentionPlan {
  keepFolders: string[];
  deleteFolders: string[];
  deleteKeys: string[];
  /** Folders without a `COMPLETE` marker, kept or deleted, for the run log. */
  incompleteFolders: string[];
}

export function planRetention(keys: readonly string[], now: Date, policy: RetentionPolicy = DEFAULT_RETENTION): RetentionPlan {
  const folders = new Map<string, Date>();
  const complete = new Set<string>();
  for (const key of keys) {
    const at = parseBackupTime(key);
    if (!at) continue;
    folders.set(folderOf(key), at);
    if (key === `${folderOf(key)}${COMPLETE_MARKER}`) complete.add(folderOf(key));
  }
  const newestFirst = [...folders.entries()].sort((a, b) => b[1].getTime() - a[1].getTime());
  const keep = new Set<string>();

  const hour = 3_600_000;
  const day = 24 * hour;
  const seenDays = new Set<string>();
  const seenWeeks = new Set<string>();
  let newestKept = false;
  for (const [folder, at] of newestFirst) {
    const age = now.getTime() - at.getTime();
    if (age < 0) {
      keep.add(folder); // from the future: a clock problem, not something to prune
      continue;
    }
    if (!complete.has(folder)) {
      if (age <= policy.incompleteGraceHours * hour) keep.add(folder); // may still be uploading
      continue;
    }
    if (!newestKept) {
      newestKept = true;
      keep.add(folder);
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
    deleteKeys: keys.filter((key) => parseBackupTime(key) !== null && doomed.has(folderOf(key))),
    incompleteFolders: newestFirst.map(([folder]) => folder).filter((folder) => !complete.has(folder)),
  };
}
