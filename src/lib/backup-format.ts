/**
 * The backup file: its shape, and the check that a file really is one before anything on the
 * phone is touched. Pure (no SQLite, no files) so the check can be tested; `backup.ts` does the
 * reading and writing.
 *
 * Format 1: { app: 'calorie-tracker', format: 1, exportedAt, data: { entries, foods, exercises, weights, settings } }
 * The Groq API key is never part of it: it lives in the phone's secure storage, not in settings.
 * Nor is anything else that is about one phone rather than the owner's log (see `keepPhoneState`).
 */
import { formatShortDate, isDateKey, toDateKey } from './dates';
import { ACTIVITY_ORDER, INTENSITY_ORDER, type Activity, type Intensity } from './exercise';
import { portableSettings, readSettings, withPhoneSettings, type PortableSettings, type Settings } from './settings-schema';
import { MEALS, type Entry, type EntrySource, type Exercise, type Meal, type SavedFood, type WeightEntry, type WeightSource } from './types';
import { isValidWeightKg } from './weight';

export const BACKUP_APP = 'calorie-tracker';
export const BACKUP_FORMAT = 1;

export interface BackupData {
  entries: Entry[];
  foods: SavedFood[];
  exercises: Exercise[];
  weights: WeightEntry[];
  /** The owner's choices. What only one phone can know (`notificationsAsked`) is left out. */
  settings: PortableSettings;
}

export interface BackupFile {
  app: typeof BACKUP_APP;
  format: typeof BACKUP_FORMAT;
  /** When the backup was made, as an ISO 8601 time. */
  exportedAt: string;
  data: BackupData;
}

/** What a backup holds, for the confirmation before restoring and the message after exporting. */
export interface BackupSummary {
  exportedAt: string;
  entries: number;
  foods: number;
  exercises: number;
  weights: number;
  /** The first and last day with a food entry, a workout or a weigh-in; null when the backup is empty. */
  firstDate: string | null;
  lastDate: string | null;
}

export type BackupCheck =
  | { ok: true; backup: BackupFile; summary: BackupSummary }
  /** Plain-language reasons the file cannot be restored. Nothing has been changed. */
  | { ok: false; problems: string[] };

/** How many problems to spell out before summing up the rest. */
const MAX_PROBLEMS = 8;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Collects what is wrong with one row and reports it once, by its position in the list. */
class RowCheck {
  private faults: string[] = [];
  constructor(
    private readonly row: Record<string, unknown>,
    private readonly label: string,
    private readonly problems: string[],
  ) {}

  private fail(what: string) {
    this.faults.push(what);
  }

  id(seen: Set<number>, noun: string): number {
    const v = this.row.id;
    if (!isId(v)) {
      this.fail('has no id');
      return 0;
    }
    if (seen.has(v)) this.problems.push(`Two ${noun} share the id ${v}.`);
    seen.add(v);
    return v;
  }

  date(): string {
    const v = this.row.date;
    if (isDateKey(v)) return v;
    this.fail('has a date that is not a real day');
    return '';
  }

  /** A number that is zero or more. `what` is how the fault reads: "calories that are", "a time that is". */
  amount(key: string, what: string): number {
    const v = this.row[key];
    if (isAmount(v)) return v;
    this.fail(`has ${what} not a number`);
    return 0;
  }

  text(key: string, what: string, required: boolean): string {
    const v = this.row[key];
    if (v === undefined || v === null) {
      if (required) this.fail(`has no ${what}`);
      return '';
    }
    if (typeof v !== 'string') {
      this.fail(`has a ${what} that is not text`);
      return '';
    }
    if (required && v.trim().length === 0) this.fail(`has no ${what}`);
    return v;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], what: string): T {
    const v = this.row[key];
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
    this.fail(`has ${what} this app does not know`);
    return allowed[0];
  }

  /** A Health Connect record id: text, or nothing. */
  recordId(key: string): string | null {
    const v = this.row[key];
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') return v;
    this.fail('has a Health Connect id that is not text');
    return null;
  }

  flag(key: string, what: string): boolean {
    const v = this.row[key];
    if (typeof v === 'boolean') return v;
    this.fail(`has ${what} that is not yes or no`);
    return false;
  }

  weight(key: string): number {
    const v = this.row[key];
    if (isValidWeightKg(v)) return v;
    this.fail('has a weight that is not possible');
    return 0;
  }

  done() {
    if (this.faults.length > 0) this.problems.push(`${this.label} ${this.faults.join(', and ')}.`);
  }
}

