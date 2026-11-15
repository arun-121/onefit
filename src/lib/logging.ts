/**
 * Every change to the food, exercise and weight logs goes through here so that the database,
 * Health Connect, the home-screen widget and today's reminders stay in step. Used by both the
 * app and the widget's background task.
 */
import { addDays, isDateKey, mealForTime, todayKey } from './dates';
import {
  deleteEntryRow,
  deleteExerciseRow,
  deleteWeightRow,
  getEntriesForMeal,
  getEntry,
  getExercise,
  getLatestWeight,
  getUnsyncedEntries,
  getUnsyncedExercises,
  getUnsyncedWeights,
  getWeight,
  getWeightsBetween,
  insertEntries,
  insertExercise,
  kvGet,
  kvSet,
  notifyChanged,
  recordFoodUse,
  setEntryHealthId,
  setExerciseHealthIds,
  setWeightHealthId,
  updateEntry,
  updateExerciseRow,
  upsertWeight,
} from './db';
import {
  deleteExerciseRecords,
  deleteNutrition,
  deleteWeightRecord,
  getHealthGrants,
  readHealthWeights,
  writeExercise,
  writeNutrition,
  writeWeight,
  type HealthGrants,
} from './health';
import { cancelReminder, cancelWeighInReminder, keepRemindersAhead, refreshHeadsUp, rescheduleReminders } from './reminders';
import { getSettings, updateSettings, type Settings } from './settings';
import type { Entry, EntrySource, Exercise, FoodItem, Meal, NewExercise, SavedFood, WeightEntry } from './types';
import { isValidWeightKg, planWeightImport, roundKg, type WeightImport } from './weight';
import { refreshWidgets } from '../widget/refresh';

/** Every change to the logs: screens re-read, and tomorrow's heads-up is worked out again. */
function changed() {
  notifyChanged();
  void refreshHeadsUp();
}

/** How far back to backfill Health Connect when it is switched on or the app opens. */
const HEALTH_BACKFILL_DAYS = 7;
/** How far back to look for other apps' weigh-ins: the longest period Progress shows. */
const HEALTH_WEIGHT_IMPORT_DAYS = 90;

async function writeToHealth(entries: Entry[]) {
  if (!getSettings().healthConnectEnabled) return;
  for (const entry of entries) {
    try {
      const id = await writeNutrition(entry);
      if (id) setEntryHealthId(entry.id, id);
    } catch (e) {
      console.warn('Health Connect write failed', e);
      return; // Permission is probably missing; the next sync will retry.
    }
  }
}

async function removeFromHealth(recordId: string | null) {
  if (!recordId) return;
  try {
    await deleteNutrition(recordId);
  } catch (e) {
    console.warn('Health Connect delete failed', e);
  }
}

export interface LogInput {
  date: string;
  meal: Meal;
  items: readonly FoodItem[];
  source: EntrySource;
}

export async function logFoods({ date, meal, items, source }: LogInput): Promise<Entry[]> {
  const clean = items
    .map((i) => ({ ...i, name: i.name.trim(), portion: i.portion.trim() }))
    .filter((i) => i.name.length > 0);
  if (clean.length === 0) return [];

  const entries = insertEntries(date, meal, clean, source);
  clean.forEach((item) => recordFoodUse(item));
  changed();

  // A log from the widget may be the only sign of life for days, so the first one each day also
  // rebuilds the reminders: the week ahead stays covered and the come-back reminders move on.
  await Promise.allSettled([writeToHealth(entries), refreshWidgets(), cancelReminder(meal, date), keepRemindersAhead()]);
  return entries;
}

export function logFavourite(food: SavedFood, date: string = todayKey(), meal: Meal = mealForTime()) {
  const { name, portion, calories, protein, carbs, fat } = food;
  return logFoods({ date, meal, items: [{ name, portion, calories, protein, carbs, fat }], source: 'favourite' });
}

