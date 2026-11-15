/**
 * The words and small decisions behind the weight sheet, Today's Weight and Exercise tiles and its
 * streak badge, the day view's weight row and three Settings groups (target weight, Health Connect, backup), and how a
 * typed number is read by every number field.
 *
 * Pure: no React, no SQLite, no clock, so every sentence the owner reads can be tested. Nothing
 * here returns NaN or Infinity; a figure that cannot be worked out is left out of the sentence.
 */
import type { BackupFile } from '../lib/backup-format';
import { addDays, dateKeyToDate, formatShortDate, toDateKey } from '../lib/dates';
import { DEFAULT_WEIGHT_KG, formatMinutes } from '../lib/exercise';
import type { HealthGrants } from '../lib/health';
import { formatKcal, goalAdjustment, goalRateKg, MIN_CALORIE_TARGET, proteinPerKg, tdee, type Profile } from '../lib/nutrition';
import type { Card, Direction, Streak, TodaySummary, WeightRate } from '../lib/insights';
import { formatKg, formatKgChange, isValidWeightKg, MAX_WEIGHT_KG, MIN_WEIGHT_KG, roundKg } from '../lib/weight';

export interface WeighInRef {
  date: string;
  kg: number;
}

export type TrendIcon = 'trending-down' | 'trending-up' | 'trending-neutral';

export const TREND_ICONS: Record<Direction, TrendIcon> = {
  down: 'trending-down',
  up: 'trending-up',
  flat: 'trending-neutral',
};

/** The range a weight has to be in, as the hint under a field. */
export const WEIGHT_RANGE_HINT = `Enter a weight between ${MIN_WEIGHT_KG} and ${MAX_WEIGHT_KG} kg.`;

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "meals", "meals and workouts", "meals, workouts and weigh-ins" */
const listWords = (words: readonly string[]): string =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * For showing on screen: a figure keeps its unit on the same line, so a sentence that wraps at a
 * large font size never ends a line on "80.9" and starts the next with "kg)". The space between
 * them becomes a no-break space; nothing else changes.
 */
export function keepUnits(text: string): string {
  return text.replace(/(\d) (kg|kcal|g|min)\b/g, '$1\u00A0$2');
}

/** A day inside a sentence: "today", "yesterday", or "9 Nov" (with the year when it is not this year). */
export function dayWords(date: string, today: string): string {
  if (date === today) return 'today';
  if (date === addDays(today, -1)) return 'yesterday';
  return formatShortDate(date, dateKeyToDate(today));
}

// ---------------------------------------------------------------- number fields

/**
 * What a number field keeps of what was typed: digits and one decimal point. A comma counts as
 * the point, because some keyboards offer nothing else. A second point and anything that is not a
 * digit are dropped. With `maxDecimals`, digits typed past that many decimal places are dropped
 * too, and 0 allows no point at all.
 */
export function cleanNumberText(typed: string, maxDecimals?: number): string {
  const kept = typed.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const point = kept.indexOf('.');
  if (point < 0) return kept;
  const whole = kept.slice(0, point);
  const decimals = kept.slice(point + 1).replace(/\./g, '');
  if (maxDecimals === undefined) return `${whole}.${decimals}`;
  if (maxDecimals <= 0) return whole;
  return `${whole}.${decimals.slice(0, maxDecimals)}`;
}

