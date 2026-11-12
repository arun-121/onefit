/**
 * Local SQLite storage. Uses the synchronous API so the same code works in the app
 * and in the widget's headless task (where there is no React tree).
 */
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { foodKey } from './ai-parse';
import type { Activity, Intensity } from './exercise';
import { planFoodMerge } from './food-merge';
import type { Entry, EntrySource, Exercise, FoodItem, Macros, Meal, NewExercise, SavedFood, WeightEntry, WeightSource } from './types';

let db: SQLiteDatabase | null = null;

export function getDb(): SQLiteDatabase {
  if (!db) {
    db = openDatabaseSync('calories.db');
    migrate(db);
  }
  return db;
}

/** A schema step: SQL, or code for changes SQL can't express (they run inside the same transaction). */
type Migration = string | ((database: SQLiteDatabase) => void);

/**
 * Re-key every saved food with the current foodKey() rule and merge the ones that now collide
 * (for example "Black coffee" and "Black coffee, 1 serving", once saved as two foods).
 */
function mergeDuplicateFoods(database: SQLiteDatabase) {
  const rows = database.getAllSync<{ id: number; name: string; portion: string; pinned: number; use_count: number; last_used_at: number }>(
    'SELECT id, name, portion, pinned, use_count, last_used_at FROM foods',
  );
  const plan = planFoodMerge(
    rows.map((r) => ({ id: r.id, name: r.name, portion: r.portion, pinned: r.pinned === 1, useCount: r.use_count, lastUsedAt: r.last_used_at })),
  );
  // Deletes first: a surviving row may take over the key a removed row was holding.
  for (const id of plan.remove) database.runSync('DELETE FROM foods WHERE id = ?', id);
  for (const k of plan.keep) {
    database.runSync('UPDATE foods SET food_key = ?, pinned = ?, use_count = ? WHERE id = ?', k.foodKey, k.pinned ? 1 : 0, k.useCount, k.id);
  }
}

const MIGRATIONS: Migration[] = [
  `
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    meal TEXT NOT NULL,
    name TEXT NOT NULL,
    portion TEXT NOT NULL DEFAULT '',
    calories REAL NOT NULL,
    protein REAL NOT NULL DEFAULT 0,
    carbs REAL NOT NULL DEFAULT 0,
    fat REAL NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    hc_record_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
  CREATE TABLE IF NOT EXISTS foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    portion TEXT NOT NULL DEFAULT '',
    calories REAL NOT NULL,
    protein REAL NOT NULL DEFAULT 0,
    carbs REAL NOT NULL DEFAULT 0,
    fat REAL NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    activity TEXT NOT NULL,
    minutes REAL NOT NULL,
    intensity TEXT NOT NULL,
    calories REAL NOT NULL,
    created_at INTEGER NOT NULL,
    hc_session_id TEXT,
    hc_calories_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_exercises_date ON exercises(date);
  `,
  mergeDuplicateFoods,
  // One weigh-in per calendar day; the UNIQUE date is also the index the range queries use.
  `
  CREATE TABLE IF NOT EXISTS weights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    kg REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    hc_record_id TEXT
  );
  `,
];