/** Copy one meal from another day. Returns how many items were copied (0 if that meal was empty). */
export async function copyMeal(fromDate: string, meal: Meal, toDate: string): Promise<number> {
  const source = getEntriesForMeal(fromDate, meal);
  if (source.length === 0) return 0;
  const items = source.map(({ name, portion, calories, protein, carbs, fat }) => ({ name, portion, calories, protein, carbs, fat }));
  await logFoods({ date: toDate, meal, items, source: 'copy' });
  return items.length;
}

export function copyMealFromYesterday(meal: Meal, date: string = todayKey()) {
  return copyMeal(addDays(date, -1), meal, date);
}

/** Edit an entry. The new values are also remembered so the AI reuses the correction next time. */
export async function editEntry(id: number, patch: Partial<FoodItem> & { meal?: Meal }): Promise<Entry | null> {
  const before = getEntry(id);
  const after = updateEntry(id, patch);
  if (!before || !after) return null;
  recordFoodUse(after, Date.now(), false);
  changed();

  if (getSettings().healthConnectEnabled) {
    await removeFromHealth(before.hcRecordId);
    setEntryHealthId(id, null);
    await writeToHealth([after]);
  }
  await refreshWidgets();
  return getEntry(id);
}

export async function deleteEntries(ids: readonly number[]): Promise<Entry[]> {
  const removed = ids.map((id) => deleteEntryRow(id)).filter((e): e is Entry => e !== null);
  if (removed.length === 0) return [];
  changed();
  for (const e of removed) await removeFromHealth(e.hcRecordId);
  await refreshWidgets();
  // A meal may be empty again, so its reminder should come back.
  if (removed.some((e) => e.date === todayKey())) await rescheduleReminders();
  return removed;
}

// ---------------------------------------------------------------- exercise

async function writeExercisesToHealth(exercises: Exercise[]) {
  if (!getSettings().healthConnectEnabled) return;
  for (const ex of exercises) {
    try {
      const ids = await writeExercise(ex);
      if (ids.sessionId) setExerciseHealthIds(ex.id, ids.sessionId, ids.caloriesId);
    } catch (e) {
      console.warn('Health Connect exercise write failed', e);
      return; // Usually the workout permission hasn't been granted yet; the next sync retries.
    }
  }
}

export async function logExercise(input: NewExercise): Promise<Exercise | null> {
  const ex = insertExercise({ ...input, minutes: Math.max(1, Math.round(input.minutes)), calories: Math.max(0, Math.round(input.calories)) });
  if (!ex) return null;
  changed();
  await Promise.allSettled([writeExercisesToHealth([ex]), refreshWidgets()]);
  return ex;
}

export async function editExercise(id: number, patch: Partial<NewExercise>): Promise<Exercise | null> {
  // Read first so the old Health Connect record ids are still known after the update.
  const before = getExercise(id);
  const after = updateExerciseRow(id, patch);
  if (!before || !after) return null;
  changed();
  if (getSettings().healthConnectEnabled) {
    try {
      await deleteExerciseRecords(before.hcSessionId, before.hcCaloriesId);
    } catch (e) {
      console.warn('Health Connect exercise delete failed', e);
    }
    setExerciseHealthIds(id, null, null);
    await writeExercisesToHealth([after]);
  }
  await refreshWidgets();
  return after;
}

export async function deleteExercise(id: number): Promise<void> {
  const removed = deleteExerciseRow(id);
  if (!removed) return;
  changed();
  try {
    await deleteExerciseRecords(removed.hcSessionId, removed.hcCaloriesId);
  } catch (e) {
    console.warn('Health Connect exercise delete failed', e);
  }
  await refreshWidgets();
}

// ---------------------------------------------------------------- weight

/**
 * Days whose imported weigh-in the user deleted; Health Connect must not bring them back. The list
 * is this phone's own bookkeeping: it is not in a backup, and a restore carries it across.
 */
export const DISMISSED_WEIGHTS_KEY = 'weight_dismissed_dates';

