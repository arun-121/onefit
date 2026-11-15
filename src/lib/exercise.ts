/**
 * Exercise catalogue and calorie maths. Pure (no native code) so it is easy to test.
 *
 * Calories burned = (MET − 1) × weight (kg) × hours. Subtracting 1 MET removes the resting
 * burn that's already part of the daily goal, so this matches "active calories" as Google Fit
 * and Health Connect count them. MET values are from the Compendium of Physical Activities.
 */
export type Activity = 'walk' | 'run' | 'cycle' | 'strength' | 'yoga' | 'swim' | 'sport' | 'other';
export type Intensity = 'light' | 'moderate' | 'hard';

export const ACTIVITY_ORDER: Activity[] = ['walk', 'run', 'cycle', 'strength', 'yoga', 'swim', 'sport', 'other'];
export const INTENSITY_ORDER: Intensity[] = ['light', 'moderate', 'hard'];

export const INTENSITY_LABELS: Record<Intensity, string> = { light: 'Light', moderate: 'Moderate', hard: 'Hard' };

/** Health Connect ExerciseType constants (react-native-health-connect ExerciseType). */
const HC = { OTHER_WORKOUT: 0, BIKING: 8, RUNNING: 56, SOCCER: 64, STRENGTH_TRAINING: 70, SWIMMING_POOL: 74, WALKING: 79, YOGA: 83 };

export const ACTIVITIES: Record<Activity, { label: string; icon: string; met: Record<Intensity, number>; healthType: number }> = {
  walk: { label: 'Walk', icon: 'walk', met: { light: 2.8, moderate: 3.5, hard: 5.0 }, healthType: HC.WALKING },
  run: { label: 'Run', icon: 'run', met: { light: 7.0, moderate: 9.8, hard: 11.5 }, healthType: HC.RUNNING },
  cycle: { label: 'Cycle', icon: 'bike', met: { light: 4.0, moderate: 6.8, hard: 10.0 }, healthType: HC.BIKING },
  strength: { label: 'Strength', icon: 'dumbbell', met: { light: 3.5, moderate: 5.0, hard: 6.0 }, healthType: HC.STRENGTH_TRAINING },
  yoga: { label: 'Yoga', icon: 'yoga', met: { light: 2.5, moderate: 3.0, hard: 4.0 }, healthType: HC.YOGA },
  swim: { label: 'Swim', icon: 'swim', met: { light: 6.0, moderate: 8.3, hard: 10.0 }, healthType: HC.SWIMMING_POOL },
  sport: { label: 'Sport', icon: 'soccer', met: { light: 4.0, moderate: 6.0, hard: 8.0 }, healthType: HC.SOCCER },
  other: { label: 'Other', icon: 'lightning-bolt', met: { light: 3.0, moderate: 5.0, hard: 7.0 }, healthType: HC.OTHER_WORKOUT },
};

/** Used when the profile has no weight yet. */
export const DEFAULT_WEIGHT_KG = 70;

export function estimateBurn(activity: Activity, intensity: Intensity, minutes: number, weightKg: number): number {
  return burnFromMet(ACTIVITIES[activity].met[intensity], minutes, weightKg);
}

/** Active calories for a MET held for `minutes`: (MET − 1) × kg × hours. */
export function burnFromMet(met: number, minutes: number, weightKg: number): number {
  const kg = weightKg > 0 ? weightKg : DEFAULT_WEIGHT_KG;
  const hours = Math.max(0, minutes) / 60;
  return Math.max(0, Math.round((met - 1) * kg * hours));
}

/** A workout's name: what the owner called it, or the activity's label for one logged by picking. */
export function exerciseTitle(ex: { activity: Activity; name?: string }): string {
  return ex.name?.trim() || ACTIVITIES[ex.activity]?.label || 'Workout';
}

/** The line under a workout's name: what was done, then how long. */
export function exerciseDetailLine(ex: { details?: string; minutes: number; intensity: Intensity }): string {
  const what = ex.details?.trim();
  return what ? `${what}, ${formatMinutes(ex.minutes)}` : `${formatMinutes(ex.minutes)}, ${INTENSITY_LABELS[ex.intensity].toLowerCase()}`;
}

export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function isActivity(v: unknown): v is Activity {
  return typeof v === 'string' && (ACTIVITY_ORDER as string[]).includes(v);
}

export function isIntensity(v: unknown): v is Intensity {
  return typeof v === 'string' && (INTENSITY_ORDER as string[]).includes(v);
}
