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

  describe('visual', () => {
    it('draws a missed day as a week of dots, the missed day a ring and today open', () => {
      const missing = days(20).filter((d) => d.date !== YESTERDAY);
      const n = findNudges({ ...base, days: missing })[0];
      const v = n.visual!;
      expect(v.heading).toBe('Saturday not logged');
      // The body is one short sentence, so it is the line, and the card has no disclosure to say it again.
      expect(v.line).toBe(n.body);
      expect(v.picture).toMatchObject({ kind: 'days', tone: 'primary' });
      const dots = v.picture!.kind === 'days' ? v.picture!.days : [];
      expect(dots.map((d) => d.mark)).toEqual(['hit', 'hit', 'hit', 'hit', 'hit', 'miss', 'today']);
      expect(dots.map((d) => d.label).join('')).toBe('MTWTFSS');
    });

    it('draws a high day as that day against the usual', () => {
      const n = findNudges({ ...base, days: days(20, 2000, 140, { [YESTERDAY]: { calories: 3600 } }) })[0];
      expect(n.visual).toMatchObject({ heading: 'Highest in a month', picture: { kind: 'compare', day: { name: 'Saturday', kcal: 3600 } } });
      const usual = n.visual!.picture!.kind === 'compare' ? n.visual!.picture!.usualKcal : 0;
      expect(n.body).toContain(`usual ${usual.toLocaleString('en-US')} kcal`);
    });

    it('draws low protein as the last four full days, each named, under the goal or not', () => {
      const n = findNudges({ ...base, days: days(20, 2000, 90, { [addDays(TODAY, -2)]: { protein: 130 } }) }).find((x) => x.title === 'Protein has been low')!;
      // 90, 130, 90 and 90 g.
      expect(n.visual!.figure).toMatchObject({ value: '100 g', unit: 'a day, goal 140 g' });
      const dots = n.visual!.picture!.kind === 'days' ? n.visual!.picture!.days : [];
      expect(dots.map((d) => `${d.label} ${d.mark}`)).toEqual(['Wed miss', 'Thu miss', 'Fri hit', 'Sat miss']);
    });

    it('shows a weigh-in jump as a change that is never toward the goal', () => {
      const weights = [
        { date: addDays(TODAY, -5), kg: 80 },
        { date: addDays(TODAY, -4), kg: 80.2 },
        { date: addDays(TODAY, -3), kg: 79.9 },
        { date: TODAY, kg: 78.4 },
      ];
      const v = findNudges({ ...base, weights }).find((x) => x.id === `jump-${TODAY}`)!.visual!;
      expect(v.figure).toMatchObject({ value: '78.4', unit: 'kg', change: { direction: 'down', amount: '1.6 kg', towardGoal: false } });
      // What the change is measured from: the weigh-ins before as a band, this one as a dot below it.
      expect(v.picture).toEqual({ kind: 'reading', tone: 'primary', lowKg: 79.9, highKg: 80.2, kg: 78.4, label: 'Sun' });
      expect(v.line!.length).toBeLessThanOrEqual(60);
    });

    it('shows a new best as the set with what it gained', () => {
      const lift = (date: string, kg: number, reps: number): Exercise => ({
        id: 1, date, activity: 'strength', minutes: 12, intensity: 'hard', calories: 60, createdAt: 0, hcSessionId: null, hcCaloriesId: null,
        name: 'Bench press', details: '', sets: 4, reps, loadKg: kg, met: 5,
      });
      const best = (a: [number, number], b: [number, number]) =>
        findNudges({ ...base, exercises: [lift(addDays(TODAY, -7), ...a), lift(TODAY, ...b)] })[0].visual!;
      expect(best([60, 8], [62.5, 8])).toMatchObject({
        heading: 'New best',
        figure: { value: '62.5 kg × 8', unit: 'Bench press', change: { direction: 'up', amount: '2.5 kg', towardGoal: true } },
        line: 'Next time try 65 kg × 8, or one more rep.',
      });
      expect(best([60, 8], [60, 10]).figure!.change!.amount).toBe('2 reps');
      expect(best([60, 10], [65, 8]).figure!.change!.amount).toBe('from 60 kg × 10');
    });

    it('draws a gap in weigh-ins as ten days of dots with the last weigh-in filled', () => {
      const v = findNudges({ ...base, weights: [{ date: addDays(TODAY, -8), kg: 80 }] }).find((x) => x.id === 'noweigh-2026-11-09')!.visual!;
      expect(v.figure).toMatchObject({ value: '8', unit: 'days' });
      const dots = v.picture!.kind === 'days' ? v.picture!.days : [];
      expect(dots).toHaveLength(10);
      expect(dots.map((d) => d.mark)).toEqual(['miss', 'hit', 'miss', 'miss', 'miss', 'miss', 'miss', 'miss', 'miss', 'today']);
    });

    it('draws a streak as its run of days, with today open until it is logged', () => {
      const logged = Array.from({ length: 7 }, (_, k) => addDays(TODAY, -k - 1));
      const v = findNudges({ ...base, loggedDates: logged }).find((x) => x.id === `streak-7-${TODAY}`)!.visual!;
      const dots = v.picture!.kind === 'days' ? v.picture!.days : [];
      expect(v.heading).toBe('7-day streak');
      expect(dots.map((d) => d.mark)).toEqual([...Array(7).fill('hit'), 'today']);
      const withToday = findNudges({ ...base, loggedDates: [TODAY, ...logged.slice(0, 6)] }).find((x) => x.id === `streak-7-${TODAY}`)!.visual!;
      expect(withToday.picture!.kind === 'days' ? withToday.picture!.days.map((d) => d.mark) : []).toEqual(Array(7).fill('hit'));
    });

    it('gives every rule a heading of a few words and a picture or a figure', () => {
      const missing = days(20, 2000, 90).filter((d) => d.date !== YESTERDAY);
      const all = [
        ...findNudges({ ...base, days: missing }),
        ...findNudges({ ...base, days: days(20, 2000, 140, { [YESTERDAY]: { calories: 3600 } }) }),
        ...findNudges({ ...base, days: days(20, 2000, 140, { [YESTERDAY]: { calories: 600, count: 1 } }) }),
      ];
      expect(all.length).toBeGreaterThan(2);
      for (const n of all) {
        expect(n.visual).toBeDefined();
        expect(n.visual!.heading.split(' ').length).toBeLessThanOrEqual(4);
        expect(n.visual!.picture ?? n.visual!.figure).toBeDefined();
      }
    });
  });
});

describe('pace off', () => {
  // Rising about 0.4 kg a week while losing fat, the weigh-ins given newest first.
  const rising = Array.from({ length: 14 }, (_, k) => ({ date: addDays(TODAY, -2 * k), kg: 81.2 - 0.12 * k + (k % 2) * 0.04 }));

  it('reads the weigh-ins in any order', () => {
    const n = findNudges({ ...base, weights: rising }).find((x) => x.id.startsWith('pace-'))!;
    expect(n.title).toBe('Weight going up while losing fat');
    expect(findNudges({ ...base, weights: [...rising].reverse() }).find((x) => x.id.startsWith('pace-'))!.title).toBe(n.title);
  });

  it('draws the rate against the goal\'s pace, with the goal on the side it was set', () => {
    const v = findNudges({ ...base, weights: rising }).find((x) => x.id.startsWith('pace-'))!.visual!;
    expect(v.heading).toBe('Weight rising');
    expect(v.picture).toMatchObject({ kind: 'pace', goalKgPerWeek: -0.5 });
    expect(v.picture!.kind === 'pace' && v.picture!.kgPerWeek).toBeGreaterThan(0.1);
  });
});