function readRows<T>(
  data: Record<string, unknown>,
  key: string,
  listName: string,
  rowName: string,
  problems: string[],
  read: (check: RowCheck, seen: Set<number>) => T,
): T[] {
  const list = data[key];
  if (!Array.isArray(list)) {
    problems.push(`The backup has no list of ${listName}.`);
    return [];
  }
  const seen = new Set<number>();
  const rows: T[] = [];
  list.forEach((raw, i) => {
    const label = `${rowName} ${i + 1}`;
    if (!isRecord(raw)) {
      problems.push(`${label} is not readable.`);
      return;
    }
    const check = new RowCheck(raw, label, problems);
    rows.push(read(check, seen));
    check.done();
  });
  return rows;
}

/**
 * Check that something read from a file is a backup this app can restore. Every row and every
 * setting is checked; fields the app does not know are dropped. Returns either the backup, fully
 * typed and safe to restore, or the reasons it is not, in plain language.
 */
export function validateBackup(raw: unknown): BackupCheck {
  if (!isRecord(raw) || raw.app !== BACKUP_APP) {
    return { ok: false, problems: ['This file is not a Calorie Tracker backup.'] };
  }
  if (raw.format !== BACKUP_FORMAT) {
    const newer = typeof raw.format === 'number' && Number.isInteger(raw.format) && raw.format > BACKUP_FORMAT;
    return {
      ok: false,
      problems: [
        newer
          ? 'This backup was made by a newer version of Calorie Tracker. Update the app, then restore it.'
          : 'This backup is in a format this app does not understand.',
      ],
    };
  }

  const problems: string[] = [];
  const exportedAt = typeof raw.exportedAt === 'string' && Number.isFinite(Date.parse(raw.exportedAt)) ? raw.exportedAt : null;
  if (exportedAt === null) problems.push('The backup does not say when it was made.');

  if (!isRecord(raw.data)) {
    return { ok: false, problems: [...problems, 'The backup has no data in it.'] };
  }
  const data = raw.data;

  const entries = readRows<Entry>(data, 'entries', 'food entries', 'Food entry', problems, (c, seen) => ({
    id: c.id(seen, 'food entries'),
    date: c.date(),
    meal: c.oneOf<Meal>('meal', MEALS, 'a meal'),
    name: c.text('name', 'name', true),
    portion: c.text('portion', 'portion', false),
    calories: c.amount('calories', 'calories that are'),
    protein: c.amount('protein', 'protein that is'),
    carbs: c.amount('carbs', 'carbs that are'),
    fat: c.amount('fat', 'fat that is'),
    // How an entry was made is only a note, and older versions had other ways, so any label is kept.
    source: c.text('source', 'source', true) as EntrySource,
    createdAt: c.amount('createdAt', 'a time that is'),
    hcRecordId: c.recordId('hcRecordId'),
  }));

  const foods = readRows<SavedFood>(data, 'foods', 'saved foods', 'Saved food', problems, (c, seen) => ({
    id: c.id(seen, 'saved foods'),
    name: c.text('name', 'name', true),
    portion: c.text('portion', 'portion', false),
    calories: c.amount('calories', 'calories that are'),
    protein: c.amount('protein', 'protein that is'),
    carbs: c.amount('carbs', 'carbs that are'),
    fat: c.amount('fat', 'fat that is'),
    pinned: c.flag('pinned', 'a star'),
    useCount: Math.floor(c.amount('useCount', 'a use count that is')),
    lastUsedAt: c.amount('lastUsedAt', 'a time that is'),
  }));

  const exercises = readRows<Exercise>(data, 'exercises', 'workouts', 'Workout', problems, (c, seen) => ({
    id: c.id(seen, 'workouts'),
    date: c.date(),
    activity: c.oneOf<Activity>('activity', ACTIVITY_ORDER, 'an activity'),
    minutes: c.amount('minutes', 'minutes that are'),
    intensity: c.oneOf<Intensity>('intensity', INTENSITY_ORDER, 'an intensity'),
    calories: c.amount('calories', 'calories that are'),
    createdAt: c.amount('createdAt', 'a time that is'),
    hcSessionId: c.recordId('hcSessionId'),
    hcCaloriesId: c.recordId('hcCaloriesId'),
  }));

  const weighedOn = new Set<string>();
  const weights = readRows<WeightEntry>(data, 'weights', 'weigh-ins', 'Weigh-in', problems, (c, seen) => {
    const id = c.id(seen, 'weigh-ins');
    const date = c.date();
    if (date) {
      if (weighedOn.has(date)) problems.push(`Two weigh-ins share the date ${date}.`);
      weighedOn.add(date);
    }
    return {
      id,
      date,
      kg: c.weight('kg'),
      source: c.oneOf<WeightSource>('source', ['manual', 'health'], 'a source'),
      createdAt: c.amount('createdAt', 'a time that is'),
      hcRecordId: c.recordId('hcRecordId'),
    };
  });

  let settings: PortableSettings;
  if (isRecord(data.settings)) settings = portableSettings(readSettings(data.settings, problems));
  else {
    problems.push('The backup has no settings.');
    settings = portableSettings(readSettings(null));
  }

  if (problems.length > 0 || exportedAt === null) {
    const shown = problems.slice(0, MAX_PROBLEMS);
    const rest = problems.length - shown.length;
    if (rest > 0) shown.push(`And ${rest} more ${rest === 1 ? 'problem' : 'problems'} like these.`);
    return { ok: false, problems: shown };
  }

  const backup: BackupFile = { app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt, data: { entries, foods, exercises, weights, settings } };
  return { ok: true, backup, summary: summarizeBackup(backup) };
}

