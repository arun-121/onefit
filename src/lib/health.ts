/**
 * Health Connect (Android). Writes each logged food as a Nutrition record, each workout as an
 * ExerciseSession plus ActiveCaloriesBurned and each weigh-in as a Weight record, which is how
 * they reach Google Fit; reads steps and other apps' active calories for the Today screen, and
 * other apps' weigh-ins (a smart scale, Google Fit). Every grant is optional.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  aggregateRecord,
  deleteRecordsByUuids,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  insertRecords,
  MealType,
  openHealthConnectSettings,
  readRecords,
  RecordingMethod,
  requestPermission,
  SdkAvailabilityStatus,
  type Permission,
} from 'react-native-health-connect';

import { dateKeyToDate, dayRange, MEAL_DEFAULT_HOUR, toDateKey } from './dates';
import { ACTIVITIES, exerciseTitle } from './exercise';
import type { Entry, Exercise, Meal, WeightEntry } from './types';
import { isValidWeightKg, type HealthWeightSample } from './weight';

export const HEALTH_PERMISSIONS: Permission[] = [
  { accessType: 'write', recordType: 'Nutrition' },
  { accessType: 'write', recordType: 'ExerciseSession' },
  { accessType: 'write', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'write', recordType: 'Weight' },
  { accessType: 'read', recordType: 'Weight' },
];

/** This app's package; its own workouts are skipped when reading active calories back. */
const OWN_PACKAGE = Constants.expoConfig?.android?.package ?? 'com.calorietracker.app';

export type HealthAvailability = 'available' | 'needs_update' | 'unavailable';

const MEAL_TYPE: Record<Meal, number> = {
  breakfast: MealType.BREAKFAST,
  lunch: MealType.LUNCH,
  dinner: MealType.DINNER,
  snack: MealType.SNACK,
};

let initialized = false;

async function ensureInit(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (!initialized) initialized = await initialize();
  return initialized;
}