export function getDismissedWeightDates(): string[] {
  const stored = kvGet<unknown>(DISMISSED_WEIGHTS_KEY);
  return Array.isArray(stored) ? stored.filter((d): d is string => typeof d === 'string') : [];
}

function setWeightDismissed(date: string, dismissed: boolean) {
  const cutoff = addDays(todayKey(), -(HEALTH_WEIGHT_IMPORT_DAYS + 7));
  const current = getDismissedWeightDates();
  // Days that have fallen out of the import window can be forgotten.
  const next = current.filter((d) => d !== date && d >= cutoff);
  if (dismissed) next.push(date);
  if (next.length !== current.length || dismissed) kvSet(DISMISSED_WEIGHTS_KEY, next);
}

/**
 * Keep the rest of the app in step with the weigh-ins: exercise estimates use the latest weight
 * (profile.weightKg), and a target weight set before the first weigh-in gets its starting point.
 * Calorie and macro targets are deliberately left alone; Progress suggests recalculating instead.
 */
function applyLatestWeight() {
  const latest = getLatestWeight();
  if (!latest) return;
  const settings = getSettings();
  const patch: Partial<Settings> = {};
  if (settings.profile && Math.abs(settings.profile.weightKg - latest.kg) >= 0.005) {
    patch.profile = { ...settings.profile, weightKg: latest.kg };
    // The profile's weight was, until now, the weight the targets were worked out at. Keep it.
    if (settings.targetsWeightKg === null) patch.targetsWeightKg = settings.profile.weightKg;
  }
  if (settings.weightGoalKg !== null && settings.goalStartWeightKg === null) {
    patch.goalStartDate = latest.date;
    patch.goalStartWeightKg = latest.kg;
  }
  if (Object.keys(patch).length > 0) updateSettings(patch);
}

async function healthGrantsOrNull(): Promise<HealthGrants | null> {
  try {
    return await getHealthGrants();
  } catch {
    return null;
  }
}

async function writeWeightsToHealth(weights: WeightEntry[], grants?: HealthGrants | null) {
  if (weights.length === 0 || !getSettings().healthConnectEnabled) return;
  // Weight is its own grant and it is optional, so check instead of failing on every weigh-in.
  const allowed = grants === undefined ? await healthGrantsOrNull() : grants;
  if (!allowed?.writeWeight) return;
  for (const weight of weights) {
    try {
      const id = await writeWeight(weight);
      // The row may have been replaced or deleted while the write was in flight.
      if (id && getWeight(weight.date)?.createdAt === weight.createdAt) setWeightHealthId(weight.date, id);
    } catch (e) {
      console.warn('Health Connect weight write failed', e);
      return; // The next sync retries.
    }
  }
}

/** Remove our own Health Connect record for a weigh-in. Records read from other apps are theirs to keep. */
async function removeWeightFromHealth(weight: WeightEntry | null) {
  if (!weight || weight.source !== 'manual' || !weight.hcRecordId) return;
  try {
    await deleteWeightRecord(weight.hcRecordId);
  } catch (e) {
    console.warn('Health Connect weight delete failed', e);
  }
}

/**
 * Save the weigh-in for a day (a second one that day replaces the first). Returns the saved row,
 * or null when the weight is not between 20 and 400 kg or the day is not a real day up to today.
 * The value is kept to 0.1 kg.
 */
export async function logWeight(date: string, kg: number): Promise<WeightEntry | null> {
  // A weigh-in belongs to a real day that has already begun.
  if (!isValidWeightKg(kg) || !isDateKey(date) || date > todayKey()) return null;
  const before = getWeight(date);
  const saved = upsertWeight(date, roundKg(kg), 'manual');
  if (!saved) return null;
  setWeightDismissed(date, false);
  applyLatestWeight();
  changed();

  await removeWeightFromHealth(before);
  await Promise.allSettled([
    writeWeightsToHealth([saved]),
    refreshWidgets(),
    date === todayKey() ? cancelWeighInReminder(date) : Promise.resolve(),
  ]);
  return getWeight(date);
}