export function summarizeBackup(backup: BackupFile): BackupSummary {
  const { entries, foods, exercises, weights } = backup.data;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  for (const list of [entries, exercises, weights]) {
    for (const row of list) {
      if (firstDate === null || row.date < firstDate) firstDate = row.date;
      if (lastDate === null || row.date > lastDate) lastDate = row.date;
    }
  }
  return {
    exportedAt: backup.exportedAt,
    entries: entries.length,
    foods: foods.length,
    exercises: exercises.length,
    weights: weights.length,
    firstDate,
    lastDate,
  };
}

/** Wrap the app's data as a backup file made at `now`. */
export function makeBackupFile(data: BackupData, now: Date = new Date()): BackupFile {
  // Settings go through the same reader as a restore, so only real settings are ever written out.
  const settings = portableSettings(readSettings(data.settings));
  return { app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt: now.toISOString(), data: { ...data, settings } };
}

// ---------------------------------------------------------------- what a restore leaves alone

/** What only this phone can know. A restore replaces everything else and keeps this. */
export interface PhoneState {
  /** This phone's settings before the restore. Only `notificationsAsked` is kept from them. */
  settings: Pick<Settings, 'notificationsAsked'>;
  /**
   * Days whose weigh-in from another app was deleted on this phone. Health Connect still holds
   * those readings, so without this list the sync after a restore would bring them straight back.
   */
  dismissedWeightDates: readonly string[];
}

export interface KeptPhoneState {
  /** The backup's settings, with this phone's own facts put back. */
  settings: Settings;
  /** The dismissed days that still stand, oldest first. */
  dismissedWeightDates: string[];
}

/**
 * What to store beside the restored rows so the phone's own bookkeeping survives a restore.
 * A dismissed day that has a weigh-in in the backup is no longer dismissed, the same rule as
 * logging a weight for that day by hand.
 */
export function keepPhoneState(data: BackupData, phone: PhoneState): KeptPhoneState {
  const weighedOn = new Set(data.weights.map((w) => w.date));
  const dismissed = new Set<string>();
  for (const date of phone.dismissedWeightDates) {
    if (isDateKey(date) && !weighedOn.has(date)) dismissed.add(date);
  }
  return {
    settings: withPhoneSettings(data.settings, phone.settings),
    dismissedWeightDates: [...dismissed].sort(),
  };
}

/** "calorie-tracker-backup-2026-11-11.json", named for the local day it was made. */
export function backupFileName(now: Date = new Date()): string {
  return `${BACKUP_APP}-backup-${toDateKey(now)}.json`;
}

const count = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "1,240 food entries, 38 workouts, 61 weigh-ins and 54 saved foods, from 3 Aug to 11 Nov" */
export function describeBackup(summary: BackupSummary, now: Date = new Date()): string {
  const parts = [
    count(summary.entries, 'food entry', 'food entries'),
    count(summary.exercises, 'workout', 'workouts'),
    count(summary.weights, 'weigh-in', 'weigh-ins'),
  ];
  const list = `${parts.join(', ')} and ${count(summary.foods, 'saved food', 'saved foods')}`;
  if (summary.firstDate === null || summary.lastDate === null) return list;
  return summary.firstDate === summary.lastDate
    ? `${list}, from ${formatShortDate(summary.firstDate, now)}`
    : `${list}, from ${formatShortDate(summary.firstDate, now)} to ${formatShortDate(summary.lastDate, now)}`;
}