export async function getHealthAvailability(): Promise<HealthAvailability> {
  if (Platform.OS !== 'android') return 'unavailable';
  try {
    const status = await getSdkStatus();
    if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'needs_update';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export interface HealthGrants {
  writeNutrition: boolean;
  writeExercise: boolean;
  readSteps: boolean;
  readActiveCalories: boolean;
  /** Weigh-ins logged here can be written to Health Connect. */
  writeWeight: boolean;
  /** Weigh-ins made by other apps can be read. */
  readWeight: boolean;
}

/** What the app may do when Health Connect is missing or nothing has been allowed. */
export const NO_HEALTH_GRANTS: HealthGrants = {
  writeNutrition: false,
  writeExercise: false,
  readSteps: false,
  readActiveCalories: false,
  writeWeight: false,
  readWeight: false,
};

function toGrants(granted: { accessType: string; recordType: string }[]): HealthGrants {
  const has = (accessType: string, recordType: string) =>
    granted.some((p) => p.accessType === accessType && p.recordType === recordType);
  return {
    writeNutrition: has('write', 'Nutrition'),
    writeExercise: has('write', 'ExerciseSession') && has('write', 'ActiveCaloriesBurned'),
    readSteps: has('read', 'Steps'),
    readActiveCalories: has('read', 'ActiveCaloriesBurned'),
    writeWeight: has('write', 'Weight'),
    readWeight: has('read', 'Weight'),
  };
}

export async function requestHealthPermissions(): Promise<HealthGrants> {
  if (!(await ensureInit())) throw new Error('Health Connect is not available on this phone.');
  const granted = await requestPermission(HEALTH_PERMISSIONS);
  return toGrants(granted);
}

export async function getHealthGrants(): Promise<HealthGrants> {
  if (!(await ensureInit())) return { ...NO_HEALTH_GRANTS };
  return toGrants(await getGrantedPermissions());
}

export function openHealthSettings() {
  if (Platform.OS === 'android') openHealthConnectSettings();
}

/** When the food was eaten: the log time for today's entries, a typical meal time for past days. */
function entryTime(entry: Entry): Date {
  const logged = new Date(entry.createdAt);
  if (toDateKey(logged) === entry.date) return logged;
  const d = dateKeyToDate(entry.date);
  d.setHours(MEAL_DEFAULT_HOUR[entry.meal], 0, 0, 0);
  return d;
}

/** Write one entry as a Nutrition record. Returns the Health Connect record id. */
export async function writeNutrition(entry: Entry): Promise<string | null> {
  if (!(await ensureInit())) return null;
  const start = entryTime(entry);
  const end = new Date(start.getTime() + 60_000);
  const [id] = await insertRecords([
    {
      recordType: 'Nutrition',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      name: entry.portion ? `${entry.name} (${entry.portion})` : entry.name,
      mealType: MEAL_TYPE[entry.meal],
      energy: { value: Math.max(0, entry.calories), unit: 'kilocalories' },
      protein: { value: Math.max(0, entry.protein), unit: 'grams' },
      totalCarbohydrate: { value: Math.max(0, entry.carbs), unit: 'grams' },
      totalFat: { value: Math.max(0, entry.fat), unit: 'grams' },
      metadata: { clientRecordId: `entry-${entry.id}`, recordingMethod: RecordingMethod.RECORDING_METHOD_MANUAL_ENTRY },
    },
  ]);
  return id ?? null;
}

export async function deleteNutrition(recordId: string): Promise<void> {
  if (!(await ensureInit())) return;
  await deleteRecordsByUuids('Nutrition', [recordId], []);
}

export interface DayActivity {
  steps: number;
  activeCalories: number;
}

export async function readDayActivity(date: string, grants: HealthGrants): Promise<DayActivity> {
  const result: DayActivity = { steps: 0, activeCalories: 0 };
  if (!(await ensureInit())) return result;
  const { start, end } = dayRange(date);
  const timeRangeFilter = { operator: 'between' as const, startTime: start.toISOString(), endTime: end.toISOString() };
  if (grants.readSteps) {
    const steps = await aggregateRecord({ recordType: 'Steps', timeRangeFilter });
    result.steps = steps.COUNT_TOTAL ?? 0;
  }
  if (grants.readActiveCalories) {
    // Sum other apps' records only: workouts logged here are already counted from the local log.
    let pageToken: string | undefined;
    let total = 0;
    do {
      const page = await readRecords('ActiveCaloriesBurned', { timeRangeFilter, ...(pageToken ? { pageToken } : {}) });
      for (const r of page.records) {
        if (r.metadata?.dataOrigin === OWN_PACKAGE) continue;
        total += r.energy?.inKilocalories ?? 0;
      }
      pageToken = page.pageToken || undefined;
    } while (pageToken);
    result.activeCalories = Math.round(total);
  }
  return result;
}

/** Write a workout as an exercise session plus its active calories. Returns both record ids. */
export async function writeExercise(ex: Exercise): Promise<{ sessionId: string | null; caloriesId: string | null }> {
  if (!(await ensureInit())) return { sessionId: null, caloriesId: null };
  const end = new Date(ex.createdAt);
  const logged = toDateKey(end) === ex.date;
  // Logged today: assume it just finished. Logged for a past day: place it mid-afternoon.
  const endTime = logged ? end : (() => {
    const d = dateKeyToDate(ex.date);
    d.setHours(17, 0, 0, 0);
    return d;
  })();
  const startTime = new Date(endTime.getTime() - Math.max(1, ex.minutes) * 60_000);
  const meta = (suffix: string) => ({
    clientRecordId: `exercise-${ex.id}-${suffix}`,
    recordingMethod: RecordingMethod.RECORDING_METHOD_MANUAL_ENTRY,
  });
  // Health Connect takes one record type per insert call, so the session and its calories go separately.
  const [sessionId] = await insertRecords([
    {
      recordType: 'ExerciseSession',
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      exerciseType: ACTIVITIES[ex.activity].healthType,
      title: exerciseTitle(ex),
      metadata: meta('session'),
    },
  ]);
  try {
    const [caloriesId] = await insertRecords([
      {
        recordType: 'ActiveCaloriesBurned',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        energy: { value: Math.max(0, ex.calories), unit: 'kilocalories' },
        metadata: meta('calories'),
      },
    ]);
    return { sessionId: sessionId ?? null, caloriesId: caloriesId ?? null };
  } catch (e) {
    // Don't leave a session without its calories; the next backfill retries both.
    if (sessionId) await deleteRecordsByUuids('ExerciseSession', [sessionId], []).catch(() => {});
    throw e;
  }
}

export async function deleteExerciseRecords(sessionId: string | null, caloriesId: string | null): Promise<void> {
  if (!(await ensureInit())) return;
  if (sessionId) await deleteRecordsByUuids('ExerciseSession', [sessionId], []);
  if (caloriesId) await deleteRecordsByUuids('ActiveCaloriesBurned', [caloriesId], []);
}

// ---------------------------------------------------------------- weight

/** When the weigh-in happened: the log time for today's, early morning for one entered for a past day. */
function weighInTime(weight: WeightEntry): Date {
  const logged = new Date(weight.createdAt);
  if (toDateKey(logged) === weight.date) return logged;
  const d = dateKeyToDate(weight.date);
  d.setHours(7, 0, 0, 0);
  // Health Connect has no use for a measurement from the future.
  return d.getTime() > Date.now() ? new Date() : d;
}

/**
 * Write one weigh-in as a Weight record. Returns the Health Connect record id.
 * The client id is the day, and the version is the time it was logged, so a later weigh-in for
 * the same day replaces the earlier record even if deleting that one failed.
 */
export async function writeWeight(weight: WeightEntry): Promise<string | null> {
  if (!(await ensureInit())) return null;
  const [id] = await insertRecords([
    {
      recordType: 'Weight',
      time: weighInTime(weight).toISOString(),
      weight: { value: weight.kg, unit: 'kilograms' },
      metadata: {
        clientRecordId: `weight-${weight.date}`,
        clientRecordVersion: weight.createdAt,
        recordingMethod: RecordingMethod.RECORDING_METHOD_MANUAL_ENTRY,
      },
    },
  ]);
  return id ?? null;
}

export async function deleteWeightRecord(recordId: string): Promise<void> {
  if (!(await ensureInit())) return;
  await deleteRecordsByUuids('Weight', [recordId], []);
}

/**
 * Weigh-ins made by other apps between two days inclusive, oldest first. Records this app wrote
 * are left out, as readDayActivity does, so a manual weigh-in never comes back as an import.
 * Health Connect only returns what the user has allowed, which by default reaches back 30 days
 * from the first grant.
 */
export async function readHealthWeights(fromDate: string, toDate: string): Promise<HealthWeightSample[]> {
  const samples: HealthWeightSample[] = [];
  if (!(await ensureInit())) return samples;
  const timeRangeFilter = {
    operator: 'between' as const,
    startTime: dayRange(fromDate).start.toISOString(),
    endTime: dayRange(toDate).end.toISOString(),
  };
  let pageToken: string | undefined;
  do {
    const page = await readRecords('Weight', { timeRangeFilter, ascendingOrder: true, ...(pageToken ? { pageToken } : {}) });
    for (const r of page.records) {
      if (r.metadata?.dataOrigin === OWN_PACKAGE) continue;
      const recordId = r.metadata?.id;
      const kg = r.weight?.inKilograms;
      const time = Date.parse(r.time);
      if (!recordId || !isValidWeightKg(kg) || !Number.isFinite(time)) continue;
      samples.push({ recordId, time, date: toDateKey(new Date(time)), kg });
    }
    pageToken = page.pageToken || undefined;
  } while (pageToken);
  return samples;
}

/** The record types this app writes. */
export type OwnRecordType = 'Nutrition' | 'ExerciseSession' | 'ActiveCaloriesBurned' | 'Weight';

/**
 * Delete records this app wrote, by Health Connect id. Best effort: ids that are already gone
 * are skipped, so one stale id does not stop the rest.
 */
export async function deleteOwnRecords(recordType: OwnRecordType, recordIds: readonly string[]): Promise<void> {
  if (recordIds.length === 0 || !(await ensureInit())) return;
  const CHUNK = 50;
  for (let i = 0; i < recordIds.length; i += CHUNK) {
    const chunk = recordIds.slice(i, i + CHUNK);
    try {
      await deleteRecordsByUuids(recordType, chunk, []);
    } catch {
      // Health Connect deletes all or nothing, so find the ones that can still be deleted.
      for (const id of chunk) await deleteRecordsByUuids(recordType, [id], []).catch(() => {});
    }
  }
}
