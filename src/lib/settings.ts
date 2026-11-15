import { todayKey } from './dates';
import { getLatestWeight, kvGet, kvSet, notifyChanged } from './db';
import { DEFAULT_WEIGHT_KG } from './exercise';
import { calculateTargets, type Profile, type Targets } from './nutrition';
import { readSettings, type Settings } from './settings-schema';
import { isValidWeightKg, roundKg } from './weight';

export { DEFAULT_MODELS, DEFAULT_SETTINGS } from './settings-schema';
export type { PortableSettings, ReminderMeal, ReminderSetting, Settings } from './settings-schema';

/** The key the settings live under in the `kv` table. */
export const SETTINGS_KEY = 'settings';

export function getSettings(): Settings {
  return readSettings(kvGet<unknown>(SETTINGS_KEY));
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  // Saving a profile together with a calorie goal means the targets were just worked out from
  // that profile, so remember the weight they were worked out at (see `targetsWeightKg`).
  if (patch.profile && patch.calorieGoal !== undefined && patch.targetsWeightKg === undefined) {
    next.targetsWeightKg = patch.profile.weightKg;
  }
  kvSet(SETTINGS_KEY, next);
  notifyChanged();
  return next;
}

/**
 * Use the targets worked out from a profile: sets the calorie and macro goals, saves the profile,
 * and records the weight they were worked out at so Progress knows when to suggest doing it again.
 */
export function applyCalculatedTargets(profile: Profile): Settings {
  const t = calculateTargets(profile);
  return updateSettings({
    calorieGoal: t.calories,
    proteinGoal: t.protein,
    carbsGoal: t.carbs,
    fatGoal: t.fat,
    profile,
    targetsWeightKg: profile.weightKg,
  });
}

/**
 * Set, change or clear (null) the target weight. Setting or changing it stamps the starting point
 * from the latest weigh-in, so progress is measured from where the owner was when they chose the
 * target. With no weigh-in yet the start stays empty and the first weigh-in fills it in.
 * A weight outside 20 to 400 kg is ignored.
 */
export function setWeightGoal(kg: number | null, today: string = todayKey()): Settings {
  if (kg === null) return updateSettings({ weightGoalKg: null, goalStartDate: null, goalStartWeightKg: null });
  if (!isValidWeightKg(kg)) return getSettings();
  const goal = roundKg(kg);
  const current = getSettings();
  if (current.weightGoalKg === goal && current.goalStartWeightKg !== null) return current;
  const latest = getLatestWeight(today);
  return updateSettings({
    weightGoalKg: goal,
    goalStartDate: latest?.date ?? null,
    goalStartWeightKg: latest?.kg ?? null,
  });
}

/**
 * The body weight to use for exercise estimates: the latest weigh-in, else the weight typed into
 * the targets calculator, else a typical 70 kg.
 */
export function getBodyWeightKg(): number {
  return getLatestWeight()?.kg ?? getSettings().profile?.weightKg ?? DEFAULT_WEIGHT_KG;
}

/**
 * Take a weekly check-in's targets (or, with null, put the check-in off): either way the next one
 * is a week from today. Returns the settings from before, for Undo.
 */
export function finishCheckIn(targets: Targets | null, today: string, currentKg: number | null = null): Settings {
  const before = getSettings();
  updateSettings({
    lastCheckInDate: today,
    ...(targets
      ? {
          calorieGoal: targets.calories,
          proteinGoal: targets.protein,
          carbsGoal: targets.carbs,
          fatGoal: targets.fat,
          ...(currentKg !== null ? { targetsWeightKg: currentKg } : {}),
        }
      : {}),
  });
  return before;
}