/**
 * Delete the weigh-in for a day. Returns the row that was removed, or null if there was none.
 * Pass that row to `restoreWeight` to undo.
 */
export async function deleteWeight(date: string): Promise<WeightEntry | null> {
  const removed = deleteWeightRow(date);
  if (!removed) return null;
  // A weigh-in read from another app would come straight back on the next sync otherwise.
  if (removed.source === 'health') setWeightDismissed(date, true);
  applyLatestWeight();
  changed();

  await removeWeightFromHealth(removed);
  await refreshWidgets();
  // Today has no weigh-in again, so its reminder should come back.
  if (date === todayKey()) await rescheduleReminders();
  return removed;
}

/**
 * Undo `deleteWeight`: put back exactly the weigh-in it removed. Returns the row now stored for
 * that day, or null when nothing could be saved.
 *
 * A manual weigh-in is logged again (and written to Health Connect again, since deleting it
 * removed our record there). A weigh-in read from another app goes back as it was: the other
 * app's value to two decimals, still marked as theirs, with their record id, and with nothing
 * written to Health Connect, where their record never left. The day is no longer dismissed, so
 * later syncs keep it up to date.
 */
export async function restoreWeight(removed: WeightEntry): Promise<WeightEntry | null> {
  if (removed.source === 'manual') return logWeight(removed.date, removed.kg);

  // Something was logged for that day meanwhile. Leave it: writing over a manual weigh-in here
  // would strand the Health Connect record that belongs to it.
  const present = getWeight(removed.date);
  if (present) return present;

  const saved = upsertWeight(removed.date, removed.kg, 'health', removed.createdAt, removed.hcRecordId);
  if (!saved) return null;
  setWeightDismissed(removed.date, false);
  applyLatestWeight();
  changed();

  await Promise.allSettled([
    refreshWidgets(),
    // Deleting today's weigh-in brought its reminder back; the weigh-in is here again.
    removed.date === todayKey() ? cancelWeighInReminder(removed.date) : Promise.resolve(),
  ]);
  return saved;
}

/**
 * Copy in weigh-ins made by other apps (a smart scale, Google Fit) for days that have no manual
 * entry. Returns how many days were added or updated. Does nothing without the read grant.
 */
export async function importHealthWeights(grants?: HealthGrants | null): Promise<number> {
  if (!getSettings().healthConnectEnabled) return 0;
  const allowed = grants === undefined ? await healthGrantsOrNull() : grants;
  if (!allowed?.readWeight) return 0;
  const today = todayKey();
  const from = addDays(today, -(HEALTH_WEIGHT_IMPORT_DAYS - 1));
  let imports: WeightImport[];
  try {
    const samples = await readHealthWeights(from, today);
    // Read the local rows after the await, so a weigh-in logged meanwhile is not overwritten.
    imports = planWeightImport(getWeightsBetween(from, today), samples, getDismissedWeightDates());
  } catch (e) {
    console.warn('Health Connect weight read failed', e);
    return 0;
  }
  if (imports.length === 0) return 0;
  for (const w of imports) upsertWeight(w.date, w.kg, 'health', Date.now(), w.recordId);
  applyLatestWeight();
  changed();
  if (imports.some((w) => w.date === today)) await cancelWeighInReminder(today);
  return imports.length;
}

/** Write anything from the last week that hasn't reached Health Connect yet, and read other apps' weigh-ins. */
export async function syncHealthBackfill(): Promise<void> {
  if (!getSettings().healthConnectEnabled) return;
  const from = addDays(todayKey(), -HEALTH_BACKFILL_DAYS);
  await writeToHealth(getUnsyncedEntries(from));
  await writeExercisesToHealth(getUnsyncedExercises(from));
  const grants = await healthGrantsOrNull();
  await writeWeightsToHealth(getUnsyncedWeights(from), grants);
  await importHealthWeights(grants);
}