function migrate(database: SQLiteDatabase) {
  database.execSync('PRAGMA journal_mode = WAL;');
  const row = database.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const step = MIGRATIONS[v];
    database.withTransactionSync(() => {
      if (typeof step === 'string') database.execSync(step);
      else step(database);
      database.execSync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

// ---------- change notifications (for screens to re-read) ----------

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVersion(): number {
  return version;
}

export function notifyChanged() {
  version += 1;
  listeners.forEach((l) => l());
}

// ---------- entries ----------

interface EntryRow {
  id: number;
  date: string;
  meal: Meal;
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: EntrySource;
  created_at: number;
  hc_record_id: string | null;
}

function toEntry(r: EntryRow): Entry {
  return {
    id: r.id,
    date: r.date,
    meal: r.meal,
    name: r.name,
    portion: r.portion,
    calories: r.calories,
    protein: r.protein,
    carbs: r.carbs,
    fat: r.fat,
    source: r.source,
    createdAt: r.created_at,
    hcRecordId: r.hc_record_id,
  };
}

export function getEntriesForDate(date: string): Entry[] {
  return getDb()
    .getAllSync<EntryRow>('SELECT * FROM entries WHERE date = ? ORDER BY created_at, id', date)
    .map(toEntry);
}

export function getEntriesForMeal(date: string, meal: Meal): Entry[] {
  return getDb()
    .getAllSync<EntryRow>('SELECT * FROM entries WHERE date = ? AND meal = ? ORDER BY created_at, id', date, meal)
    .map(toEntry);
}

export function getEntry(id: number): Entry | null {
  const row = getDb().getFirstSync<EntryRow>('SELECT * FROM entries WHERE id = ?', id);
  return row ? toEntry(row) : null;
}

export function getMealsLoggedOn(date: string): Set<Meal> {
  const rows = getDb().getAllSync<{ meal: Meal }>('SELECT DISTINCT meal FROM entries WHERE date = ?', date);
  return new Set(rows.map((r) => r.meal));
}

export function getDayTotals(date: string): Macros {
  const row = getDb().getFirstSync<Macros>(
    `SELECT COALESCE(SUM(calories),0) AS calories, COALESCE(SUM(protein),0) AS protein,
            COALESCE(SUM(carbs),0) AS carbs, COALESCE(SUM(fat),0) AS fat
       FROM entries WHERE date = ?`,
    date,
  );
  return row ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

export interface DayTotal extends Macros {
  date: string;
  count: number;
}

/** Totals for each day that has entries, newest first, between two dates inclusive. */
export function getDailyTotals(fromDate: string, toDate: string): DayTotal[] {
  return getDb().getAllSync<DayTotal>(
    `SELECT date, COUNT(*) AS count, SUM(calories) AS calories, SUM(protein) AS protein,
            SUM(carbs) AS carbs, SUM(fat) AS fat
       FROM entries WHERE date BETWEEN ? AND ?
      GROUP BY date ORDER BY date DESC`,
    fromDate,
    toDate,
  );
}

/** Every day that has at least one food entry, oldest first. Small (one row per day), used for streaks. */
export function getLoggedDates(): string[] {
  return getDb()
    .getAllSync<{ date: string }>('SELECT DISTINCT date FROM entries ORDER BY date')
    .map((r) => r.date);
}

/** The first day anything was eaten and logged, or null on a new install. */
export function getFirstLoggedDate(): string | null {
  return getDb().getFirstSync<{ date: string | null }>('SELECT MIN(date) AS date FROM entries')?.date ?? null;
}

export interface DayMealCalories {
  date: string;
  meal: Meal;
  calories: number;
}

/** Calories per meal for each day between two dates inclusive. */
export function getMealCaloriesByDay(fromDate: string, toDate: string): DayMealCalories[] {
  return getDb().getAllSync<DayMealCalories>(
    `SELECT date, meal, SUM(calories) AS calories FROM entries
      WHERE date BETWEEN ? AND ? GROUP BY date, meal ORDER BY date, meal`,
    fromDate,
    toDate,
  );
}

export interface FoodContribution {
  name: string;
  /** Total calories from this food in the range. */
  calories: number;
  /** How many times it was logged. */
  count: number;
}

/** The foods that added the most calories between two dates inclusive, grouped by name whatever the portion. */
export function getTopFoods(fromDate: string, toDate: string, limit = 25): FoodContribution[] {
  return getDb().getAllSync<FoodContribution>(
    `SELECT MIN(name) AS name, SUM(calories) AS calories, COUNT(*) AS count FROM entries
      WHERE date BETWEEN ? AND ?
      GROUP BY LOWER(TRIM(name)) ORDER BY calories DESC, count DESC LIMIT ?`,
    fromDate,
    toDate,
    limit,
  );
}

/** Every food entry, oldest first (for the backup file). */
export function getAllEntries(): Entry[] {
  return getDb().getAllSync<EntryRow>('SELECT * FROM entries ORDER BY id').map(toEntry);
}

export function insertEntries(
  date: string,
  meal: Meal,
  items: readonly FoodItem[],
  source: EntrySource,
  now: number = Date.now(),
): Entry[] {
  const database = getDb();
  const ids: number[] = [];
  database.withTransactionSync(() => {
    items.forEach((item, i) => {
      const res = database.runSync(
        `INSERT INTO entries (date, meal, name, portion, calories, protein, carbs, fat, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        date,
        meal,
        item.name,
        item.portion,
        item.calories,
        item.protein,
        item.carbs,
        item.fat,
        source,
        now + i,
      );
      ids.push(res.lastInsertRowId);
    });
  });
  return ids.map((id) => getEntry(id)).filter((e): e is Entry => e !== null);
}

export function updateEntry(id: number, patch: Partial<FoodItem> & { meal?: Meal }): Entry | null {
  const current = getEntry(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  getDb().runSync(
    `UPDATE entries SET meal = ?, name = ?, portion = ?, calories = ?, protein = ?, carbs = ?, fat = ? WHERE id = ?`,
    next.meal,
    next.name,
    next.portion,
    next.calories,
    next.protein,
    next.carbs,
    next.fat,
    id,
  );
  return getEntry(id);
}

export function setEntryHealthId(id: number, hcRecordId: string | null) {
  getDb().runSync('UPDATE entries SET hc_record_id = ? WHERE id = ?', hcRecordId, id);
}

/** Entries not yet written to Health Connect, from a date onwards. */
export function getUnsyncedEntries(fromDate: string): Entry[] {
  return getDb()
    .getAllSync<EntryRow>('SELECT * FROM entries WHERE hc_record_id IS NULL AND date >= ? ORDER BY id', fromDate)
    .map(toEntry);
}

export function deleteEntryRow(id: number): Entry | null {
  const entry = getEntry(id);
  if (entry) getDb().runSync('DELETE FROM entries WHERE id = ?', id);
  return entry;
}

// ---------- exercise ----------

interface ExerciseRow {
  id: number;
  date: string;
  activity: Activity;
  minutes: number;
  intensity: Intensity;
  calories: number;
  created_at: number;
  hc_session_id: string | null;
  hc_calories_id: string | null;
}

function toExercise(r: ExerciseRow): Exercise {
  return {
    id: r.id,
    date: r.date,
    activity: r.activity,
    minutes: r.minutes,
    intensity: r.intensity,
    calories: r.calories,
    createdAt: r.created_at,
    hcSessionId: r.hc_session_id,
    hcCaloriesId: r.hc_calories_id,
  };
}

export function getExercisesForDate(date: string): Exercise[] {
  return getDb()
    .getAllSync<ExerciseRow>('SELECT * FROM exercises WHERE date = ? ORDER BY created_at, id', date)
    .map(toExercise);
}

export function getExercise(id: number): Exercise | null {
  const row = getDb().getFirstSync<ExerciseRow>('SELECT * FROM exercises WHERE id = ?', id);
  return row ? toExercise(row) : null;
}

/**
 * The workout that was logged most recently, whatever day it was logged for, or null when there
 * is none. A new workout starts from it, so repeating the usual session is open the sheet, save.
 */
export function getLatestExercise(): Exercise | null {
  const row = getDb().getFirstSync<ExerciseRow>('SELECT * FROM exercises ORDER BY id DESC LIMIT 1');
  return row ? toExercise(row) : null;
}

export function getDayExerciseCalories(date: string): number {
  const row = getDb().getFirstSync<{ total: number }>('SELECT COALESCE(SUM(calories),0) AS total FROM exercises WHERE date = ?', date);
  return row?.total ?? 0;
}

export interface DayExerciseSummary {
  date: string;
  /** Active calories burned in logged workouts that day. */
  calories: number;
  minutes: number;
  /** Number of workouts. */
  count: number;
}

/** Workout totals for each day that has one, oldest first, between two dates inclusive. */
export function getDailyExerciseSummary(fromDate: string, toDate: string): DayExerciseSummary[] {
  return getDb().getAllSync<DayExerciseSummary>(
    `SELECT date, SUM(calories) AS calories, SUM(minutes) AS minutes, COUNT(*) AS count
       FROM exercises WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date`,
    fromDate,
    toDate,
  );
}

/** Every workout between two dates inclusive, oldest first. */
export function getExercisesBetween(fromDate: string, toDate: string): Exercise[] {
  return getDb()
    .getAllSync<ExerciseRow>('SELECT * FROM exercises WHERE date BETWEEN ? AND ? ORDER BY date, created_at, id', fromDate, toDate)
    .map(toExercise);
}

/** The day of the first logged workout, or null when there is none. */
export function getFirstExerciseDate(): string | null {
  return getDb().getFirstSync<{ date: string | null }>('SELECT MIN(date) AS date FROM exercises')?.date ?? null;
}

/** Every workout, oldest first (for the backup file). */
export function getAllExercises(): Exercise[] {
  return getDb().getAllSync<ExerciseRow>('SELECT * FROM exercises ORDER BY id').map(toExercise);
}

export function insertExercise(input: NewExercise, now: number = Date.now()): Exercise | null {
  const res = getDb().runSync(
    'INSERT INTO exercises (date, activity, minutes, intensity, calories, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    input.date,
    input.activity,
    input.minutes,
    input.intensity,
    input.calories,
    now,
  );
  return getExercise(res.lastInsertRowId);
}

export function updateExerciseRow(id: number, patch: Partial<NewExercise>): Exercise | null {
  const current = getExercise(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  getDb().runSync(
    'UPDATE exercises SET activity = ?, minutes = ?, intensity = ?, calories = ? WHERE id = ?',
    next.activity,
    next.minutes,
    next.intensity,
    next.calories,
    id,
  );
  return getExercise(id);
}

export function setExerciseHealthIds(id: number, sessionId: string | null, caloriesId: string | null) {
  getDb().runSync('UPDATE exercises SET hc_session_id = ?, hc_calories_id = ? WHERE id = ?', sessionId, caloriesId, id);
}

export function deleteExerciseRow(id: number): Exercise | null {
  const ex = getExercise(id);
  if (ex) getDb().runSync('DELETE FROM exercises WHERE id = ?', id);
  return ex;
}

/** Workouts not yet written to Health Connect, from a date onwards. */
export function getUnsyncedExercises(fromDate: string): Exercise[] {
  return getDb()
    .getAllSync<ExerciseRow>('SELECT * FROM exercises WHERE hc_session_id IS NULL AND date >= ? ORDER BY id', fromDate)
    .map(toExercise);
}

// ---------- weight ----------

interface WeightRow {
  id: number;
  date: string;
  kg: number;
  source: WeightSource;
  created_at: number;
  hc_record_id: string | null;
}

function toWeight(r: WeightRow): WeightEntry {
  return { id: r.id, date: r.date, kg: r.kg, source: r.source, createdAt: r.created_at, hcRecordId: r.hc_record_id };
}

/** The weigh-in for a day, or null. */
export function getWeight(date: string): WeightEntry | null {
  const row = getDb().getFirstSync<WeightRow>('SELECT * FROM weights WHERE date = ?', date);
  return row ? toWeight(row) : null;
}

/** The most recent weigh-in, optionally no later than a given day. */
export function getLatestWeight(onOrBefore?: string): WeightEntry | null {
  const row = onOrBefore
    ? getDb().getFirstSync<WeightRow>('SELECT * FROM weights WHERE date <= ? ORDER BY date DESC LIMIT 1', onOrBefore)
    : getDb().getFirstSync<WeightRow>('SELECT * FROM weights ORDER BY date DESC LIMIT 1');
  return row ? toWeight(row) : null;
}

/** Weigh-ins between two dates inclusive, oldest first. */
export function getWeightsBetween(fromDate: string, toDate: string): WeightEntry[] {
  return getDb()
    .getAllSync<WeightRow>('SELECT * FROM weights WHERE date BETWEEN ? AND ? ORDER BY date', fromDate, toDate)
    .map(toWeight);
}

/** Every weigh-in, oldest first. At most one row per day, so this stays small. */
export function getAllWeights(): WeightEntry[] {
  return getDb().getAllSync<WeightRow>('SELECT * FROM weights ORDER BY date').map(toWeight);
}

/**
 * Save the weigh-in for a day, replacing an earlier one that day. The Health Connect id is reset
 * to whatever is passed (null for a manual weigh-in that has not been written out yet).
 */
export function upsertWeight(
  date: string,
  kg: number,
  source: WeightSource = 'manual',
  now: number = Date.now(),
  hcRecordId: string | null = null,
): WeightEntry | null {
  getDb().runSync(
    `INSERT INTO weights (date, kg, source, created_at, hc_record_id) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       kg = excluded.kg, source = excluded.source, created_at = excluded.created_at, hc_record_id = excluded.hc_record_id`,
    date,
    kg,
    source,
    now,
    hcRecordId,
  );
  return getWeight(date);
}

export function setWeightHealthId(date: string, hcRecordId: string | null) {
  getDb().runSync('UPDATE weights SET hc_record_id = ? WHERE date = ?', hcRecordId, date);
}

export function deleteWeightRow(date: string): WeightEntry | null {
  const weight = getWeight(date);
  if (weight) getDb().runSync('DELETE FROM weights WHERE date = ?', date);
  return weight;
}

/** Manual weigh-ins not yet written to Health Connect, from a date onwards. Imported ones never go back out. */
export function getUnsyncedWeights(fromDate: string): WeightEntry[] {
  return getDb()
    .getAllSync<WeightRow>(
      "SELECT * FROM weights WHERE source = 'manual' AND hc_record_id IS NULL AND date >= ? ORDER BY date",
      fromDate,
    )
    .map(toWeight);
}

// ---------- saved foods (favourites + the user's corrected values) ----------

interface FoodRow {
  id: number;
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  pinned: number;
  use_count: number;
  last_used_at: number;
}

function toFood(r: FoodRow): SavedFood {
  return {
    id: r.id,
    name: r.name,
    portion: r.portion,
    calories: r.calories,
    protein: r.protein,
    carbs: r.carbs,
    fat: r.fat,
    pinned: r.pinned === 1,
    useCount: r.use_count,
    lastUsedAt: r.last_used_at,
  };
}

/**
 * Remember a food the user logged. The latest values win, so when the user corrects
 * an AI estimate, the correction is what gets reused next time.
 */
export function recordFoodUse(item: FoodItem, now: number = Date.now(), countUse = true) {
  getDb().runSync(
    `INSERT INTO foods (food_key, name, portion, calories, protein, carbs, fat, use_count, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(food_key) DO UPDATE SET
       name = excluded.name, portion = excluded.portion, calories = excluded.calories,
       protein = excluded.protein, carbs = excluded.carbs, fat = excluded.fat,
       use_count = foods.use_count + excluded.use_count, last_used_at = excluded.last_used_at`,
    foodKey(item.name, item.portion),
    item.name,
    item.portion,
    item.calories,
    item.protein,
    item.carbs,
    item.fat,
    countUse ? 1 : 0,
    now,
  );
}

export function getFood(id: number): SavedFood | null {
  const row = getDb().getFirstSync<FoodRow>('SELECT * FROM foods WHERE id = ?', id);
  return row ? toFood(row) : null;
}

export function findFood(name: string, portion: string): SavedFood | null {
  const row = getDb().getFirstSync<FoodRow>('SELECT * FROM foods WHERE food_key = ?', foodKey(name, portion));
  return row ? toFood(row) : null;
}

/** Pinned foods first, then foods logged at least twice, most used first. */
export function getFavourites(limit = 8): SavedFood[] {
  return getDb()
    .getAllSync<FoodRow>(
      `SELECT * FROM foods WHERE pinned = 1 OR use_count >= 2
        ORDER BY pinned DESC, use_count DESC, last_used_at DESC LIMIT ?`,
      limit,
    )
    .map(toFood);
}

/** Foods worth telling the AI about: recently and frequently used. */
export function getKnownFoods(limit = 40): SavedFood[] {
  return getDb()
    .getAllSync<FoodRow>('SELECT * FROM foods ORDER BY pinned DESC, use_count DESC, last_used_at DESC LIMIT ?', limit)
    .map(toFood);
}

export function getAllFoods(): SavedFood[] {
  return getDb()
    .getAllSync<FoodRow>('SELECT * FROM foods ORDER BY pinned DESC, use_count DESC, name')
    .map(toFood);
}

export function setFoodPinned(id: number, pinned: boolean) {
  getDb().runSync('UPDATE foods SET pinned = ? WHERE id = ?', pinned ? 1 : 0, id);
}

export function deleteFood(id: number) {
  getDb().runSync('DELETE FROM foods WHERE id = ?', id);
}

// ---------- key/value ----------

export function kvGet<T>(key: string): T | null {
  const row = getDb().getFirstSync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function kvSet(key: string, value: unknown) {
  getDb().runSync(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}

// ---------- restore ----------

export interface AllData {
  entries: readonly Entry[];
  foods: readonly SavedFood[];
  exercises: readonly Exercise[];
  weights: readonly WeightEntry[];
  /** Rows for the key/value table, already JSON-serialisable (settings live here). */
  kv: Readonly<Record<string, unknown>>;
}

/**
 * Replace everything in the database with the given rows, in ONE transaction: if any row fails,
 * nothing changes. Row ids are kept. Callers validate first and call notifyChanged() afterwards.
 */
export function replaceAllData(data: AllData): void {
  const database = getDb();
  /** Prepare once, run for every row. */
  const insertAll = <T>(sql: string, rows: readonly T[], params: (row: T) => (string | number | null)[]) => {
    if (rows.length === 0) return;
    const statement = database.prepareSync(sql);
    try {
      for (const row of rows) statement.executeSync(params(row));
    } finally {
      statement.finalizeSync();
    }
  };
  database.withTransactionSync(() => {
    // The id counters (sqlite_sequence) are left alone on purpose: new rows keep getting ids above
    // any this phone has used, so a Health Connect client id like "entry-121" is never reused.
    database.execSync('DELETE FROM entries; DELETE FROM foods; DELETE FROM exercises; DELETE FROM weights; DELETE FROM kv;');
    insertAll(
      `INSERT INTO entries (id, date, meal, name, portion, calories, protein, carbs, fat, source, created_at, hc_record_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.entries,
      (e) => [e.id, e.date, e.meal, e.name, e.portion, e.calories, e.protein, e.carbs, e.fat, e.source, e.createdAt, e.hcRecordId],
    );
    // Oldest use first, so that when two rows turn out to be the same food the latest values win.
    insertAll(
      `INSERT INTO foods (id, food_key, name, portion, calories, protein, carbs, fat, pinned, use_count, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(food_key) DO UPDATE SET
         name = excluded.name, portion = excluded.portion, calories = excluded.calories,
         protein = excluded.protein, carbs = excluded.carbs, fat = excluded.fat,
         pinned = MAX(foods.pinned, excluded.pinned),
         use_count = foods.use_count + excluded.use_count, last_used_at = excluded.last_used_at`,
      [...data.foods].sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.id - b.id),
      (f) => [f.id, foodKey(f.name, f.portion), f.name, f.portion, f.calories, f.protein, f.carbs, f.fat, f.pinned ? 1 : 0, f.useCount, f.lastUsedAt],
    );
    insertAll(
      `INSERT INTO exercises (id, date, activity, minutes, intensity, calories, created_at, hc_session_id, hc_calories_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.exercises,
      (x) => [x.id, x.date, x.activity, x.minutes, x.intensity, x.calories, x.createdAt, x.hcSessionId, x.hcCaloriesId],
    );
    insertAll(
      'INSERT INTO weights (id, date, kg, source, created_at, hc_record_id) VALUES (?, ?, ?, ?, ?, ?)',
      data.weights,
      (w) => [w.id, w.date, w.kg, w.source, w.createdAt, w.hcRecordId],
    );
    insertAll('INSERT INTO kv (key, value) VALUES (?, ?)', Object.entries(data.kv), ([key, value]) => [key, JSON.stringify(value)]);
  });
}