/** The number a field's text stands for: 0 while it is empty or not a number yet ("."). */
export function parseNumberText(text: string): number {
  const n = parseFloat(text);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------- weight sheet

/**
 * The number the weight sheet opens on: that day's weigh-in, else the weigh-in before it, else
 * the latest weigh-in, else the weight typed into the targets calculator, else a typical 70 kg.
 * Anything that is not a possible body weight is skipped.
 */
export function startingWeightKg(candidates: {
  entryKg?: number | null;
  earlierKg?: number | null;
  latestKg?: number | null;
  profileKg?: number | null;
}): number {
  for (const kg of [candidates.entryKg, candidates.earlierKg, candidates.latestKg, candidates.profileKg]) {
    if (isValidWeightKg(kg)) return roundKg(kg);
  }
  return DEFAULT_WEIGHT_KG;
}

export interface WeightChangeLine {
  /** "Down 0.4 kg since yesterday (78.8 kg)" */
  text: string;
  direction: Direction;
  /** The difference in kg, to 0.1. Negative when down. */
  deltaKg: number;
}

/**
 * How a weight compares with the weigh-in before it. Null when there is no earlier weigh-in or
 * the weight is not a possible one, so the caller says that instead of showing a made-up change.
 */
export function changeSincePrevious(kg: number, previous: WeighInRef | null, today: string): WeightChangeLine | null {
  if (!previous || !isValidWeightKg(kg) || !isValidWeightKg(previous.kg)) return null;
  // Compare what is shown, so "78.4 kg" against "78.4 kg" is never "Up 0.1 kg".
  const deltaKg = roundKg(roundKg(kg) - roundKg(previous.kg));
  const direction: Direction = deltaKg === 0 ? 'flat' : deltaKg < 0 ? 'down' : 'up';
  return {
    text: `${formatKgChange(deltaKg)} since ${dayWords(previous.date, today)} (${formatKg(previous.kg)})`,
    direction,
    // Math.round can leave a negative zero behind.
    deltaKg: deltaKg === 0 ? 0 : deltaKg,
  };
}

// ---------------------------------------------------------------- Today tiles

export interface TileText {
  title: string;
  detail: string;
  /** An arrow shown before the detail line, when the detail is a rate. */
  icon: TrendIcon | null;
  /**
   * Holds something from today: the tile is lit in its subject's container colour. Unlit, it is
   * neutral and its words say what to do.
   */
  lit: boolean;
  /** What a screen reader says for the whole tile. */
  label: string;
}

const kilograms = (kg: number): string => `${roundKg(kg).toFixed(1)} kilograms`;

/** The weekly rate as the tile shows and says it, or null when the weigh-ins support no rate. */
function tileRate(rate: Card<WeightRate>): { detail: string; icon: TrendIcon; spoken: string } | null {
  if (!rate.ready || !Number.isFinite(rate.kgPerWeek)) return null;
  const steady = { detail: 'Steady', icon: 'trending-neutral', spoken: 'Holding steady' } as const;
  if (rate.steady) return steady;
  if (!rate.clear) return null;
  const size = Math.abs(rate.kgPerWeek).toFixed(1);
  // A rate that would print as 0.0 kg is not a direction.
  if (size === '0.0') return steady;
  const down = rate.kgPerWeek < 0;
  return {
    // The arrow says which way; the words stay short enough for half a screen.
    detail: `${size} kg a week`,
    icon: down ? 'trending-down' : 'trending-up',
    spoken: `${down ? 'Losing' : 'Gaining'} ${size} kilograms a week`,
  };
}

/**
 * Today's Weight tile. It answers "have I weighed in today?" at a glance: lit once today has
 * its weigh-in, unlit until then, like a meal's avatar.
 *
 *  - Title: the latest weigh-in.
 *  - Weighed in today: the weekly rate over the last 30 days ("0.4 kg a week" with its arrow, or
 *    "Steady"), or "Logged today" while the weigh-ins support no rate.
 *  - Not yet today: when the latest weigh-in was ("Logged yesterday", "Logged 9 Nov"), and no rate,
 *    so an old number is never mistaken for this morning's.
 *  - No weigh-in at all: an invitation.
 *
 * The spoken label always carries the weight, when it was logged, and the rate when there is one.
 */
export function weightTileText(weight: TodaySummary['weight'], today: string): TileText {
  const latest = weight.latest;
  if (!latest || !isValidWeightKg(latest.kg)) {
    return { title: 'Log weight', detail: 'No weigh-in yet', icon: null, lit: false, label: 'Log weight. No weigh-in yet' };
  }
  const title = formatKg(latest.kg);
  const when = dayWords(latest.date, today);
  const weighedToday = weight.weighedToday && latest.date === today;
  const rate = tileRate(weight.rate);
  // What a tap does: the sheet opens on today, which may already have a weigh-in.
  const action = weighedToday ? 'Edit today’s weight' : 'Log today’s weight';
  const label = `Weight, ${kilograms(latest.kg)}, logged ${when}.${rate ? ` ${rate.spoken}.` : ''} ${action}`;
  if (!weighedToday) return { title, detail: `Logged ${when}`, icon: null, lit: false, label };
  return rate
    ? { title, detail: rate.detail, icon: rate.icon, lit: true, label }
    : { title, detail: 'Logged today', icon: null, lit: true, label };
}

/** The current run of logged days as a whole number, 0 when it cannot be worked out. */
const streakDays = (streak: Streak): number => (Number.isFinite(streak.current) ? Math.max(0, Math.floor(streak.current)) : 0);

/**
 * The words for a streak: the current run of logged days, with the best run underneath. The
 * streak is shown as a badge now (see `streakBadgeText`), which speaks this label.
 */
export function streakTileText(streak: Streak): TileText {
  const current = streakDays(streak);
  const best = Math.max(current, Number.isFinite(streak.best) ? Math.floor(streak.best) : 0);
  if (current === 0) {
    // The same short title either way: it has to fit half the screen at a large font size.
    return best > 0
      ? {
          title: 'Start a streak',
          detail: `Best ${plural(best, 'day', 'days')}`,
          icon: null,
          lit: false,
          label: `No streak at the moment. Your best is ${plural(best, 'day', 'days')}. Log a meal to start a new one. Opens Progress`,
        }
      : {
          title: 'Start a streak',
          detail: 'Log a meal today',
          icon: null,
          lit: false,
          label: 'No streak yet. Log a meal today to start one. Opens Progress',
        };
  }
  // Short enough for half a screen at a large font size, where a longer line left one word on its own.
  const detail = best > current ? `Best ${plural(best, 'day', 'days')}` : 'Your longest yet';
  const nudge = streak.loggedToday ? '' : ' Log a meal today to keep it going.';
  return {
    title: `${current.toLocaleString('en-US')}-day streak`,
    detail,
    icon: null,
    lit: true,
    label: `${current.toLocaleString('en-US')}-day logging streak. ${detail}.${nudge} Opens Progress`,
  };
}

export interface BadgeText {
  /** The number inside the badge. */
  count: string;
  /** Today is already logged, so today counts toward the streak: the badge is lit. */
  lit: boolean;
  /** What a screen reader says for the badge. */
  label: string;
}

/**
 * Today's streak badge, in the header. The number is the current run of logged days. It is lit
 * once today has a meal logged and unlit before, when the run is only yesterday's to keep, or
 * there is none. It speaks the streak tile's sentence, which also says a tap opens Progress.
 */
export function streakBadgeText(streak: Streak): BadgeText {
  const current = streakDays(streak);
  return {
    count: current.toLocaleString('en-US'),
    lit: current > 0 && streak.loggedToday === true,
    label: streakTileText(streak).label,
  };
}

/** One workout logged today, as the Exercise tile needs it. */
export interface WorkoutRef {
  /** What it was: "Run", "Walk". */
  activity: string;
  minutes: number;
  /** Calories it burned. */
  calories: number;
}

/**
 * Today's Exercise tile. Lit once a workout is logged today: the calories burned as the figure,
 * and the workout underneath ("Run, 30 min"), or how many and how long when there are several
 * ("2 workouts, 55 min"). Until then it is unlit and says what a tap does.
 *
 * A tap always opens the sheet for a new workout; a logged one is edited from its row under
 * Exercise. Figures that cannot be worked out count as nothing.
 */
export function exerciseTileText(workouts: readonly WorkoutRef[]): TileText {
  if (workouts.length === 0) {
    return { title: 'Log exercise', detail: 'Adds to today’s budget', icon: null, lit: false, label: 'Log exercise' };
  }
  const amount = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
  const kcal = Math.round(workouts.reduce((sum, w) => sum + amount(w.calories), 0));
  const time = formatMinutes(workouts.reduce((sum, w) => sum + amount(w.minutes), 0));
  const title = `${kcal.toLocaleString('en-US')} kcal`;
  const detail = workouts.length === 1 ? `${workouts[0].activity}, ${time}` : `${plural(workouts.length, 'workout', 'workouts')}, ${time}`;
  return {
    title,
    detail,
    icon: null,
    lit: true,
    label: `Exercise, ${plural(kcal, 'calorie', 'calories')} burned today. ${detail}. Log another workout`,
  };
}

// ---------------------------------------------------------------- Settings: target weight

/**
 * The line under the target weight field: where the weight is now and how far there is to go.
 *
 * `currentKg` is the weight now as Progress works it out (`currentWeightKg` in insights.ts), so
 * "at your target" and the distance read the same on both screens and one low morning does not
 * reach the target. Left out, or not a possible weight, the latest weigh-in stands in for it.
 * The sentence names the figure it measures from, so it always adds up: the latest weigh-in when
 * that is all there is to go on, otherwise the weight the recent weigh-ins put the owner at.
 *
 * "At your target" follows the Progress tab: past the target in the direction it was set from the
 * starting weight, or within 0.05 kg of it when there is no starting weight. When only the latest
 * weigh-in is there and the current weight is not, it says so and that more weigh-ins will tell.
 */
export function goalStatusText(
  goalKg: number | null,
  latest: WeighInRef | null,
  startKg: number | null,
  currentKg: number | null = null,
): string {
  const goal = goalKg !== null && isValidWeightKg(goalKg) ? goalKg : null;
  const reading = latest && isValidWeightKg(latest.kg) ? latest.kg : null;
  if (goal === null) {
    return reading === null
      ? 'Set a target to see how far there is to go.'
      : `Latest weigh-in ${formatKg(reading)}. Set a target to aim for.`;
  }
  if (reading === null) return 'Log your weight to see how far there is to go.';
  const now = currentKg !== null && isValidWeightKg(currentKg) ? roundKg(currentKg) : reading;
  const start = startKg !== null && isValidWeightKg(startKg) ? startKg : null;
  const wanted = start !== null && Math.abs(goal - start) >= 0.05 ? Math.sign(goal - start) : 0;
  const at = (kg: number): boolean =>
    wanted < 0 ? kg <= goal + 0.05 : wanted > 0 ? kg >= goal - 0.05 : Math.abs(kg - goal) <= 0.05;
  // Compared as shown, so "78.4 kg" is never introduced as something other than the weigh-in.
  const from =
    formatKg(now) === formatKg(reading) ? `Latest weigh-in ${formatKg(reading)}` : `Your weigh-ins put you at ${formatKg(now)}`;
  const toGo = roundKg(Math.abs(now - goal));
  if (at(now) || toGo === 0) return `${from}, at your target.`;
  if (at(reading)) return 'Your latest weigh-in is at your target. A few more will confirm it.';
  return `${from}, ${toGo.toFixed(1)} kg to go.`;
}

// ---------------------------------------------------------------- Settings: Health Connect

export interface OptionalGrantRow {
  headline: string;
  supporting: string;
}

export interface HealthText {
  /** The line under "Connected" or "Not connected". */
  status: string;
  /** A row offering the workout grant, when it is missing. */
  workouts: OptionalGrantRow | null;
  /** A row offering the weight grants, when one or both are missing. */
  weight: OptionalGrantRow | null;
}

/**
 * What Health Connect is doing, and which optional grants could still be allowed. Every grant
 * beyond Nutrition is optional, so a missing one is offered, never demanded. `grants` is null
 * until they have been read; nothing is offered before then.
 */
export function healthText(connected: boolean, grants: HealthGrants | null): HealthText {
  if (!connected) {
    return {
      status: 'Send meals, workouts and weigh-ins to Google Fit, and see steps and activity',
      workouts: null,
      weight: null,
    };
  }
  if (!grants) return { status: 'Meals go to Google Fit', workouts: null, weight: null };

  const sent = ['Meals', ...(grants.writeExercise ? ['workouts'] : []), ...(grants.writeWeight ? ['weigh-ins'] : [])];
  const missing = [...(grants.writeExercise ? [] : ['workouts']), ...(grants.writeWeight ? [] : ['weigh-ins'])];
  const going = `${listWords(sent)} go to Google Fit`;
  const status =
    missing.length > 0
      ? `${going}. ${capitalise(listWords(missing))} are not shared yet`
      : grants.readWeight
        ? `${going}; steps and activity show on Today`
        : `${going}. Weigh-ins from other apps are not read yet`;

  const weight: OptionalGrantRow | null =
    grants.writeWeight && grants.readWeight
      ? null
      : !grants.writeWeight && !grants.readWeight
        ? { headline: 'Weight is not shared', supporting: 'Send weigh-ins to Google Fit and read them from your scale' }
        : grants.writeWeight
          ? { headline: 'Weigh-ins are not read', supporting: 'Bring in weigh-ins from a scale or Google Fit' }
          : { headline: 'Weigh-ins are not sent', supporting: 'Send your weigh-ins to Google Fit' };

  return {
    status,
    workouts: grants.writeExercise ? null : { headline: 'Workouts are not shared', supporting: 'Send the workouts you log to Google Fit' },
    weight,
  };
}

// ---------------------------------------------------------------- Settings: backup

/** What a backup, or this phone, holds, in the units the owner thinks in. */
export interface DataCounts {
  /** Days with at least one food entry. */
  foodDays: number;
  workouts: number;
  weighIns: number;
  savedFoods: number;
}

export function countBackup(backup: BackupFile): DataCounts {
  const { entries, exercises, weights, foods } = backup.data;
  return {
    foodDays: new Set(entries.map((e) => e.date)).size,
    workouts: exercises.length,
    weighIns: weights.length,
    savedFoods: foods.length,
  };
}

const logged = (c: DataCounts): string =>
  `${plural(c.foodDays, 'day of food', 'days of food')}, ${plural(c.workouts, 'workout', 'workouts')} and ${plural(c.weighIns, 'weigh-in', 'weigh-ins')}`;

const isEmpty = (c: DataCounts): boolean => c.foodDays === 0 && c.workouts === 0 && c.weighIns === 0 && c.savedFoods === 0;

/**
 * The confirmation before a restore: what the file holds, and exactly what on this phone it
 * replaces. `exportedAt` is the backup's own timestamp; a broken one is left out.
 */
export function restoreConfirmText(file: DataCounts, phone: DataCounts, exportedAt: string, now: Date = new Date()): string {
  const made = Date.parse(exportedAt);
  const from = Number.isFinite(made) ? ` from ${dayWords(toDateKey(new Date(made)), toDateKey(now))}` : '';
  const holds = `The backup${from} has ${logged(file)}, plus ${plural(file.savedFoods, 'saved food', 'saved foods')} and your settings.`;
  const replaces = isEmpty(phone)
    ? 'Nothing is logged on this phone yet, so only its settings are replaced.'
    : `It replaces everything on this phone: ${logged(phone)}, ${plural(phone.savedFoods, 'saved food', 'saved foods')} and your settings. This cannot be undone.`;
  return `${holds}\n\n${replaces}\n\nYour Groq API key is not part of a backup and stays as it is.`;
}

/** The snackbar after a restore. */
export function restoreDoneText(file: DataCounts): string {
  return `Backup restored: ${logged(file)}`;
}

/** Why a picked file cannot be restored, one problem per line, ending with what happened to the phone. */
export function backupProblemsText(problems: readonly string[]): string {
  const lines = problems.map((p) => p.trim()).filter((p) => p.length > 0);
  if (lines.length === 0) lines.push('This file is not a Calorie Tracker backup.');
  return `${lines.join('\n')}\n\nNothing on this phone was changed.`;
}

/**
 * What the goal picked in the targets calculator does, said under the goals: how far the calories sit
 * from what the profile burns, the protein that goes with it, and, when there is a target weight in
 * the goal's direction, about how many weeks the pace takes to reach it.
 */
export function goalPlanText(p: Profile, targetKg: number | null): string {
  const burn = tdee(p);
  const raw = burn + goalAdjustment(p);
  const floored = raw < MIN_CALORIE_TARGET;
  const change = Math.round(Math.abs(Math.max(MIN_CALORIE_TARGET, raw) - burn) / 10) * 10;
  const protein = `${proteinPerKg(p.goal)} g of protein per kg`;
  let text: string;
  switch (p.goal) {
    case 'lose_fat':
      text = `About ${formatKcal(change)} kcal a day under what you burn, with ${protein} so you keep muscle.`;
      break;
    case 'build_muscle':
      text = `About ${formatKcal(change)} kcal a day over what you burn, with ${protein}. Pair it with strength training.`;
      break;
    case 'recomp':
      text = `About ${formatKcal(change)} kcal a day under what you burn, with ${protein}. It needs strength training 3 or more days a week.`;
      break;
    case 'maintain':
      text = `What you burn, with ${protein}.`;
      break;
  }
  if (floored) return `${text} Held at ${formatKcal(MIN_CALORIE_TARGET)} kcal, the lowest this suggests.`;
  const rate = goalRateKg(p);
  if (targetKg !== null && isValidWeightKg(targetKg) && rate > 0 && isValidWeightKg(p.weightKg)) {
    const gap = targetKg - p.weightKg;
    const towards = p.goal === 'lose_fat' ? gap <= -0.05 : gap >= 0.05;
    if (towards) {
      const weeks = Math.max(1, Math.ceil(Math.abs(gap) / rate));
      text += ` At this pace, ${formatKg(targetKg)} takes about ${weeks} ${weeks === 1 ? 'week' : 'weeks'}.`;
    }
  }
  return text;
}
