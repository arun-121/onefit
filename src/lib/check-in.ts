/**
 * The weekly check-in: once a week, the calorie and macro targets are worked out again from what
 * the owner really burns (Progress's "What you actually burn", built from logged food and the
 * weight trend) instead of the formula, for the goal picked in Settings. The owner takes the new
 * targets or puts the check-in off for a week. Pure.
 */
import { addDays, daysBetween } from './dates';
import type { MaintenanceCard } from './insights';
import { formatKcal, GOAL_LABELS, goalAdjustmentFrom, goalRateKg, splitTargets, type Profile, type Targets } from './nutrition';
import type { Macros } from './types';

/** Days between check-ins. */
export const CHECK_IN_EVERY_DAYS = 7;
/** The most one check-in moves the calorie target, so a noisy week cannot swing it far. */
export const CHECK_IN_MAX_STEP_KCAL = 250;
/** A change smaller than this is not worth asking about: the targets still fit. */
export const CHECK_IN_MIN_CHANGE_KCAL = 50;

export interface CheckInInput {
  today: string;
  lastCheckInDate: string | null;
  maintenance: MaintenanceCard;
  profile: Profile | null;
  /** The weight now (Progress's current weight); null before any weigh-in. */
  currentKg: number | null;
  goals: Macros;
}

export interface CheckIn {
  /** What the owner burns, as Progress says it. */
  burnKcal: number;
  burnText: string;
  /** The targets the check-in would set. */
  targets: Targets;
  /** New calorie target minus the current one. */
  change: number;
  /** The change was held to `CHECK_IN_MAX_STEP_KCAL`. */
  capped: boolean;
  /** The targets still fit: nothing to change, the check-in only confirms. */
  onTrack: boolean;
  title: string;
  body: string;
}

const kcal = (n: number): string => `${formatKcal(n)} kcal`;

/** The check-in due today, or null when none is due or the data cannot support one yet. */
export function weeklyCheckIn(input: CheckInInput): CheckIn | null {
  const { today, lastCheckInDate, maintenance: m, profile, currentKg, goals } = input;
  if (lastCheckInDate !== null && daysBetween(lastCheckInDate, today) < CHECK_IN_EVERY_DAYS) return null;
  // A rough estimate is up to 600 kcal wide: not enough to move targets on.
  if (!profile || !m.ready || m.confidence === 'rough' || currentKg === null) return null;

  const wanted = splitTargets(m.kcal + goalAdjustmentFrom(m.kcal, profile), profile.goal, currentKg);
  const rawChange = wanted.calories - goals.calories;
  const capped = Math.abs(rawChange) > CHECK_IN_MAX_STEP_KCAL;
  const step = capped ? Math.sign(rawChange) * CHECK_IN_MAX_STEP_KCAL : rawChange;
  const targets = capped ? splitTargets(goals.calories + step, profile.goal, currentKg) : wanted;
  const change = targets.calories - goals.calories;
  const onTrack = Math.abs(change) < CHECK_IN_MIN_CHANGE_KCAL && Math.abs(targets.protein - goals.protein) < 10;

  const rate = goalRateKg(profile);
  const aim =
    profile.goal === 'lose_fat'
      ? `To lose ${rate} kg a week`
      : profile.goal === 'build_muscle'
        ? `To gain ${rate} kg a week`
        : profile.goal === 'recomp'
          ? 'To lose fat while building muscle'
          : 'To hold your weight';
  const burn = `From your food and weigh-ins, you burn about ${kcal(m.kcal)} a day (${m.rangeText.charAt(0).toLowerCase()}${m.rangeText.slice(1)}).`;

  if (onTrack) {
    return {
      burnKcal: m.kcal,
      burnText: burn,
      targets: { ...goals },
      change: 0,
      capped: false,
      onTrack: true,
      title: 'Weekly check-in: on track',
      body: `${burn} ${aim}, your ${kcal(goals.calories)} target still fits.`,
    };
  }
  const direction = change > 0 ? 'more' : 'less';
  return {
    burnKcal: m.kcal,
    burnText: burn,
    targets,
    change,
    capped,
    onTrack: false,
    title: `Weekly check-in: ${kcal(targets.calories)} a day`,
    body:
      `${burn} ${aim}, eat about ${kcal(targets.calories)}: ${kcal(Math.abs(change))} ${direction} than now, ` +
      `with ${targets.protein} g protein, ${targets.carbs} g carbs and ${targets.fat} g fat.` +
      (capped ? ` That is one step of ${kcal(CHECK_IN_MAX_STEP_KCAL)}; next week's check-in can go further.` : ''),
  };
}

/** The goal in words, for the check-in's caption. */
export function checkInGoalText(profile: Profile): string {
  const rate = goalRateKg(profile);
  return rate > 0 ? `${GOAL_LABELS[profile.goal]}, ${rate} kg a week` : GOAL_LABELS[profile.goal];
}

/** The day the next check-in is due after one on `date`. */
export function nextCheckInDate(date: string): string {
  return addDays(date, CHECK_IN_EVERY_DAYS);
}
