/**
 * Gathers what the Heads-up rules look at, and remembers what the owner dismissed and has already
 * seen. The only part of Heads up that touches SQLite; the rules live in `nudges.ts`.
 */
import { addDays } from './dates';
import {
  getAllWeights,
  getDailyTotals,
  getEntriesForDate,
  getExercisesBetween,
  getLoggedDates,
  getTopProteinFoods,
  kvGet,
  kvSet,
  notifyChanged,
} from './db';
import { goalRateKg } from './nutrition';
import { findNudges, NOTIFY_MIN_PRIORITY, type Nudge } from './nudges';
import { getSettings } from './settings';

const DISMISSED_KEY = 'nudges_dismissed';
const SEEN_KEY = 'nudges_seen';
const KEEP = 300;

const readIds = (key: string): Set<string> => {
  const v = kvGet<unknown>(key);
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
};
const addIds = (key: string, ids: readonly string[]) => {
  const have = readIds(key);
  const fresh = ids.filter((id) => !have.has(id));
  if (fresh.length === 0) return false;
  kvSet(key, [...have, ...fresh].slice(-KEEP));
  return true;
};

/** What Heads up has to say on `today`, most important first, without the dismissed ones. */
export function loadNudges(today: string): Nudge[] {
  const s = getSettings();
  return findNudges(
    {
      today,
      goal: s.profile?.goal ?? null,
      paceKg: s.profile ? goalRateKg(s.profile) : 0,
      goals: { calories: s.calorieGoal, protein: s.proteinGoal },
      days: getDailyTotals(addDays(today, -32), today),
      biggestItem: (date) => {
        const entries = getEntriesForDate(date);
        if (entries.length === 0) return null;
        const top = entries.reduce((a, e) => (e.calories > a.calories ? e : a));
        return { name: top.name, calories: top.calories };
      },
      weights: getAllWeights().map((w) => ({ date: w.date, kg: w.kg })),
      exercises: getExercisesBetween(addDays(today, -90), today),
      loggedDates: getLoggedDates(),
      proteinFoods: getTopProteinFoods(addDays(today, -29), today, 3).map((f) => f.name),
    },
    readIds(DISMISSED_KEY),
  );
}

export function dismissNudge(id: string): void {
  if (addIds(DISMISSED_KEY, [id])) notifyChanged();
}

/** Nudges shown on Today; a notification never repeats one of these. */
export function markNudgesSeen(ids: readonly string[]): void {
  addIds(SEEN_KEY, ids);
}

/**
 * The nudge for tomorrow morning's notification: what the rules will say tomorrow from the data as
 * it stands, that matters enough, and that has not been dismissed or already seen on Today.
 */
export function nudgeForTomorrow(today: string): Nudge | null {
  const seen = readIds(SEEN_KEY);
  return loadNudges(addDays(today, 1)).find((n) => n.priority >= NOTIFY_MIN_PRIORITY && !seen.has(n.id)) ?? null;
}
