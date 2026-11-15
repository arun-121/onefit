/// <reference types="jest" />
import { addDays } from '../dates';
import { findNudges, type NudgeInput } from '../nudges';
import type { Exercise } from '../types';

const TODAY = '2026-11-15'; // a Sunday
const YESTERDAY = '2026-11-14'; // Saturday

/** `n` days of food before today, each with the same totals unless changed. */
function days(n: number, calories = 2000, protein = 140, change: Record<string, Partial<{ calories: number; protein: number; count: number }>> = {}) {
  return Array.from({ length: n }, (_, k) => {
    const date = addDays(TODAY, -(k + 1));
    // A little spread, as real days have.
    const base = { date, count: 4, calories: calories + ((k % 3) - 1) * 100, protein, carbs: 200, fat: 60 };
    return { ...base, ...change[date] };
  });
}

const base: NudgeInput = {
  today: TODAY,
  goal: 'lose_fat',
  paceKg: 0.5,
  goals: { calories: 2000, protein: 140 },
  days: days(20),
  biggestItem: () => ({ name: 'Biryani', calories: 900 }),
  weights: [],
  exercises: [],
  loggedDates: days(20).map((d) => d.date),
  proteinFoods: ['Chicken breast', 'Greek yogurt'],
};

const ids = (input: Partial<NudgeInput>) => findNudges({ ...base, ...input }).map((n) => n.id);

describe('findNudges', () => {
  it('says nothing on an ordinary run of days', () => {
    // Protein a little under goal: not low enough to warn about, not high enough to celebrate.
    expect(findNudges({ ...base, days: days(20, 2000, 120) })).toEqual([]);
  });

  it('celebrates protein on target day after day', () => {
    expect(ids({})).toContain('pstreak-20-2026-11-14');
  });

  it('asks for a missed day only after mostly logged days', () => {
    const missing = days(20).filter((d) => d.date !== YESTERDAY);
    const [n] = findNudges({ ...base, days: missing });
    expect(n).toMatchObject({ id: `missed-${YESTERDAY}`, title: 'Nothing logged on Saturday', action: { to: 'log-food', date: YESTERDAY } });
    expect(ids({ days: days(3).filter((d) => d.date !== YESTERDAY) })).toEqual([]);
  });

  it('names a day far above the usual, with its biggest item', () => {
    const [n] = findNudges({ ...base, days: days(20, 2000, 140, { [YESTERDAY]: { calories: 3600 } }) });
    expect(n.id).toBe(`high-${YESTERDAY}`);
    expect(n.title).toBe('Saturday was your highest day in a month');
    expect(n.body).toMatch(/^3,600 kcal, 1,\d{3} kcal more than your usual 2,\d{3} kcal\. Biggest item: Biryani \(900 kcal\)\./);
  });

  it('flags a light day, in the words of the goal', () => {
    const light = days(20, 2000, 140, { [YESTERDAY]: { calories: 600, count: 1 } });
    expect(findNudges({ ...base, days: light })[0]).toMatchObject({ id: `low-${YESTERDAY}`, title: 'Saturday looks light: 600 kcal' });
    expect(findNudges({ ...base, goal: 'build_muscle', days: light })[0].body).toMatch(/^Building muscle needs a surplus/);
  });

  it('suggests protein foods when protein has been low on most recent days', () => {
    const n = findNudges({ ...base, days: days(20, 2000, 90) }).find((x) => x.title === 'Protein has been low')!;
    expect(n.body).toMatch(/^4 of your last 4 full days were under 112 g \(average 90 g against 140 g\)\. Your best sources: Chicken breast, Greek yogurt\.$/);
  });

  it('calls a sudden weigh-in water, not a trend', () => {
    const weights = [
      { date: addDays(TODAY, -5), kg: 80 },
      { date: addDays(TODAY, -4), kg: 80.2 },
      { date: addDays(TODAY, -3), kg: 79.9 },
      { date: TODAY, kg: 81.6 },
    ];
    const n = findNudges({ ...base, weights }).find((x) => x.id === `jump-${TODAY}`)!;
    expect(n.title).toBe('Weight up 1.6 kg on Sunday');
    expect(n.body).toMatch(/almost always water/);
  });

  it('notices a long gap in weigh-ins and in workouts when building muscle', () => {
    expect(ids({ weights: [{ date: addDays(TODAY, -9), kg: 80 }] })).toContain(`noweigh-2026-11-09`);
    const ex = (date: string): Exercise => ({ id: 1, date, activity: 'strength', minutes: 45, intensity: 'hard', calories: 200, createdAt: 0, hcSessionId: null, hcCaloriesId: null });
    const exercises = [-20, -16, -12, -8, -6].map((k) => ex(addDays(TODAY, k)));
    expect(ids({ goal: 'build_muscle', exercises })).toContain(`noworkout-${addDays(TODAY, -6)}`);
    expect(ids({ goal: 'lose_fat', exercises })).not.toContain(`noworkout-${addDays(TODAY, -6)}`);
  });

  it('celebrates a new best on a lift and suggests the next step', () => {
    const lift = (date: string, kg: number, reps: number): Exercise => ({
      id: 1, date, activity: 'strength', minutes: 12, intensity: 'hard', calories: 60, createdAt: 0, hcSessionId: null, hcCaloriesId: null,
      name: 'Bench press', details: '', sets: 4, reps, loadKg: kg, met: 5,
    });
    const n = findNudges({ ...base, exercises: [lift(addDays(TODAY, -7), 60, 8), lift(TODAY, 62.5, 8)] })[0];
    expect(n).toMatchObject({ kind: 'win', title: 'New best: Bench press' });
    expect(n.body).toBe('62.5 kg × 8, up from 60 kg × 8. Next time try 65 kg × 8, or one more rep.');
  });

  it('says when a lift has stalled for three sessions', () => {
    const lift = (k: number, kg: number): Exercise => ({
      id: k, date: addDays(TODAY, k), activity: 'strength', minutes: 12, intensity: 'hard', calories: 60, createdAt: 0, hcSessionId: null, hcCaloriesId: null,
      name: 'Squat', sets: 5, reps: 5, loadKg: kg,
    });
    expect(ids({ exercises: [lift(-12, 80), lift(-8, 80), lift(-4, 77.5), lift(0, 80)] })).toContain(`stall-squat-${TODAY}`);
  });

  it('marks streak milestones', () => {
    const logged = Array.from({ length: 7 }, (_, k) => addDays(TODAY, -k));
    expect(ids({ loggedDates: logged })).toContain(`streak-7-${TODAY}`);
  });

  it('leaves out what was dismissed, and puts the most important first', () => {
    const input = { ...base, days: days(20, 2000, 90).filter((d) => d.date !== YESTERDAY) };
    const all = findNudges(input);
    expect(all[0].id).toBe(`missed-${YESTERDAY}`);
    expect(findNudges(input, new Set([`missed-${YESTERDAY}`])).map((n) => n.id)).not.toContain(`missed-${YESTERDAY}`);
  });
});
