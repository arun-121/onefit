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
  /** The two ends of the burn estimate (Progress's range), kcal a day: the band on the card's picture. */
  burnLow: number;
  burnHigh: number;
  /** How sure the burn estimate is; a rough one never makes a check-in. */
  confidence: 'fair' | 'good';
  /** The targets as they are now, before the check-in. */
  current: Macros;
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
  /** The card's one line, under the picture: what the target is for ("To lose 0.5 kg a week."). */
  line: string;
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

  const measured = { burnKcal: m.kcal, burnText: burn, burnLow: m.low, burnHigh: m.high, confidence: m.confidence, current: { ...goals } };

  if (onTrack) {
    return {
      ...measured,
      targets: { ...goals },
      change: 0,
      capped: false,
      onTrack: true,
      title: 'Weekly check-in: on track',
      body: `${burn} ${aim}, your ${kcal(goals.calories)} target still fits.`,
      // The card's "On track" chip already says the target still fits; the line says what it is for.
      line: `${aim}.`,
    };
  }
  const direction = change > 0 ? 'more' : 'less';
  return {
    ...measured,
    targets,
    change,
    capped,
    onTrack: false,
    title: `Weekly check-in: ${kcal(targets.calories)} a day`,
    body:
      `${burn} ${aim}, eat about ${kcal(targets.calories)}: ${kcal(Math.abs(change))} ${direction} than now, ` +
      `with ${targets.protein} g protein, ${targets.carbs} g carbs and ${targets.fat} g fat.` +
      (capped ? ` That is one step of ${kcal(CHECK_IN_MAX_STEP_KCAL)}; next week's check-in can go further.` : ''),
    line: capped ? `${aim}, one ${kcal(CHECK_IN_MAX_STEP_KCAL)} step a week.` : `${aim}.`,
  };
}

/**
 * The scale of the check-in's picture: from a little under the lowest of the burn range and the two
 * targets to a little over the highest, in whole hundreds, so every mark sits clear of the ends.
 */
export function checkInScale(c: Pick<CheckIn, 'burnLow' | 'burnHigh' | 'targets' | 'current'>): { min: number; max: number } {
  const values = [c.burnLow, c.burnHigh, c.targets.calories, c.current.calories].filter((v) => Number.isFinite(v));
  if (values.length === 0) return { min: 0, max: 1 };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(100, (hi - lo) * 0.15);
  return { min: Math.max(0, Math.floor((lo - pad) / 100) * 100), max: Math.ceil((hi + pad) / 100) * 100 };
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
