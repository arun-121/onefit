/// <reference types="jest" />
import { addDays } from '../dates';
import {
  buildInsights,
  buildTodaySummary,
  completeDayThreshold,
  currentWeightKg,
  linearFit,
  loggingStreak,
  weightRate,
  whatShowsUpHere,
  type DayFoodTotal,
  type ExerciseLog,
  type InsightsInput,
  type WeighIn,
} from '../insights';
import { calculateTargets, type Profile } from '../nutrition';

// 30 November 2026 is a Monday, so the 30-day period starts on Sunday 1 November.
const TODAY = '2026-11-30';
const FROM_30 = '2026-11-01';
const day = (offsetFromStart: number, start: string = FROM_30) => addDays(start, offsetFromStart);

const profile: Profile = { sex: 'male', age: 30, heightCm: 175, weightKg: 78, activity: 'moderate', goal: 'lose' };

function input(over: Partial<InsightsInput> = {}): InsightsInput {
  return {
    today: TODAY,
    days: 30,
    goals: { calories: 2000, protein: 100, carbs: 250, fat: 60 },
    weightGoalKg: null,
    goalStartDate: null,
    goalStartWeightKg: null,
    profile: null,
    targetsWeightKg: null,
    dayTotals: [],
    exercises: [],
    weights: [],
    mealCalories: [],
    topFoods: [],
    loggedDates: [],
    firstExerciseDate: null,
    ...over,
  };
}

function food(date: string, calories: number, macros: Partial<DayFoodTotal> = {}): DayFoodTotal {
  return { date, calories, protein: 100, carbs: 250, fat: 60, count: 3, ...macros };
}

/** The card's data; fails the test when the card is not ready. */
function on<T extends { ready: boolean }>(card: T): Extract<T, { ready: true }> {
  if (!card.ready) throw new Error(`expected a ready card, got: ${JSON.stringify(card)}`);
  return card as Extract<T, { ready: true }>;
}

/** The card's reason; fails the test when the card is ready. */
function off<T extends { ready: boolean }>(card: T): Extract<T, { ready: false }> {
  if (card.ready) throw new Error('expected a card that is not ready');
  return card as Extract<T, { ready: false }>;
}

/** Fails on any NaN or Infinity anywhere in a result. */
function expectAllFinite(value: unknown, path = 'result'): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} is ${value}`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((v, i) => expectAllFinite(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) expectAllFinite(v, `${path}.${k}`);
  }
}

/** Fails on copy the app must never show. */
function expectPlainCopy(value: unknown): void {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(/NaN|Infinity|undefined/);
  expect(text).not.toMatch(/!|successfully|·/i);
}

/** Weigh-ins every 7 days from the start of the 30-day period, 0.5 kg lower each time. */
const steadyLoss: WeighIn[] = [
  { date: day(0), kg: 80 },
  { date: day(7), kg: 79.5 },
  { date: day(14), kg: 79 },
  { date: day(21), kg: 78.5 },
  { date: day(28), kg: 78 },
];

/** `count` weigh-ins `step` days apart from 1 November, on a straight line, each moved by its own offset. */
function lineOf(count: number, step: number, startKg: number, kgPerDay: number, offsets: readonly number[] = []): WeighIn[] {
  return Array.from({ length: count }, (_, i) => ({ date: day(i * step), kg: startKg + kgPerDay * i * step + (offsets[i] ?? 0) }));
}

/**
 * Twelve offsets that add up to nothing and lean neither way (their sum, and their sum weighted by
 * position, are both 0), so adding them to a line leaves its slope and intercept exactly as they
 * were and only spreads the points around it. The sum of their squares is 12.
 */
const WOBBLE = [1, -1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1];

describe('definitions', () => {
  it('a complete day needs max(800, 40% of the goal)', () => {
    expect(completeDayThreshold(2000)).toBe(800);
    expect(completeDayThreshold(1500)).toBe(800);
    expect(completeDayThreshold(2500)).toBe(1000);
    expect(completeDayThreshold(0)).toBe(800);
    expect(completeDayThreshold(NaN)).toBe(800);
  });

  it('fits a least-squares line and measures how far the points sit from it', () => {
    expect(linearFit([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])).toEqual({ slope: 2, intercept: 1, sxx: 2, residualSd: 0 });
    // Points (0, 80), (7, 79), (14, 79.5): mean x 7, mean y 79.5, Sxx 49 + 0 + 49 = 98, Sxy -3.5.
    // Slope -3.5 / 98, intercept 79.5 + 7 x 3.5 / 98 = 79.75. The line passes 79.75, 79.5, 79.25,
    // so the residuals are 0.25, -0.5, 0.25: 0.375 squared in all, on 3 - 2 = 1 degree of freedom.
    const fit = linearFit([{ x: 0, y: 80 }, { x: 7, y: 79 }, { x: 14, y: 79.5 }]);
    if (!fit) throw new Error('no fit');
    expect(fit.slope).toBeCloseTo(-3.5 / 98, 12);
    expect(fit.intercept).toBeCloseTo(79.75, 10);
    expect(fit.sxx).toBe(98);
    expect(fit.residualSd).toBeCloseTo(Math.sqrt(0.375), 10);
    // Two points leave nothing to measure the scatter with.
    expect(linearFit([{ x: 0, y: 1 }, { x: 4, y: 3 }])).toEqual({ slope: 0.5, intercept: 1, sxx: 8, residualSd: 0 });
    expect(linearFit([{ x: 3, y: 1 }])).toBeNull();
    expect(linearFit([{ x: 3, y: 1 }, { x: 3, y: 2 }])).toBeNull();
    expect(linearFit([])).toBeNull();
  });
});

describe('weight rate', () => {
  const UNCLEAR = 'Your weigh-ins vary from day to day by more than the change so far';

  it('is the regression slope in kg per week, with its standard error (3 weigh-ins)', () => {
    // Points (0, 80), (7, 79), (14, 79.5): slope -3.5 / 98 = -0.0357 kg a day, -0.25 kg a week, and
    // -0.5 kg over the 14 days. Scatter sqrt(0.375) = 0.612 kg (see the fit test), which is over the
    // 0.3 kg floor. Standard error 0.612 / sqrt(98) = 0.0619 kg a day = 0.433 kg a week.
    // 0.25 is nowhere near 2 x 0.433, so the rate is not clear; 2 x 0.433 is over 0.3, so not steady.
    const rate = weightRate([
      { date: '2026-11-01', kg: 80 },
      { date: '2026-11-08', kg: 79 },
      { date: '2026-11-15', kg: 79.5 },
    ]);
    expect(rate).toMatchObject({ ready: true, kgPerWeek: -0.25, seKgPerWeek: 0.433, changeKg: -0.5, days: 15, weighIns: 3 });
    expect(rate).toMatchObject({ clear: false, steady: false, direction: null, towardGoal: null });
    expect(rate).toMatchObject({ fromDate: '2026-11-01', toDate: '2026-11-15', rateText: 'Too early to say', changeText: UNCLEAR });
  });

  it('never takes a weigh-in to be better than 0.3 kg, however well three of them line up', () => {
    // Days 0, 3, 6 on a perfect line losing 0.1 kg a day: Sxx 9 + 0 + 9 = 18, no scatter at all.
    // With the 0.3 kg floor the standard error is 0.3 / sqrt(18) = 0.0707 kg a day = 0.495 kg a week.
    // The slope, 0.7 kg a week, is under 2 x 0.495 = 0.99: three weigh-ins in a week prove nothing.
    const rate = weightRate([
      { date: '2026-11-01', kg: 80 },
      { date: '2026-11-04', kg: 79.7 },
      { date: '2026-11-07', kg: 79.4 },
    ]);
    expect(rate).toMatchObject({ ready: true, kgPerWeek: -0.7, seKgPerWeek: 0.495, changeKg: -0.6, days: 7, nowKg: 79.4 });
    expect(rate).toMatchObject({ clear: false, steady: false, direction: null, rateText: 'Too early to say', changeText: UNCLEAR });
  });

  it('works out the standard error from 12 weigh-ins', () => {
    // Every other day for 23 days: x = 0, 2 ... 22, Sxx = 4 x (12 x 143 / 12) = 572, sqrt 23.92.
    // On a perfect line the floor applies: 0.3 / 23.92 x 7 = 0.088 kg a week.
    const onLine = weightRate(lineOf(12, 2, 80, -0.06));
    expect(onLine).toMatchObject({ ready: true, kgPerWeek: -0.42, seKgPerWeek: 0.088, weighIns: 12, days: 23 });
    // 0.42 is well over 2 x 0.088, so it is stated. 0.06 kg a day over 22 days is 1.32 kg.
    expect(onLine).toMatchObject({ clear: true, steady: false, direction: 'down', changeKg: -1.32, nowKg: 78.7 });
    expect(onLine).toMatchObject({ rateText: 'Losing 0.4 kg a week', changeText: 'Down 1.3 kg in 23 days' });

    // The same line with every weigh-in 0.4 kg off it: 12 x 0.16 = 1.92 squared, on 10 degrees of
    // freedom, is a scatter of sqrt(0.192) = 0.438 kg. 0.438 / 23.92 x 7 = 0.128 kg a week.
    const scattered = weightRate(lineOf(12, 2, 80, -0.06, WOBBLE.map((w) => w * 0.4)));
    expect(scattered).toMatchObject({ ready: true, kgPerWeek: -0.42, seKgPerWeek: 0.128, clear: true, direction: 'down' });
  });

  it('states a rate only when it is at least twice its standard error', () => {
    // Five weekly weigh-ins on a line: Sxx = 49 x (4 + 1 + 0 + 1 + 4) = 490, so with the 0.3 kg
    // floor twice the standard error is 2 x 0.3 / sqrt(490) x 7 = 0.1897 kg a week.
    const over = weightRate(lineOf(5, 7, 80, -0.19 / 7));
    expect(over).toMatchObject({ ready: true, kgPerWeek: -0.19, seKgPerWeek: 0.095, clear: true, steady: false, direction: 'down' });
    // 0.19 x 4 weeks = 0.76 kg.
    expect(over).toMatchObject({ rateText: 'Losing 0.2 kg a week', changeText: 'Down 0.8 kg in 29 days' });

    const under = weightRate(lineOf(5, 7, 80, -0.18 / 7));
    expect(under).toMatchObject({ ready: true, kgPerWeek: -0.18, clear: false, steady: true, direction: 'flat' });
    expect(under).toMatchObject({ rateText: 'Holding steady', changeText: 'Steady over 29 days' });

    const up = weightRate(lineOf(5, 7, 60, 0.5 / 7));
    expect(up).toMatchObject({ clear: true, direction: 'up', rateText: 'Gaining 0.5 kg a week', changeText: 'Up 2.0 kg in 29 days' });
  });

  it('says steady only when the weigh-ins pin the rate to within 0.3 kg a week of zero', () => {
    // An unchanged weight on days 0, 10 and 20: Sxx 200, twice the standard error 4.2 / sqrt(200) = 0.297.
    const pinned = weightRate(lineOf(3, 10, 80, 0));
    expect(pinned).toMatchObject({ ready: true, kgPerWeek: 0, clear: false, steady: true, direction: 'flat', rateText: 'Holding steady' });
    expect(pinned).toMatchObject({ changeText: 'Steady over 21 days' });
    // The same weight on days 0, 9 and 18: Sxx 162, and 4.2 / sqrt(162) = 0.330. Not pinned down yet.
    const loose = weightRate(lineOf(3, 9, 80, 0));
    expect(loose).toMatchObject({ ready: true, kgPerWeek: 0, clear: false, steady: false, direction: null });
    expect(loose).toMatchObject({ rateText: 'Too early to say', changeText: UNCLEAR, days: 19 });
  });

  it('calls an unclear rate "No clear direction yet" once the weigh-ins cover three weeks', () => {
    // 80, 81, 80: no slope worth the name and a scatter of 0.8 kg, so neither clear nor steady.
    const kgs = [80, 81, 80];
    const twentyDays = weightRate([0, 10, 19].map((d, i) => ({ date: day(d), kg: kgs[i] })));
    expect(twentyDays).toMatchObject({ ready: true, clear: false, steady: false, days: 20, rateText: 'Too early to say' });
    const threeWeeks = weightRate([0, 10, 20].map((d, i) => ({ date: day(d), kg: kgs[i] })));
    expect(threeWeeks).toMatchObject({ ready: true, clear: false, steady: false, days: 21, rateText: 'No clear direction yet', changeText: UNCLEAR });
    // Twelve weigh-ins 0.5 kg either side of a level line: scatter sqrt(12 x 0.25 / 10) = 0.548 kg,
    // twice the standard error 2 x 0.548 / sqrt(572) x 7 = 0.321 kg a week. Just too loose to call steady.
    const noisy = weightRate(lineOf(12, 2, 80, 0, WOBBLE.map((w) => w * 0.5)));
    expect(noisy).toMatchObject({ ready: true, kgPerWeek: 0, seKgPerWeek: 0.16, clear: false, steady: false, rateText: 'No clear direction yet' });
    // At 0.4 kg either side it is 0.257 kg a week (see above), and that is steady.
    expect(weightRate(lineOf(12, 2, 80, 0, WOBBLE.map((w) => w * 0.4)))).toMatchObject({ steady: true, rateText: 'Holding steady' });
  });

  it('does not state a rate under 0.05 kg a week, however sure it is', () => {
    // Ninety daily weigh-ins: Sxx = 90 x 8,099 / 12 = 60,742.5, twice the standard error 0.017 kg a week.
    const tiny = weightRate(lineOf(90, 1, 80, -0.04 / 7));
    expect(tiny).toMatchObject({ ready: true, kgPerWeek: -0.04, clear: false, steady: true, direction: 'flat', rateText: 'Holding steady' });
    const small = weightRate(lineOf(90, 1, 80, -0.07 / 7));
    // 0.01 kg a day over 89 days is 0.89 kg.
    expect(small).toMatchObject({ ready: true, kgPerWeek: -0.07, clear: true, direction: 'down' });
    expect(small).toMatchObject({ rateText: 'Losing 0.1 kg a week', changeText: 'Down 0.9 kg in 90 days' });
  });

  it('needs three weigh-ins', () => {
    const none = weightRate([]);
    expect(none).toEqual({ ready: false, reason: 'Log your weight on 3 days over at least a week to see how fast it is changing.', action: 'log-weight' });
    const two = weightRate([{ date: '2026-11-01', kg: 80 }, { date: '2026-11-20', kg: 79 }]);
    expect(two).toEqual({
      ready: false,
      reason: 'Log 1 more weigh-in to see how fast your weight is changing. That takes 3 weigh-ins over at least a week.',
      action: 'log-weight',
    });
    const one = weightRate([{ date: '2026-11-01', kg: 80 }]);
    expect(off(one).reason).toContain('Log 2 more weigh-ins to see how fast your weight is changing.');
  });

  it('needs the weigh-ins to span seven days', () => {
    const rate = weightRate([
      { date: '2026-11-01', kg: 80 },
      { date: '2026-11-03', kg: 79.8 },
      { date: '2026-11-06', kg: 79.6 },
    ]);
    expect(rate).toEqual({
      ready: false,
      reason: 'Your weigh-ins cover 6 days. Keep weighing in until they cover a week to see how fast your weight is changing.',
      action: 'log-weight',
    });
  });

  it('says whether the weight is moving toward the target, and only when the rate is clear', () => {
    expect(weightRate(steadyLoss, 75)).toMatchObject({ clear: true, towardGoal: true });
    expect(weightRate(steadyLoss, 85)).toMatchObject({ towardGoal: false });
    expect(weightRate(steadyLoss, null)).toMatchObject({ towardGoal: null });
    expect(weightRate(lineOf(5, 7, 80, -0.18 / 7), 75)).toMatchObject({ steady: true, towardGoal: null });
    expect(weightRate(lineOf(3, 3, 80, -0.1), 75)).toMatchObject({ clear: false, steady: false, towardGoal: null });
  });
});

describe('streaks', () => {
  it('is zero with nothing logged', () => {
    expect(loggingStreak([], TODAY)).toEqual({ current: 0, best: 0, loggedToday: false });
  });

  it('counts back from today', () => {
    expect(loggingStreak([addDays(TODAY, -2), addDays(TODAY, -1), TODAY], TODAY)).toEqual({ current: 3, best: 3, loggedToday: true });
  });

  it('keeps yesterday’s streak alive while today is still empty', () => {
    expect(loggingStreak([addDays(TODAY, -3), addDays(TODAY, -2), addDays(TODAY, -1)], TODAY)).toEqual({
      current: 3,
      best: 3,
      loggedToday: false,
    });
  });

  it('breaks after a missed day and remembers the best run', () => {
    const run = [-10, -9, -8, -7, -6, -2, -1].map((n) => addDays(TODAY, n));
    expect(loggingStreak(run, TODAY)).toEqual({ current: 2, best: 5, loggedToday: false });
    expect(loggingStreak([addDays(TODAY, -5)], TODAY)).toEqual({ current: 0, best: 1, loggedToday: false });
  });

  it('runs across a month end and ignores repeats, bad dates and the future', () => {
    const dates = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-01', 'not-a-date', '2027-01-01'];
    expect(loggingStreak(dates, '2026-11-01')).toEqual({ current: 3, best: 3, loggedToday: true });
  });
});

describe('Today summary', () => {
  const summaryOf = (weights: WeighIn[]) => buildTodaySummary({ today: TODAY, loggedDates: [], weights });

  it('has nothing to show before the first weigh-in', () => {
    const summary = buildTodaySummary({ today: TODAY, loggedDates: [], weights: [] });
    expect(summary.weight.latest).toBeNull();
    expect(summary.weight.weighedToday).toBe(false);
    expect(summary.weight.rate).toMatchObject({ ready: false, action: 'log-weight' });
    expect(summary.streak).toEqual({ current: 0, best: 0, loggedToday: false });
  });

  it('gives the weekly rate over the last 30 days, the same one Progress shows for 30 days', () => {
    const summary = buildTodaySummary({ today: TODAY, loggedDates: [TODAY], weights: steadyLoss });
    expect(summary.weight).toMatchObject({ latest: { date: day(28), kg: 78 }, weighedToday: false });
    // Five weekly weigh-ins, 0.5 kg lower each time.
    expect(summary.weight.rate).toMatchObject({ ready: true, clear: true, kgPerWeek: -0.5, direction: 'down', weighIns: 5, nowKg: 78 });
    expect(summary.weight.rate).toEqual(on(buildInsights(input({ weights: steadyLoss })).weight).rate);
    expect(summary.streak.current).toBe(1);
  });

  it('leaves weigh-ins older than 30 days out of the rate', () => {
    // 1 November is the 30th day back. 31 October and earlier are not counted.
    const older = [{ date: addDays(TODAY, -60), kg: 90 }, { date: addDays(TODAY, -30), kg: 85 }, ...steadyLoss];
    expect(summaryOf(older).weight.rate).toMatchObject({ ready: true, kgPerWeek: -0.5, weighIns: 5, fromDate: day(0) });
    // Three weigh-ins, but only two of them in the last 30 days: no rate.
    const sparse = [{ date: addDays(TODAY, -40), kg: 81 }, { date: addDays(TODAY, -20), kg: 80 }, { date: TODAY, kg: 79 }];
    expect(summaryOf(sparse).weight).toMatchObject({ weighedToday: true, latest: { date: TODAY, kg: 79 }, rate: { ready: false } });
  });

  it('has no rate for two mornings in a row, or for a first week', () => {
    // 80.0 and then 79.2 the next morning is a day of water, not 0.8 kg lost in a week.
    const twoMornings = [{ date: addDays(TODAY, -7), kg: 80 }, { date: addDays(TODAY, -6), kg: 79.2 }];
    expect(summaryOf(twoMornings).weight.rate.ready).toBe(false);
    // Three weigh-ins across the first week give a slope, but not one that can be stated.
    const firstWeek = [{ date: addDays(TODAY, -6), kg: 80 }, { date: addDays(TODAY, -3), kg: 79.7 }, { date: TODAY, kg: 79.4 }];
    expect(summaryOf(firstWeek).weight.rate).toMatchObject({ ready: true, clear: false, steady: false, direction: null });
  });

  it('says steady when the weight is pinned down as steady', () => {
    const flat = steadyLoss.map((w) => ({ ...w, kg: 80 }));
    expect(summaryOf(flat).weight.rate).toMatchObject({ ready: true, clear: false, steady: true, direction: 'flat' });
  });
});

describe('an empty database', () => {
  it.each([7, 30, 90] as const)('has every card waiting, with something to log, over %i days', (days) => {
    const r = buildInsights(input({ days }));
    expect(r.empty).toBe(true);
    const from = addDays(TODAY, -(days - 1));
    expect(r.period).toEqual({ days, from, to: TODAY, chartFrom: from, chartDays: days, firstLoggedDate: null, completeDayKcal: 800 });
    expect(r.weighedToday).toBe(false);
    expect(r.weeks).toEqual([]);
    expect(r.headline).toMatchObject({ ready: false, action: 'log-food' });
    expect(r.weight).toMatchObject({ ready: false, action: 'log-weight' });
    expect(r.calories).toMatchObject({ ready: false, action: 'log-food' });
    expect(r.maintenance.ready).toBe(false);
    expect(r.macros).toMatchObject({ ready: false, action: 'log-food' });
    expect(r.exercise).toMatchObject({ ready: false, action: 'log-exercise' });
    expect(r.consistency).toMatchObject({ ready: false, action: 'log-food' });
    expect(r.patterns).toMatchObject({ ready: false, action: 'log-food' });
    expect(r.topFoods).toMatchObject({ ready: false, action: 'log-food' });
    expect(r.everyDay).toMatchObject({ ready: false, action: 'log-food' });
    for (const card of [r.headline, r.weight, r.calories, r.maintenance, r.macros, r.exercise, r.consistency, r.patterns, r.topFoods, r.everyDay]) {
      expect(off(card).reason.length).toBeGreaterThan(10);
    }
    expectAllFinite(r);
    expectPlainCopy(r);
  });
});

describe('a single logged day, today', () => {
  const r = buildInsights(
    input({
      days: 7,
      dayTotals: [food(TODAY, 2100, { protein: 120, carbs: 200, fat: 70 })],
      loggedDates: [TODAY],
      mealCalories: [{ date: TODAY, meal: 'lunch', calories: 2100 }],
      topFoods: [{ name: 'Biryani', calories: 2100, count: 3 }],
    }),
  );

  it('shows that day and nothing it cannot support', () => {
    expect(r.empty).toBe(false);
    // Today is on the chart, and it is over its budget, but it is not a full day until it is over.
    expect(r.calories).toMatchObject({
      ready: true,
      loggedDays: 1,
      countedDays: 1,
      periodDays: 7,
      completeDays: 0,
      lowCoverage: false,
      withinBudgetDays: 0,
      overBudgetDays: 1,
      leftOutDays: 0,
      todayPending: true,
      averageBudget: null,
      budgetText: null,
      note: 'Today is not counted in the averages yet.',
    });
    const calories = on(r.calories);
    // One day is not an average, and on its own evening nothing is missing: no step is offered.
    expect(calories.average).toEqual({ ready: false, reason: 'Today counts once the day is over. An average shows after 3 full days.' });
    expect(calories.bars).toHaveLength(7);
    expect(calories.bars.slice(0, 6).every((b) => b.calories === null && b.status === 'before')).toBe(true);
    expect(calories.bars[6]).toEqual({ date: TODAY, dayIndex: 6, calories: 2100, budget: 2000, status: 'over', complete: false, isToday: true });
    expect(r.macros).toEqual({
      ready: false,
      reason: 'Today counts once the day is over. Your protein, carbs and fat averages show after 3 full days.',
    });
    expect(r.patterns).toEqual({ ready: false, reason: 'Log 5 full days of meals to see your patterns.', action: 'log-food' });
    expect(r.maintenance.ready).toBe(false);
    expect(r.weight.ready).toBe(false);
    expect(r.weeks).toEqual([]);
    expect(r.topFoods).toEqual({ ready: true, foods: [{ name: 'Biryani', calories: 2100, count: 3, share: 1 }], totalCalories: 2100 });
    expect(r.headline).toEqual({ ready: true, text: 'Your first day is logged. An average shows after 3 full days.', tone: 'neutral' });
    expectAllFinite(r);
    expectPlainCopy(r);
  });

  it('starts the streak and the calendar there', () => {
    expect(r.consistency).toMatchObject({ ready: true, loggedDays: 1, countedDays: 1, withinDays: 0, overDays: 1, partialDays: 0, todayOpen: false });
    const consistency = on(r.consistency);
    expect(consistency.text).toBe('Logged 1 of 1 day: 0 full days within budget, 1 over.');
    expect(consistency.skipped).toBeNull();
    expect(consistency.streak).toEqual({ current: 1, best: 1, loggedToday: true });
    expect(consistency.calendar.map((c) => c.status)).toEqual(['before', 'before', 'before', 'before', 'before', 'before', 'over']);
    // The 7 days to Monday 30 November start on Tuesday 24 November.
    expect(consistency.leadingBlanks).toBe(1);
    expect(consistency.calendar[0]).toMatchObject({ date: '2026-11-24', dayOfMonth: 24, weekday: 1, isToday: false });
    expect(consistency.calendar[6]).toMatchObject({ date: TODAY, weekday: 0, isToday: true });
  });
});

describe('calories', () => {
  const start = addDays(TODAY, -6);
  const week = [
    food(day(0, start), 2000),
    food(day(1, start), 1800),
    food(day(2, start), 300, { count: 1 }), // a coffee and a biscuit
    food(day(4, start), 2200),
    food(TODAY, 500, { count: 1 }), // breakfast so far
  ];
  const r = buildInsights(input({ days: 7, dayTotals: week, loggedDates: week.map((d) => d.date) }));

  it('averages complete days only and says what was left out', () => {
    expect(r.calories.ready).toBe(true);
    if (!r.calories.ready) throw new Error('not ready');
    expect(r.calories.average).toEqual({ ready: true, kcal: 2000, vsGoal: 0, days: 3 });
    expect(r.calories).toMatchObject({ loggedDays: 5, countedDays: 7, completeDays: 3, leftOutDays: 1, todayPending: true });
    expect(r.calories.note).toBe('1 day with very little logged was left out of the averages, and today is not counted yet.');
    expect(r.calories.goal).toBe(2000);
    expect(r.calories.chartMax).toBe(2400);
  });

  it('counts days within budget on complete days, and over budget on any day', () => {
    if (!r.calories.ready) throw new Error('not ready');
    expect(r.calories.withinBudgetDays).toBe(2); // 2,000 and 1,800
    expect(r.calories.overBudgetDays).toBe(1); // 2,200
    expect(r.calories.bars.map((b) => b.status)).toEqual(['within', 'within', 'within', 'none', 'over', 'none', 'within']);
    expect(r.calories.bars.map((b) => b.complete)).toEqual([true, true, false, false, true, false, false]);
    expect(r.calories.bars.map((b) => b.calories)).toEqual([2000, 1800, 300, null, 2200, null, 500]);
  });

  it('does not count an empty today as a missed day', () => {
    const past = week.slice(0, 4);
    const quiet = buildInsights(input({ days: 7, dayTotals: past, loggedDates: past.map((d) => d.date) }));
    expect(quiet.calories).toMatchObject({ ready: true, loggedDays: 4, countedDays: 6, todayPending: false });
    expect(on(quiet.calories).note).toBe('1 day with very little logged was left out of the averages.');
  });

  it('pluralises the note and stays quiet when nothing was left out', () => {
    const two = [food(day(0, start), 300), food(day(1, start), 200), food(day(2, start), 2000)];
    const some = buildInsights(input({ days: 7, dayTotals: two, loggedDates: two.map((d) => d.date) }));
    expect(on(some.calories).note).toBe('2 days with very little logged were left out of the averages.');
    const pending = [food(day(5, start), 2000), food(TODAY, 100)];
    const today = buildInsights(input({ days: 7, dayTotals: pending, loggedDates: pending.map((d) => d.date) }));
    expect(on(today.calories).note).toBe('Today is not counted in the averages yet.');
  });

  it('raises the bar for a complete day with the goal', () => {
    const totals = [food(day(0, start), 900)];
    const low = buildInsights(input({ days: 7, dayTotals: totals, loggedDates: [day(0, start)] }));
    expect(low.calories).toMatchObject({ ready: true, completeDays: 1 });
    const high = buildInsights(input({ days: 7, dayTotals: totals, loggedDates: [day(0, start)], goals: { calories: 2500, protein: 100, carbs: 250, fat: 60 } }));
    expect(high.calories).toMatchObject({ ready: true, completeDays: 0, leftOutDays: 1 });
    expect(high.period.completeDayKcal).toBe(1000);
    expect(on(high.calories).average).toEqual({
      ready: false,
      reason: 'No day has enough logged yet. A full day has at least 1,000 kcal logged. An average shows after 3 full days.',
      action: 'log-food',
    });
    expect(high.headline).toEqual({ ready: true, text: 'Meals logged on 1 day. An average shows after 3 full days.', tone: 'neutral' });
  });

  it('adds logged workouts to the day’s budget', () => {
    const d = day(3, start);
    const without = buildInsights(input({ days: 7, dayTotals: [food(d, 2300)], loggedDates: [d] }));
    const withRun = buildInsights(
      input({ days: 7, dayTotals: [food(d, 2300)], loggedDates: [d], exercises: [{ date: d, activity: 'run', minutes: 40, calories: 400 }] }),
    );
    if (!without.calories.ready || !withRun.calories.ready) throw new Error('not ready');
    expect(without.calories.bars[3]).toMatchObject({ budget: 2000, status: 'over' });
    expect(withRun.calories.bars[3]).toMatchObject({ budget: 2400, status: 'within' });
  });

  it('rounds over and under exactly as the day view does', () => {
    const d = day(3, start);
    const hair = buildInsights(input({ days: 7, dayTotals: [food(d, 2000.4)], loggedDates: [d] }));
    const over = buildInsights(input({ days: 7, dayTotals: [food(d, 2000.6)], loggedDates: [d] }));
    if (!hair.calories.ready || !over.calories.ready) throw new Error('not ready');
    expect(hair.calories.bars[3].status).toBe('within');
    expect(over.calories.bars[3].status).toBe('over');
  });

  it('ignores days outside the period', () => {
    const outside = [food(addDays(start, -1), 2500), food(day(0, start), 1500), food(day(1, start), 1500), food(day(2, start), 1500)];
    const r2 = buildInsights(input({ days: 7, dayTotals: outside, loggedDates: outside.map((d) => d.date) }));
    expect(r2.calories).toMatchObject({ ready: true, loggedDays: 3 });
    expect(on(r2.calories).average).toMatchObject({ kcal: 1500, days: 3 });
  });
});

describe('weight', () => {
  it('asks for a weigh-in when there is none', () => {
    const r = buildInsights(input());
    expect(r.weight).toEqual({ ready: false, reason: 'Log your weight to see where it is heading.', action: 'log-weight' });
  });

  it('leads with the invitation when every weigh-in is older than the period', () => {
    const r = buildInsights(input({ days: 7, weights: [{ date: addDays(TODAY, -20), kg: 80 }] }));
    expect(r.weight).toEqual({
      ready: false,
      reason: 'Log your weight to see where it is heading now. Your last weigh-in was 20 days ago.',
      action: 'log-weight',
    });
  });

  it('shows a single weigh-in without inventing a rate or a line', () => {
    const r = buildInsights(input({ weights: [{ date: day(10), kg: 80 }] }));
    expect(r.weight.ready).toBe(true);
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.points).toEqual([{ date: day(10), dayIndex: 10, kg: 80 }]);
    expect(r.weight).toMatchObject({ weighIns: 1, rawChangeKg: null, currentKg: 80, line: null, weekAverages: null, goal: null, recalc: null });
    expect(r.weight.rate.ready).toBe(false);
    expect(r.weight.projection).toMatchObject({ kind: 'no-goal', action: 'set-goal' });
    expect(r.weight.chart).toEqual({ yMin: 79, yMax: 81, goalKg: null, goalOffChart: null });
    expect(r.headline).toEqual({ ready: true, text: 'Your latest weigh-in is 80.0 kg.', tone: 'neutral' });
  });

  it('keeps gaps as gaps and places each weigh-in on its own day', () => {
    const r = buildInsights(input({ weights: steadyLoss }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.points.map((p) => p.dayIndex)).toEqual([0, 7, 14, 21, 28]);
    expect(r.weight.points.map((p) => p.kg)).toEqual([80, 79.5, 79, 78.5, 78]);
    expect(r.weight).toMatchObject({ first: { date: day(0), kg: 80 }, latest: { date: day(28), kg: 78 }, rawChangeKg: -2, weighIns: 5 });
  });

  it('gives the chart the fitted line, from the first to the last weigh-in, in the points’ own days', () => {
    const straight = buildInsights(input({ weights: steadyLoss }));
    expect(on(straight.weight).line).toEqual({ from: { date: day(0), dayIndex: 0, kg: 80 }, to: { date: day(28), dayIndex: 28, kg: 78 } });

    // 80, 79, 79.5 a week apart from 4 November: the line of the fit test, 79.75 falling to 79.25.
    const bumpy = [
      { date: day(3), kg: 80 },
      { date: day(10), kg: 79 },
      { date: day(17), kg: 79.5 },
    ];
    const r = buildInsights(input({ weights: bumpy }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.line).toEqual({ from: { date: day(3), dayIndex: 3, kg: 79.75 }, to: { date: day(17), dayIndex: 17, kg: 79.25 } });
    // The line is the fit, so it is there although the rate is not clear enough to state.
    expect(r.weight.rate).toMatchObject({ ready: true, clear: false, rateText: 'Too early to say' });
    // The chart makes room for 79 to 80 with 0.3 either side, to the half kilo.
    expect(r.weight.chart).toMatchObject({ yMin: 78.5, yMax: 80.5 });

    // Two weigh-ins, or three inside a week: no fit, no line.
    expect(on(buildInsights(input({ weights: steadyLoss.slice(0, 2) })).weight).line).toBeNull();
    expect(on(buildInsights(input({ weights: lineOf(3, 2, 80, -0.1) })).weight).line).toBeNull();
  });

  it('works out the rate, the change and a span of dates for the target', () => {
    const r = buildInsights(input({ weights: steadyLoss, weightGoalKg: 76.2, goalStartDate: day(0), goalStartWeightKg: 80 }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.rate).toEqual({
      ready: true,
      kgPerWeek: -0.5,
      // 0.3 / sqrt(490) x 7
      seKgPerWeek: 0.095,
      clear: true,
      steady: false,
      nowKg: 78,
      changeKg: -2,
      days: 29,
      weighIns: 5,
      fromDate: day(0),
      toDate: day(28),
      direction: 'down',
      towardGoal: true,
      changeText: 'Down 2.0 kg in 29 days',
      rateText: 'Losing 0.5 kg a week',
    });
    // 1.8 kg to go from the fitted 78.0 on 29 November, at 0.0714 kg a day: 25.2 days, so day 26,
    // which is 25 December. The rate is only known to 2 x 0.3 / sqrt(490) = 0.0271 kg a day either way:
    // at 0.0985 it takes 18.3 days (day 19, 18 December), at 0.0443 it takes 40.6 (day 41, 9 January).
    // Those are 22 days apart, so the card gives the span and not one date.
    expect(r.weight.projection).toEqual({
      kind: 'on-track',
      text: 'At this rate you reach 76.2 kg between mid December and early January 2027.',
      date: '2026-12-25',
      daysFromToday: 25,
      range: { earliest: '2026-12-18', latest: '2027-01-09' },
    });
    // 2.0 of the 3.8 kg from 80.0 to 76.2 is done.
    expect(r.weight.goal).toEqual({ kg: 76.2, startKg: 80, startDate: day(0), toGoKg: 1.8, progress: 0.526, reached: false });
    expect(r.weight.chart).toEqual({ yMin: 75.5, yMax: 80.5, goalKg: 76.2, goalOffChart: null });
    expect(r.headline).toEqual({ ready: true, text: 'Down 2.0 kg in 29 days.', tone: 'down' });

    // 1.2 kg to go: 12.2 days at the fast end (day 13, 12 December) and 27.1 at the slow end
    // (day 28, 27 December). Both in one month, so the month is said once.
    const closer = buildInsights(input({ weights: steadyLoss, weightGoalKg: 76.8, goalStartWeightKg: 80 }));
    expect(on(closer.weight).projection).toMatchObject({
      text: 'At this rate you reach 76.8 kg between mid and late December.',
      date: '2026-12-16',
      range: { earliest: '2026-12-12', latest: '2026-12-27' },
    });
  });

  it('gives one date when the two ends of the span are within two weeks of each other', () => {
    // 29 daily weigh-ins: Sxx = 29 x 840 / 12 = 2,030, so the rate is known to 0.6 / sqrt(2,030) = 0.0133 kg a day.
    const daily = lineOf(29, 1, 80, -0.5 / 7);
    // 2.4 kg from the fitted 78.0: 33.6 days at 0.0714 (day 34 after 29 November: 2 January),
    // 28.3 at 0.0847 (day 29) and 41.3 at 0.0581 (day 42). The ends are 13 days apart.
    const near = buildInsights(input({ weights: daily, weightGoalKg: 75.6, goalStartWeightKg: 80 }));
    expect(on(near.weight).projection).toEqual({
      kind: 'on-track',
      text: 'At this rate you reach 75.6 kg around 2 Jan 2027.',
      date: '2027-01-02',
      daysFromToday: 33,
      range: null,
    });
    // 3.9 kg: 46.02 days at the fast end (day 47, 15 January), 67.1 at the slow end (day 68,
    // 5 February): 21 days apart, so a span. One year is enough when both ends fall in it.
    const further = buildInsights(input({ weights: daily, weightGoalKg: 74.1, goalStartWeightKg: 80 }));
    expect(on(further.weight).projection).toMatchObject({
      kind: 'on-track',
      text: 'At this rate you reach 74.1 kg between mid January and early February 2027.',
      range: { earliest: '2027-01-15', latest: '2027-02-05' },
    });
  });

  it('gives only the early end when the slow end of the span is no progress at all', () => {
    // 0.19 kg a week is only just clear: twice its standard error is 0.1897 (see the rate tests),
    // so the slow end is 0.0003 kg a week. The fast end, 0.3797 kg a week = 0.0542 kg a day, covers
    // the 1.0 kg from the fitted 79.24 in 18.4 days: day 19 after 29 November, 18 December.
    const barely = lineOf(5, 7, 80, -0.19 / 7);
    const r = buildInsights(input({ weights: barely, weightGoalKg: 78.24, goalStartWeightKg: 80 }));
    expect(on(r.weight).projection).toMatchObject({
      kind: 'on-track',
      text: 'At this rate you reach 78.2 kg in mid December at the earliest.',
      range: { earliest: '2026-12-18', latest: null },
    });
  });

  it('says plainly when the rate points away from the target', () => {
    const r = buildInsights(input({ weights: steadyLoss, weightGoalKg: 85, goalStartWeightKg: 80 }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.projection).toEqual({ kind: 'away', text: 'Your weight is moving away from 85.0 kg at the moment.' });
    expect(r.weight.rate).toMatchObject({ towardGoal: false });
    expect(r.weight.goal).toMatchObject({ progress: 0, toGoKg: 7, reached: false });
  });

  it('says plainly when the weight is steady', () => {
    const flat = steadyLoss.map((w) => ({ ...w, kg: 80 }));
    const r = buildInsights(input({ weights: flat, weightGoalKg: 75, goalStartWeightKg: 80 }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.projection).toEqual({ kind: 'flat', text: 'Your weight is holding steady, so there is no date for 75.0 kg yet.' });
    expect(r.weight.rate).toMatchObject({ direction: 'flat', steady: true, towardGoal: null, changeText: 'Steady over 29 days', rateText: 'Holding steady' });
    expect(r.headline).toEqual({ ready: true, text: 'Weight steady over 29 days.', tone: 'steady' });
  });

  it('states no direction, no date and no weight in the headline while the rate is not clear', () => {
    // Three weigh-ins over the first week, apparently losing 0.7 kg a week.
    const firstWeek = lineOf(3, 3, 80, -0.1);
    const eaten = [food(day(0), 1900), food(day(1), 1900), food(day(2), 1900)];
    const r = buildInsights(
      input({ weights: firstWeek, weightGoalKg: 75, goalStartWeightKg: 80, dayTotals: eaten, loggedDates: eaten.map((d) => d.date) }),
    );
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.rate).toMatchObject({ ready: true, clear: false, steady: false, direction: null, towardGoal: null, rateText: 'Too early to say' });
    expect(r.weight.projection).toEqual({ kind: 'no-rate', text: 'A date for 75.0 kg shows once your weigh-ins show a clear direction.' });
    // The headline falls through to the calories sentence.
    expect(on(r.headline).text).not.toMatch(/kg|Down|Up|steady/i);
    expect(on(r.headline).tone).toBe('neutral');
    // Without food either, it is the plain latest weigh-in.
    const bare = buildInsights(input({ weights: firstWeek }));
    expect(bare.headline).toEqual({ ready: true, text: 'Your latest weigh-in is 79.4 kg.', tone: 'neutral' });
  });

  it('gives no date when the target is years away', () => {
    // Ninety daily weigh-ins losing 0.07 kg a week: clear (see the rate tests), but 0.01 kg a day
    // takes over 900 days to cover the 9.1 kg from the fitted 79.1 kg to 70.
    const slow = Array.from({ length: 90 }, (_, i) => ({ date: addDays(TODAY, i - 89), kg: 80 - 0.01 * i }));
    const r = buildInsights(input({ days: 90, weights: slow, weightGoalKg: 70, goalStartWeightKg: 80 }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.rate).toMatchObject({ kgPerWeek: -0.07, clear: true, direction: 'down', changeText: 'Down 0.9 kg in 90 days', rateText: 'Losing 0.1 kg a week' });
    expect(r.weight.projection).toEqual({ kind: 'far', text: 'At this rate 70.0 kg is more than 2 years away.' });
  });

  it('knows when the target is reached, in either direction', () => {
    const lose = buildInsights(input({ weights: steadyLoss, weightGoalKg: 78, goalStartWeightKg: 80 }));
    if (!lose.weight.ready) throw new Error('not ready');
    expect(lose.weight.projection).toEqual({ kind: 'reached', text: 'You are at your 78.0 kg target.' });
    expect(lose.weight.goal).toMatchObject({ reached: true, toGoKg: 0, progress: 1 });

    const past = buildInsights(input({ weights: steadyLoss, weightGoalKg: 79, goalStartWeightKg: 80 }));
    expect(on(past.weight).projection.kind).toBe('reached');

    const gain = steadyLoss.map((w, i) => ({ ...w, kg: 60 + 0.5 * i }));
    const up = buildInsights(input({ weights: gain, weightGoalKg: 62, goalStartWeightKg: 60 }));
    if (!up.weight.ready) throw new Error('not ready');
    expect(up.weight.projection.kind).toBe('reached');
    expect(up.weight.rate).toMatchObject({ changeText: 'Up 2.0 kg in 29 days', rateText: 'Gaining 0.5 kg a week' });
    expect(up.headline).toEqual({ ready: true, text: 'Up 2.0 kg in 29 days.', tone: 'up' });
  });

  it('asks for a weigh-in when the line says the target should be reached by now', () => {
    const early = [
      { date: day(0), kg: 80 },
      { date: day(7), kg: 79.5 },
      { date: day(14), kg: 79 },
    ];
    // Three weekly weigh-ins: Sxx 98, twice the standard error 0.6 / sqrt(98) = 0.0606 kg a day,
    // and the slope is 0.0714, so the rate is clear. The line passed 78.9 kg two days after 15 November.
    const r = buildInsights(input({ weights: early, weightGoalKg: 78.9, goalStartWeightKg: 80 }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.rate).toMatchObject({ clear: true });
    expect(r.weight.projection).toEqual({ kind: 'due', text: 'At this rate you should be at 78.9 kg about now. Weigh in to check.' });
  });

  it('waits for enough weigh-ins before projecting, and still shows the plain change between two', () => {
    const r = buildInsights(input({ weights: steadyLoss.slice(0, 2), weightGoalKg: 75, goalStartWeightKg: 80 }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.projection).toEqual({
      kind: 'no-rate',
      text: 'A date for 75.0 kg shows once there are enough weigh-ins to see how fast your weight is changing.',
    });
    expect(r.weight.rate).toMatchObject({ ready: false, action: 'log-weight' });
    // 80.0 on 1 November, 79.5 on 8 November: the one fact two weigh-ins support.
    expect(r.weight).toMatchObject({ rawChangeKg: -0.5, first: { date: day(0), kg: 80 }, latest: { date: day(7), kg: 79.5 } });
  });

  it('has no progress figure without a starting weight', () => {
    const r = buildInsights(input({ weights: steadyLoss, weightGoalKg: 75 }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.goal).toEqual({ kg: 75, startKg: null, startDate: null, toGoKg: 3, progress: null, reached: false });
    expect(r.weight.projection.kind).toBe('on-track');
  });

  it('leaves a far-off target off the chart instead of flattening the data', () => {
    const r = buildInsights(input({ weights: steadyLoss, weightGoalKg: 60, goalStartWeightKg: 80 }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.chart).toEqual({ yMin: 77.5, yMax: 80.5, goalKg: 60, goalOffChart: 'below' });
    const above = buildInsights(input({ weights: steadyLoss, weightGoalKg: 100, goalStartWeightKg: 80 }));
    expect(on(above.weight).chart.goalOffChart).toBe('above');
  });

  it('suggests recalculating targets after 2 kg, and not before', () => {
    const moved = buildInsights(input({ weights: steadyLoss, profile, targetsWeightKg: 80 }));
    if (!moved.weight.ready) throw new Error('not ready');
    const targets = calculateTargets({ ...profile, weightKg: 78 });
    expect(moved.weight.recalc).toEqual({
      fromKg: 80,
      toKg: 78,
      changeKg: -2,
      targets,
      calorieChange: targets.calories - 2000,
      text: 'Your weight has moved 2.0 kg since your targets were set at 80.0 kg. Recalculate them for 78.0 kg.',
    });

    const close = buildInsights(input({ weights: steadyLoss, profile, targetsWeightKg: 79.9 }));
    expect(on(close.weight).recalc).toBeNull();
    const typed = buildInsights(input({ weights: steadyLoss, profile: null, targetsWeightKg: 80 }));
    expect(on(typed.weight).recalc).toBeNull();
    const unknown = buildInsights(input({ weights: steadyLoss, profile, targetsWeightKg: null }));
    expect(on(unknown.weight).recalc).toBeNull();
  });

  it('drops impossible weigh-ins, future ones and repeats of a day', () => {
    const messy = [
      { date: day(3), kg: 80 },
      { date: day(1), kg: 81 },
      { date: day(3), kg: 79.5 }, // a later reading for the same day wins
      { date: day(5), kg: 0 },
      { date: day(6), kg: NaN },
      { date: addDays(TODAY, 3), kg: 70 },
      { date: 'yesterday', kg: 75 },
    ];
    const r = buildInsights(input({ weights: messy }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.points.map((p) => [p.date, p.kg])).toEqual([[day(1), 81], [day(3), 79.5]]);
    expectAllFinite(r);
  });
});

describe('current weight', () => {
  it('is the fitted weight on the latest weigh-in when the last 30 days give a line', () => {
    expect(currentWeightKg(steadyLoss, TODAY)).toBe(78);
    // (0, 80.0), (7, 79.0), (14, 79.6): mean 79.533, Sxy = -7 x 0.467 + 7 x 0.067 = -2.8, slope -2.8 / 98.
    // The line is 79.533 on day 7 and 0.2 kg lower on day 14: 79.33, not the 79.6 the scale read.
    const bumpy = [
      { date: addDays(TODAY, -14), kg: 80 },
      { date: addDays(TODAY, -7), kg: 79 },
      { date: TODAY, kg: 79.6 },
    ];
    expect(currentWeightKg(bumpy, TODAY)).toBe(79.3);
    // In any order, and whatever else is in the list.
    expect(currentWeightKg([...bumpy].reverse(), TODAY)).toBe(79.3);
    expect(currentWeightKg([...bumpy, { date: addDays(TODAY, 2), kg: 60 }, { date: 'soon', kg: 70 }], TODAY)).toBe(79.3);
  });

  it('fits only the last 30 days', () => {
    // The same three weigh-ins, with far heavier ones from before the window: no difference.
    const bumpy = [
      { date: addDays(TODAY, -14), kg: 80 },
      { date: addDays(TODAY, -7), kg: 79 },
      { date: TODAY, kg: 79.6 },
    ];
    const withHistory = [{ date: addDays(TODAY, -60), kg: 90 }, { date: addDays(TODAY, -30), kg: 88 }, ...bumpy];
    expect(currentWeightKg(withHistory, TODAY)).toBe(79.3);
  });

  it('is the mean of up to three close weigh-ins when there is no line', () => {
    // Three weigh-ins inside a week cannot be fitted. (80.0 + 79.4 + 79.9) / 3 = 79.77.
    const burst = [
      { date: addDays(TODAY, -4), kg: 80 },
      { date: addDays(TODAY, -2), kg: 79.4 },
      { date: TODAY, kg: 79.9 },
    ];
    expect(currentWeightKg(burst, TODAY)).toBe(79.8);
    // A fourth, earlier one is left out: only the latest three count.
    expect(currentWeightKg([{ date: addDays(TODAY, -5), kg: 83 }, ...burst], TODAY)).toBe(79.8);
    // Two weigh-ins: (80.0 + 79.5) / 2 = 79.75, shown as 79.8.
    expect(currentWeightKg([{ date: addDays(TODAY, -8), kg: 80 }, { date: addDays(TODAY, -1), kg: 79.5 }], TODAY)).toBe(79.8);
  });

  it('only averages weigh-ins made within 10 days of the latest', () => {
    // 10 days apart: (82 + 80) / 2. 11 days apart: the earlier one says nothing about now.
    expect(currentWeightKg([{ date: addDays(TODAY, -12), kg: 82 }, { date: addDays(TODAY, -2), kg: 80 }], TODAY)).toBe(81);
    expect(currentWeightKg([{ date: addDays(TODAY, -13), kg: 82 }, { date: addDays(TODAY, -2), kg: 80 }], TODAY)).toBe(80);
  });

  it('is the latest weigh-in when that is all there is, and nothing before the first', () => {
    expect(currentWeightKg([{ date: addDays(TODAY, -3), kg: 81.26 }], TODAY)).toBe(81.3);
    expect(currentWeightKg([], TODAY)).toBeNull();
    expect(currentWeightKg([{ date: addDays(TODAY, 1), kg: 80 }, { date: TODAY, kg: 5 }], TODAY)).toBeNull();
  });

  // Four level weigh-ins, then one low morning. Mean 80.3; Sxy = -14 x 0.1 - 7 x 0.1 + 7 x 0.1 - 14 x 0.4 = -7,
  // Sxx 490, so the line falls 0.0143 kg a day and is at 80.3 - 14 x 0.0143 = 80.1 on the last day.
  const oneLowMorning = [80.4, 80.4, 80.4, 80.4, 79.9].map((kg, i) => ({ date: day(7 * i), kg }));

  it('does not call the target reached, or the targets out of date, on one low weigh-in', () => {
    expect(currentWeightKg(oneLowMorning, TODAY)).toBe(80.1);
    const r = buildInsights(
      input({ weights: oneLowMorning, weightGoalKg: 80, goalStartDate: day(0), goalStartWeightKg: 82, profile, targetsWeightKg: 82 }),
    );
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight).toMatchObject({ latest: { kg: 79.9 }, currentKg: 80.1 });
    // The reading is at the target, the weight is not: say so, and keep counting.
    expect(r.weight.projection).toEqual({ kind: 'latest-at-target', text: 'Your latest weigh-in is at your 80.0 kg target. A few more will confirm it.' });
    // 1.9 of the 2.0 kg from 82.0 is done.
    expect(r.weight.goal).toEqual({ kg: 80, startKg: 82, startDate: day(0), toGoKg: 0.1, progress: 0.95, reached: false });
    // The reading is 2.1 kg from the 82.0 the targets were set at; the weight is 1.9 kg from it.
    expect(r.weight.recalc).toBeNull();
  });

  it('recalculates for the current weight, rounded, once that has moved 2 kg', () => {
    const r = buildInsights(input({ weights: oneLowMorning, profile, targetsWeightKg: 82.1 }));
    const recalc = on(r.weight).recalc;
    expect(recalc).toMatchObject({ fromKg: 82.1, toKg: 80.1, changeKg: -2 });
    expect(recalc?.targets).toEqual(calculateTargets({ ...profile, weightKg: 80.1 }));
    expect(recalc?.text).toBe('Your weight has moved 2.0 kg since your targets were set at 82.1 kg. Recalculate them for 80.1 kg.');
  });

  it('words a target met by a single weigh-in as a reading', () => {
    const r = buildInsights(input({ weights: [{ date: day(20), kg: 80 }], weightGoalKg: 80, goalStartWeightKg: 82 }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.projection).toEqual({ kind: 'reached', text: 'Your latest weigh-in is at your 80.0 kg target.' });
    expect(r.weight.goal).toMatchObject({ reached: true, toGoKg: 0, progress: 1 });
  });

  it('reads the same on every period', () => {
    // Two months level at 82 kg, weighed weekly, then the month of steady loss down to 78.
    const plateau = Array.from({ length: 8 }, (_, i) => ({ date: addDays(day(0), -7 * (i + 1)), kg: 82 }));
    const weights = [...plateau, ...steadyLoss];
    const built = ([7, 30, 90] as const).map((days) =>
      on(buildInsights(input({ days, weights, weightGoalKg: 76.2, goalStartDate: day(0), goalStartWeightKg: 80, profile, targetsWeightKg: 80 })).weight),
    );
    for (const w of built) {
      expect(w.currentKg).toBe(78);
      expect(w.goal).toEqual({ kg: 76.2, startKg: 80, startDate: day(0), toGoKg: 1.8, progress: 0.526, reached: false });
      expect(w.recalc).toMatchObject({ fromKg: 80, toKg: 78, changeKg: -2 });
    }
    // The 90-day line runs through the plateau as well, so its own fitted weight is higher than
    // 78.0. Nothing about the target follows it.
    const ninety = built[2].rate;
    if (!ninety.ready) throw new Error('not ready');
    expect(ninety.weighIns).toBe(13);
    expect(ninety.nowKg).toBeGreaterThan(78.2);
  });
});

describe('the 7-day view', () => {
  // A month of daily weigh-ins ending today, 80.0 down to 78.0.
  const month = Array.from({ length: 30 }, (_, i) => ({ date: day(i), kg: 80 - (2 / 29) * i }));
  const TOO_SHORT = { ready: false, reason: 'A week is too short to tell a real change from day-to-day swings.', action: 'longer-period' };

  it('fits no rate and draws no line of its own, and points to 30 days', () => {
    const r = buildInsights(input({ days: 7, weights: month }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.points).toHaveLength(7);
    expect(r.weight.rate).toEqual(TOO_SHORT);
    expect(r.weight.line).toBeNull();
    // The headline has no weight half in this view.
    expect(r.headline).toEqual({ ready: true, text: 'Your latest weigh-in is 78.0 kg.', tone: 'neutral' });
  });

  it('takes the date for the target from the last 30 days, and says so', () => {
    // 30 daily weigh-ins: Sxx = 30 x 899 / 12 = 2,247.5, so the rate (2 / 29 = 0.069 kg a day) is
    // known to 0.6 / sqrt(2,247.5) = 0.0127. 2.4 kg from today's fitted 78.0: 34.8 days (day 35,
    // 4 January), 29.4 at the fast end (day 30) and 42.6 at the slow end (day 43): 13 days apart.
    const r = buildInsights(input({ days: 7, weights: month, weightGoalKg: 75.6, goalStartWeightKg: 80 }));
    expect(on(r.weight).projection).toEqual({
      kind: 'on-track',
      text: 'From the last 30 days: at this rate you reach 75.6 kg around 4 Jan 2027.',
      date: '2027-01-04',
      daysFromToday: 35,
      range: null,
    });
    // The 30-day view gives the same date, without the lead-in.
    const thirty = buildInsights(input({ days: 30, weights: month, weightGoalKg: 75.6, goalStartWeightKg: 80 }));
    expect(on(thirty.weight).projection).toMatchObject({ text: 'At this rate you reach 75.6 kg around 4 Jan 2027.', date: '2027-01-04' });

    const flat = month.map((w) => ({ ...w, kg: 80 }));
    const steady = buildInsights(input({ days: 7, weights: flat, weightGoalKg: 75, goalStartWeightKg: 82 }));
    expect(on(steady.weight).projection).toEqual({
      kind: 'flat',
      text: 'From the last 30 days: your weight is holding steady, so there is no date for 75.0 kg yet.',
    });
    // Reaching the target does not come from a rate, so it carries no lead-in.
    const there = buildInsights(input({ days: 7, weights: month, weightGoalKg: 78, goalStartWeightKg: 80 }));
    expect(on(there.weight).projection).toEqual({ kind: 'reached', text: 'You are at your 78.0 kg target.' });
  });

  it('says what to log when the last 30 days have no rate either', () => {
    // A first week: one weigh-in, two days ago.
    const r = buildInsights(input({ days: 7, weights: [{ date: addDays(TODAY, -2), kg: 80 }], weightGoalKg: 75, goalStartWeightKg: 80 }));
    if (!r.weight.ready) throw new Error('not ready');
    expect(r.weight.rate).toEqual({
      ready: false,
      reason: 'Log 2 more weigh-ins to see how fast your weight is changing. That takes 3 weigh-ins over at least a week.',
      action: 'log-weight',
    });
    expect(r.weight.projection).toEqual({
      kind: 'no-rate',
      text: 'A date for 75.0 kg shows once there are enough weigh-ins to see how fast your weight is changing.',
    });
  });

  it('never tells a Monday, Wednesday and Friday weigher to keep weighing in for a week', () => {
    // 30 November 2026 is a Monday. Five weeks of Mon, Wed, Fri weigh-ins, then each day of a week as today.
    const habit = Array.from({ length: 42 }, (_, i) => addDays(TODAY, i - 35))
      .filter((d) => [1, 3, 5].includes(new Date(`${d}T12:00:00`).getDay()))
      .map((date, i) => ({ date, kg: 80 - 0.1 * i }));
    for (let i = 0; i < 7; i++) {
      const today = addDays(TODAY, i);
      const r = buildInsights(input({ today, days: 7, weights: habit }));
      if (!r.weight.ready) throw new Error(`not ready on ${today}`);
      expect(r.weight.rate).toEqual(TOO_SHORT);
    }
  });

  it('compares the two weekly averages when each week has two weigh-ins', () => {
    const weights = [
      { date: addDays(TODAY, -12), kg: 81.2 },
      { date: addDays(TODAY, -8), kg: 80.8 }, // the week before: 81.0 on average
      { date: addDays(TODAY, -5), kg: 80.6 },
      { date: addDays(TODAY, -3), kg: 80.2 },
      { date: TODAY, kg: 80.4 }, // this week: 80.4 on average
    ];
    const r = buildInsights(input({ days: 7, weights }));
    expect(on(r.weight).weekAverages).toEqual({
      thisWeek: { average: 80.4, weighIns: 3 },
      lastWeek: { average: 81, weighIns: 2 },
      changeKg: -0.6,
      text: 'Your weigh-ins averaged 80.4 kg over the last 7 days, 0.6 kg lower than the 7 days before (3 and 2 weigh-ins).',
    });
    // Only the 7-day view has it.
    expect(on(buildInsights(input({ days: 30, weights })).weight).weekAverages).toBeNull();

    const higher = weights.map((w, i) => (i < 2 ? { ...w, kg: 80 } : w));
    expect(on(buildInsights(input({ days: 7, weights: higher })).weight).weekAverages?.text).toBe(
      'Your weigh-ins averaged 80.4 kg over the last 7 days, 0.4 kg higher than the 7 days before (3 and 2 weigh-ins).',
    );
    const same = weights.map((w, i) => (i < 2 ? { ...w, kg: 80.4 } : w));
    expect(on(buildInsights(input({ days: 7, weights: same })).weight).weekAverages).toMatchObject({
      changeKg: 0,
      text: 'Your weigh-ins averaged 80.4 kg over the last 7 days, the same as the 7 days before (3 and 2 weigh-ins).',
    });
  });

  it('gives no weekly comparison with a single weigh-in in either week', () => {
    const oneBefore = [
      { date: addDays(TODAY, -8), kg: 80.8 },
      { date: addDays(TODAY, -5), kg: 80.6 },
      { date: TODAY, kg: 80.4 },
    ];
    expect(on(buildInsights(input({ days: 7, weights: oneBefore })).weight).weekAverages).toBeNull();
    const oneNow = [
      { date: addDays(TODAY, -12), kg: 81.2 },
      { date: addDays(TODAY, -8), kg: 80.8 },
      { date: TODAY, kg: 80.4 },
    ];
    expect(on(buildInsights(input({ days: 7, weights: oneNow })).weight).weekAverages).toBeNull();
    // A weigh-in 14 days back is outside both weeks.
    const tooOld = [{ date: addDays(TODAY, -14), kg: 81.2 }, ...oneBefore];
    expect(on(buildInsights(input({ days: 7, weights: tooOld })).weight).weekAverages).toBeNull();
  });
});

describe('once today has its weigh-in', () => {
  const full = Array.from({ length: 30 }, (_, i) => food(day(i), 1900));
  const eaten = { dayTotals: full, loggedDates: full.map((d) => d.date) };

  it('knows whether today is weighed', () => {
    expect(buildInsights(input({ weights: [{ date: TODAY, kg: 80 }] })).weighedToday).toBe(true);
    expect(buildInsights(input({ weights: [{ date: addDays(TODAY, -1), kg: 80 }] })).weighedToday).toBe(false);
    expect(buildInsights(input()).weighedToday).toBe(false);
  });

  it('offers no "Log weight" for the rate, and says when the next weigh-in can be made', () => {
    const before = buildInsights(input({ weights: [{ date: addDays(TODAY, -1), kg: 80 }] }));
    expect(on(before.weight).rate).toEqual({
      ready: false,
      reason: 'Log 2 more weigh-ins to see how fast your weight is changing. That takes 3 weigh-ins over at least a week.',
      action: 'log-weight',
    });
    const after = buildInsights(input({ weights: [{ date: TODAY, kg: 80 }] }));
    expect(after.weight.ready).toBe(true);
    expect(on(after.weight).rate).toEqual({
      ready: false,
      reason: 'Log 2 more weigh-ins to see how fast your weight is changing. That takes 3 weigh-ins over at least a week. Weigh in again tomorrow.',
    });
    // The same in the 7-day view, where the reason comes from the last 30 days.
    const week = buildInsights(input({ days: 7, weights: [{ date: TODAY, kg: 80 }] }));
    expect(on(week.weight).rate).toEqual(on(after.weight).rate);
  });

  it('does the same for what you actually burn', () => {
    const before = buildInsights(input({ ...eaten, weights: [{ date: addDays(TODAY, -1), kg: 80 }] }));
    expect(before.maintenance).toEqual({
      ready: false,
      reason: 'Log 3 more weigh-ins to estimate what you burn. That takes 4 weigh-ins over at least 2 weeks, with your meals logged in between.',
      action: 'log-weight',
    });
    const after = buildInsights(input({ ...eaten, weights: [{ date: TODAY, kg: 80 }] }));
    expect(after.maintenance).toEqual({
      ready: false,
      reason:
        'Log 3 more weigh-ins to estimate what you burn. That takes 4 weigh-ins over at least 2 weeks, with your meals logged in between. Weigh in again tomorrow.',
    });
    // Four weigh-ins that end today but are only 9 days apart.
    const tight = [9, 6, 3, 0].map((ago, i) => ({ date: addDays(TODAY, -ago), kg: 80 - 0.1 * i }));
    expect(buildInsights(input({ ...eaten, weights: tight })).maintenance).toEqual({
      ready: false,
      reason: 'Your weigh-ins are 9 days apart. Keep weighing in until the first and the last are at least 14 days apart. Weigh in again tomorrow.',
    });
  });

  it('leaves every other step alone', () => {
    // Weigh-ins are in place and today is weighed, but the meals are missing: that is still a step to offer.
    const weights = [21, 14, 7, 0].map((ago, i) => ({ date: addDays(TODAY, -ago), kg: 80 - 0.5 * i }));
    const r = buildInsights(input({ weights }));
    expect(r.weighedToday).toBe(true);
    expect(r.maintenance).toMatchObject({ ready: false, action: 'log-food' });
    expect(off(r.maintenance).reason).not.toContain('tomorrow');
    // And a clear rate is untouched.
    expect(on(r.weight).rate).toMatchObject({ ready: true, clear: true });
  });
});

describe('where the charts start', () => {
  const startedOn = (date: string, days: 7 | 30 | 90) => buildInsights(input({ days, weights: [{ date, kg: 80 }] })).period;

  it('starts at the first day of use when that is inside the period', () => {
    // First weigh-in 29 days ago: the 30th day back.
    const first = addDays(TODAY, -29);
    expect(startedOn(first, 90)).toMatchObject({ from: addDays(TODAY, -89), chartFrom: first, chartDays: 30 });
    expect(startedOn(first, 30)).toMatchObject({ from: first, chartFrom: first, chartDays: 30 });
    expect(startedOn(first, 7)).toMatchObject({ from: addDays(TODAY, -6), chartFrom: addDays(TODAY, -6), chartDays: 7 });
  });

  it('starts at the period when the app was in use before it', () => {
    const first = addDays(TODAY, -200);
    expect(startedOn(first, 90)).toMatchObject({ chartFrom: addDays(TODAY, -89), chartDays: 90 });
    expect(startedOn(first, 30)).toMatchObject({ chartFrom: addDays(TODAY, -29), chartDays: 30 });
    expect(startedOn(first, 7)).toMatchObject({ chartFrom: addDays(TODAY, -6), chartDays: 7 });
  });

  it('never covers fewer than 7 days', () => {
    // First use 3 days ago, or today.
    for (const first of [addDays(TODAY, -3), TODAY]) {
      expect(startedOn(first, 90)).toMatchObject({ chartFrom: addDays(TODAY, -6), chartDays: 7 });
      expect(startedOn(first, 30)).toMatchObject({ chartFrom: addDays(TODAY, -6), chartDays: 7 });
      expect(startedOn(first, 7)).toMatchObject({ chartFrom: addDays(TODAY, -6), chartDays: 7 });
    }
    // Exactly 7 days of use.
    expect(startedOn(addDays(TODAY, -6), 90)).toMatchObject({ chartFrom: addDays(TODAY, -6), chartDays: 7 });
    expect(startedOn(addDays(TODAY, -7), 90)).toMatchObject({ chartFrom: addDays(TODAY, -7), chartDays: 8 });
  });

  it('counts from the earliest of the first meal, workout and weigh-in', () => {
    const meal = addDays(TODAY, -20);
    const base = { days: 90 as const, dayTotals: [food(meal, 1900)], loggedDates: [meal] };
    expect(buildInsights(input(base)).period).toMatchObject({ chartFrom: meal, chartDays: 21 });
    const withWorkout = buildInsights(input({ ...base, firstExerciseDate: addDays(TODAY, -40) }));
    expect(withWorkout.period).toMatchObject({ chartFrom: addDays(TODAY, -40), chartDays: 41 });
    const withWeighIn = buildInsights(input({ ...base, firstExerciseDate: addDays(TODAY, -40), weights: [{ date: addDays(TODAY, -55), kg: 80 }] }));
    expect(withWeighIn.period).toMatchObject({ chartFrom: addDays(TODAY, -55), chartDays: 56 });
  });

  it('is the whole period while nothing is logged, and leaves every dayIndex counting from the period', () => {
    expect(buildInsights(input({ days: 90 })).period).toMatchObject({ chartFrom: addDays(TODAY, -89), chartDays: 90 });
    const r = buildInsights(input({ days: 90, weights: [{ date: addDays(TODAY, -29), kg: 80 }] }));
    expect(on(r.weight).points).toEqual([{ date: addDays(TODAY, -29), dayIndex: 60, kg: 80 }]);
  });
});

describe('what you actually burn', () => {
  const fullDays = Array.from({ length: 29 }, (_, i) => food(day(i), 1900));
  const base = { weights: steadyLoss, dayTotals: fullDays, loggedDates: fullDays.map((d) => d.date) };
  const NOTE = 'It assumes everything you ate is logged. Anything missed makes the real figure higher. More weigh-ins narrow the range.';
  const goals = (calories: number) => ({ calories, protein: 100, carbs: 250, fat: 60 });

  it('is a range: intake minus the weight change, 2 standard errors either way, at 7,700 kcal a kg', () => {
    const r = buildInsights(input({ ...base, profile }));
    // Losing 0.5 kg a week is 0.0714 kg a day, or 550 kcal a day: 1,900 + 550 = 2,450 in the middle.
    // Five weekly weigh-ins leave the rate known to 2 x 0.3 / sqrt(490) = 0.0271 kg a day, which is
    // 208.7 kcal: 2,241 to 2,659, shown as 2,250 to 2,650.
    expect(r.maintenance).toEqual({
      ready: true,
      kcal: 2450,
      low: 2250,
      high: 2650,
      rangeText: 'Likely between 2,250 and 2,650 kcal',
      averageIntake: 1900,
      kgPerWeek: -0.5,
      rateClear: true,
      rateSteady: false,
      // Mifflin-St Jeor: 10 * 78 + 6.25 * 175 - 5 * 30 + 5 = 1,728.75, times 1.55 = 2,679.6.
      formulaKcal: 2680,
      formulaVsRange: 'above',
      formulaText: 'The targets calculator in Settings gives 2,680 kcal for your age, height, weight and activity, more than this range.',
      goal: {
        kcal: 2000,
        kind: 'deficit',
        // 2,250 - 2,000 and 2,650 - 2,000; times 7 / 7,700 is 0.23 and 0.59 kg a week.
        gapKcal: { min: 250, max: 650 },
        gapKgPerWeek: { min: 0.2, max: 0.6 },
        text: 'Your 2,000 kcal goal is 250 to 650 kcal less than you burn, about 0.2 to 0.6 kg lost a week.',
      },
      basis: { weighIns: 5, completeDays: 29, windowDays: 29, fromDate: day(0), toDate: day(28) },
      // 400 kcal wide.
      confidence: 'fair',
      note: `An estimate from 5 weigh-ins and 29 full days of meals. ${NOTE}`,
    });
    expect(r.headline).toEqual({ ready: true, text: 'Down 2.0 kg in 29 days, eating 1,900 kcal a day on average.', tone: 'down' });
  });

  it('calls the goal a deficit or a surplus only when it is outside the range', () => {
    const surplus = buildInsights(input({ ...base, goals: goals(2800) }));
    if (!surplus.maintenance.ready) throw new Error('not ready');
    expect(surplus.maintenance.goal).toEqual({
      kcal: 2800,
      kind: 'surplus',
      // 2,800 - 2,650 and 2,800 - 2,250; 0.14 and 0.5 kg a week.
      gapKcal: { min: 150, max: 550 },
      gapKgPerWeek: { min: 0.1, max: 0.5 },
      text: 'Your 2,800 kcal goal is 150 to 550 kcal more than you burn, about 0.1 to 0.5 kg gained a week.',
    });
    expect(surplus.maintenance.formulaKcal).toBeNull();
    expect(surplus.maintenance.formulaVsRange).toBeNull();
    expect(surplus.maintenance.formulaText).toBeNull();

    // Anywhere from 2,250 to 2,650 is inside the range, the two ends included.
    for (const inside of [2250, 2480, 2650]) {
      const level = buildInsights(input({ ...base, goals: goals(inside) }));
      if (!level.maintenance.ready) throw new Error('not ready');
      expect(level.maintenance.goal).toEqual({
        kcal: inside,
        kind: 'maintenance',
        gapKcal: null,
        gapKgPerWeek: null,
        text: `Your ${inside.toLocaleString('en-US')} kcal goal is close to what you burn.`,
      });
    }
    // Just under it, the near end of the gap is too small to be a weight change: 50 kcal is 0.05 kg a week.
    const justUnder = buildInsights(input({ ...base, goals: goals(2200) }));
    expect(on(justUnder.maintenance).goal).toMatchObject({
      kind: 'deficit',
      gapKcal: { min: 50, max: 450 },
      text: 'Your 2,200 kcal goal is 50 to 450 kcal less than you burn, up to 0.4 kg lost a week.',
    });
    const justOver = buildInsights(input({ ...base, goals: goals(2700) }));
    expect(on(justOver.maintenance).goal).toMatchObject({ kind: 'surplus', gapKcal: { min: 50, max: 450 } });
  });

  it('compares the calculator with the range, not with one number', () => {
    // The calculator gives 2,680 for this profile. Eating 2,000 a day puts the range at 2,350 to 2,750.
    const eating2000 = Array.from({ length: 29 }, (_, i) => food(day(i), 2000));
    const within = buildInsights(input({ weights: steadyLoss, dayTotals: eating2000, loggedDates: eating2000.map((d) => d.date), profile }));
    expect(within.maintenance).toMatchObject({
      ready: true,
      kcal: 2550,
      low: 2350,
      high: 2750,
      formulaKcal: 2680,
      formulaVsRange: 'within',
      formulaText: 'The targets calculator in Settings gives about the same, 2,680 kcal for your age, height, weight and activity.',
    });
    // Eating 2,400 a day puts it at 2,750 to 3,150, and the calculator is under that.
    const eating2400 = Array.from({ length: 29 }, (_, i) => food(day(i), 2400));
    const below = buildInsights(input({ weights: steadyLoss, dayTotals: eating2400, loggedDates: eating2400.map((d) => d.date), profile }));
    expect(below.maintenance).toMatchObject({
      low: 2750,
      high: 3150,
      formulaVsRange: 'below',
      formulaText: 'The targets calculator in Settings gives 2,680 kcal for your age, height, weight and activity, less than this range.',
    });
  });

  it('takes its confidence from the width of the range', () => {
    // The margin either side is 2 x 0.3 x 7,700 / sqrt(Sxx) = 4,620 / sqrt(Sxx), around a middle of 2,450.
    const check = (weights: WeighIn[], low: number, high: number, confidence: string) => {
      const r = buildInsights(input({ ...base, weights }));
      expect(r.maintenance).toMatchObject({ ready: true, kcal: 2450, low, high, confidence });
      return on(r.maintenance);
    };
    // 29 daily weigh-ins: Sxx 2,030, margin 102.5. 2,347 to 2,553: 200 wide.
    const good = check(lineOf(29, 1, 80, -0.5 / 7), 2350, 2550, 'good');
    expect(good.note).toBe(`An estimate from 29 weigh-ins and 29 full days of meals. ${NOTE}`);
    // 15 weigh-ins every other day: Sxx = 4 x 280 = 1,120, margin 138.1. 2,312 to 2,588: 300 wide.
    check(lineOf(15, 2, 80, -0.5 / 7), 2300, 2600, 'fair');
    // 5 weekly weigh-ins: 400 wide (above).
    check(steadyLoss, 2250, 2650, 'fair');
    // 5 weigh-ins 6 days apart: Sxx = 36 x 10 = 360, margin 243.5. 2,206 to 2,694: 500 wide.
    const rough = check(lineOf(5, 6, 80, -0.5 / 7), 2200, 2700, 'rough');
    expect(rough.note).toBe(`A rough estimate from 5 weigh-ins and 25 full days of meals. ${NOTE}`);
  });

  it('is not shown while the range is more than 600 kcal wide', () => {
    // 4 weekly weigh-ins: Sxx = 49 x 5 = 245, margin 295.2. 2,155 to 2,745, shown as 2,150 to 2,750: just narrow enough.
    const justEnough = buildInsights(input({ ...base, weights: lineOf(4, 7, 80, -0.5 / 7) }));
    expect(justEnough.maintenance).toMatchObject({ ready: true, kcal: 2450, low: 2150, high: 2750, confidence: 'rough' });
    expect(on(justEnough.maintenance).rangeText).toBe('Likely between 2,150 and 2,750 kcal');

    // Days 0, 5, 10 and 18: mean 8.25, Sxx = 68.06 + 10.56 + 3.06 + 95.06 = 176.75, margin 347.5.
    // 2,102 to 2,798, shown as 2,100 to 2,800: 700 wide. The spec's minimums are met (4 weigh-ins,
    // 18 days), but the figure would be a guess.
    const tooWide = [0, 5, 10, 18].map((d) => ({ date: day(d), kg: 80 - (0.5 / 7) * d }));
    const r = buildInsights(input({ ...base, weights: tooWide }));
    expect(r.maintenance).toEqual({
      ready: false,
      reason: 'Your weigh-ins put this between 2,100 and 2,800 kcal a day, too wide to be useful yet. More weigh-ins narrow it.',
      action: 'log-weight',
    });
  });

  it('uses the slope whether or not it is clear enough to state as a rate', () => {
    // A level weight is not a rate to state, but it is a fine basis: what is eaten is what is burned.
    const flat = steadyLoss.map((w) => ({ ...w, kg: 80 }));
    const r = buildInsights(input({ ...base, weights: flat }));
    expect(on(r.weight).rate).toMatchObject({ clear: false, steady: true });
    expect(r.maintenance).toMatchObject({ ready: true, kcal: 1900, low: 1700, high: 2100, kgPerWeek: 0, rateClear: false, rateSteady: true });
    // Four weekly weigh-ins losing 0.2 kg a week: under twice the standard error (0.268), and that
    // is under 0.3, so the Weight card says "Holding steady". The estimate still uses the 0.2.
    const slight = buildInsights(input({ ...base, weights: lineOf(4, 7, 80, -0.2 / 7) }));
    expect(on(slight.weight).rate).toMatchObject({ clear: false, steady: true, rateText: 'Holding steady' });
    // 1,900 + 0.2 / 7 x 7,700 = 2,120, give or take 295: 1,825 to 2,415.
    expect(slight.maintenance).toMatchObject({ ready: true, kcal: 2100, low: 1800, high: 2400, kgPerWeek: -0.2, rateClear: false, rateSteady: true });
    expect(on(r.maintenance).goal).toMatchObject({ kind: 'maintenance', text: 'Your 2,000 kcal goal is close to what you burn.' });
  });

  it('keeps both ends of the range inside what a body can burn', () => {
    // A level weight on 1,100 kcal a day: 1,100 give or take 208.7 is 891 to 1,309. Nobody burns
    // under 1,000, so the low end stops there; the width is still judged on the 400 it really is.
    const little = Array.from({ length: 29 }, (_, i) => food(day(i), 1100));
    const flat = steadyLoss.map((w) => ({ ...w, kg: 80 }));
    const r = buildInsights(input({ weights: flat, dayTotals: little, loggedDates: little.map((d) => d.date) }));
    expect(r.maintenance).toMatchObject({ ready: true, kcal: 1100, low: 1000, high: 1300, confidence: 'fair' });
    expect(on(r.maintenance).rangeText).toBe('Likely between 1,000 and 1,300 kcal');
  });

  it('needs four weigh-ins', () => {
    const r = buildInsights(input({ ...base, weights: steadyLoss.slice(0, 3) }));
    expect(r.maintenance).toMatchObject({ ready: false, action: 'log-weight' });
    expect(off(r.maintenance).reason).toContain('Log 1 more weigh-in ');
  });

  it('needs fourteen days between the first and the last weigh-in', () => {
    const tight = [0, 4, 9, 13].map((d, i) => ({ date: day(d), kg: 80 - 0.2 * i }));
    const r = buildInsights(input({ ...base, weights: tight }));
    expect(r.maintenance).toMatchObject({ ready: false, action: 'log-weight' });
    expect(off(r.maintenance).reason).toContain('13 days apart');
  });

  it('needs complete days on 60% of the days between the weigh-ins', () => {
    const weights = lineOf(4, 7, 80, -0.5 / 7);
    // 22 days from the first weigh-in to the last, and 60% of 22 is 13.2, so 14 complete days are needed.
    const fourteen = Array.from({ length: 14 }, (_, i) => food(day(i), 1900));
    const enough = buildInsights(input({ weights, dayTotals: fourteen, loggedDates: fourteen.map((d) => d.date) }));
    expect(enough.maintenance).toMatchObject({ ready: true, basis: { weighIns: 4, completeDays: 14, windowDays: 22 } });

    const thirteen = [...fourteen.slice(0, 13), food(day(13), 400)];
    const short = buildInsights(input({ weights, dayTotals: thirteen, loggedDates: thirteen.map((d) => d.date) }));
    expect(short.maintenance).toEqual({
      ready: false,
      reason: 'Meals were fully logged on 13 of the 22 days between your weigh-ins. This needs at least 14.',
      action: 'log-food',
    });
  });

  it('uses only the days between the weigh-ins for the intake', () => {
    const weights = lineOf(4, 7, 80, -0.5 / 7);
    const totals = [...Array.from({ length: 22 }, (_, i) => food(day(i), 1900)), ...Array.from({ length: 7 }, (_, i) => food(day(22 + i), 3000))];
    const r = buildInsights(input({ weights, dayTotals: totals, loggedDates: totals.map((d) => d.date) }));
    expect(r.maintenance).toMatchObject({ ready: true, averageIntake: 1900 });
  });

  it('is not offered over 7 days, and offers 30 instead', () => {
    const r = buildInsights(input({ ...base, days: 7 }));
    expect(r.maintenance).toEqual({ ready: false, reason: 'This needs at least two weeks of weigh-ins and meals.', action: 'longer-period' });
  });

  it('refuses an estimate no body could have', () => {
    const crash = [0, 5, 10, 14].map((d) => ({ date: day(d), kg: 90 - 0.6 * d }));
    const heavy = Array.from({ length: 15 }, (_, i) => food(day(i), 3000));
    const r = buildInsights(input({ weights: crash, dayTotals: heavy, loggedDates: heavy.map((d) => d.date) }));
    expect(r.maintenance.ready).toBe(false);
    expect(off(r.maintenance).reason).toContain('do not line up');
  });
});

describe('macros', () => {
  const start = addDays(TODAY, -6);
  const totals = [
    food(day(0, start), 2000, { protein: 100, carbs: 240, fat: 55 }),
    food(day(1, start), 2000, { protein: 120, carbs: 250, fat: 60 }),
    food(day(2, start), 2000, { protein: 80, carbs: 260, fat: 65 }),
    food(day(3, start), 300, { protein: 5, carbs: 40, fat: 10 }), // left out
  ];

  it('averages complete days against the goals and counts protein days', () => {
    const r = buildInsights(input({ days: 7, dayTotals: totals, loggedDates: totals.map((d) => d.date) }));
    expect(r.macros).toEqual({
      ready: true,
      days: 3,
      protein: { average: 100, goal: 100, ratio: 1 },
      carbs: { average: 250, goal: 250, ratio: 1 },
      fat: { average: 60, goal: 60, ratio: 1 },
      proteinDays: 2, // 100 and 120 reach 90 g; 80 does not
      // 400, 1,000 and 540 kcal of 1,940
      split: { protein: 0.206, carbs: 0.515, fat: 0.278 },
      note: '1 day with very little logged was left out of the averages.',
    });
  });

  it('copes with goals of zero', () => {
    const r = buildInsights(input({ days: 7, dayTotals: totals, loggedDates: totals.map((d) => d.date), goals: { calories: 0, protein: 0, carbs: 0, fat: 0 } }));
    expect(r.macros).toMatchObject({ ready: true, protein: { goal: 0, ratio: null }, proteinDays: 0 });
    expectAllFinite(r);
    expectPlainCopy(r);
  });

  it('waits for a complete day', () => {
    const partial = buildInsights(input({ days: 7, dayTotals: [totals[3]], loggedDates: [totals[3].date] }));
    expect(partial.macros).toMatchObject({ ready: false, action: 'log-food' });
    expect(off(partial.macros).reason).toContain('No day has enough logged yet');
    const none = buildInsights(input({ days: 7 }));
    expect(off(none.macros).reason).toContain('Log your meals');
  });
});

describe('exercise', () => {
  const workouts = [
    { date: day(1), activity: 'run' as const, minutes: 30, calories: 300 },
    { date: day(1), activity: 'walk' as const, minutes: 60, calories: 200 },
    { date: day(3), activity: 'run' as const, minutes: 50, calories: 450 },
    { date: addDays(FROM_30, -1), activity: 'swim' as const, minutes: 90, calories: 700 }, // before the period
  ];

  it('totals the period and ranks activities by time', () => {
    const r = buildInsights(input({ exercises: workouts, firstExerciseDate: addDays(FROM_30, -1) }));
    expect(r.exercise.ready).toBe(true);
    if (!r.exercise.ready) throw new Error('not ready');
    expect(r.exercise).toMatchObject({ workouts: 3, minutes: 140, calories: 950, activeDays: 2 });
    // 30 days is 4.29 weeks: 3 / 4.29 = 0.7 workouts and 140 / 4.29 = 32.7 minutes.
    expect(r.exercise.perWeek).toEqual({ workouts: 0.7, minutes: 33 });
    expect(r.exercise.top).toEqual([
      { activity: 'run', label: 'Run', icon: 'run', minutes: 80, workouts: 2, calories: 750, share: 0.571 },
      { activity: 'walk', label: 'Walk', icon: 'walk', minutes: 60, workouts: 1, calories: 200, share: 0.429 },
    ]);
    expect(r.exercise.daily).toHaveLength(30);
    expect(r.exercise.daily[1]).toEqual({ date: day(1), dayIndex: 1, minutes: 90, calories: 500, workouts: 2 });
    expect(r.exercise.daily[2]).toEqual({ date: day(2), dayIndex: 2, minutes: 0, calories: 0, workouts: 0 });
    expect(r.everyDay).toMatchObject({ ready: true });
    expect(r.headline).toEqual({ ready: true, text: '3 workouts and 2 h 20 min of exercise in the last 30 days.', tone: 'neutral' });
  });

  it('gives no weekly average until the app has been in use for 7 days', () => {
    const twoSince = (firstDaysAgo: number) => {
      const recent = [
        { date: addDays(TODAY, -firstDaysAgo), activity: 'yoga' as const, minutes: 20, calories: 60 },
        { date: TODAY, activity: 'yoga' as const, minutes: 20, calories: 60 },
      ];
      return on(buildInsights(input({ exercises: recent, firstExerciseDate: addDays(TODAY, -firstDaysAgo) })).exercise);
    };
    // Three days in, "2 workouts a week" would be three days stretched into a week.
    expect(twoSince(2)).toMatchObject({ workouts: 2, minutes: 40, perWeek: null });
    // First workout 5 days ago: 6 days in use, today included. Still not a week.
    expect(twoSince(5).perWeek).toBeNull();
    // First workout 6 days ago: 7 days in use, which is one week exactly.
    expect(twoSince(6).perWeek).toEqual({ workouts: 2, minutes: 40 });
    // A day one workout says so too, in the 7-day view as well.
    const first = [{ date: TODAY, activity: 'walk' as const, minutes: 30, calories: 100 }];
    expect(on(buildInsights(input({ days: 7, exercises: first, firstExerciseDate: TODAY })).exercise).perWeek).toBeNull();
    // Use that began before the period counts as the whole period: 7 days is one week.
    expect(on(buildInsights(input({ days: 7, exercises: first, firstExerciseDate: addDays(TODAY, -40) })).exercise).perWeek).toEqual({
      workouts: 1,
      minutes: 30,
    });
  });

  it('averages over the days the app has been in use', () => {
    const twoWeeks = [
      { date: addDays(TODAY, -13), activity: 'cycle' as const, minutes: 60, calories: 400 },
      { date: TODAY, activity: 'cycle' as const, minutes: 60, calories: 400 },
    ];
    const r = buildInsights(input({ exercises: twoWeeks, firstExerciseDate: addDays(TODAY, -13) }));
    if (!r.exercise.ready) throw new Error('not ready');
    expect(r.exercise.perWeek).toEqual({ workouts: 1, minutes: 60 });
  });

  it('keeps only the top three activities', () => {
    const many = (['walk', 'run', 'cycle', 'yoga'] as const).map((activity, i) => ({ date: day(i), activity, minutes: 10 * (i + 1), calories: 50 }));
    const r = buildInsights(input({ exercises: many }));
    if (!r.exercise.ready) throw new Error('not ready');
    expect(r.exercise.top.map((t) => t.activity)).toEqual(['yoga', 'cycle', 'run']);
  });

  it('asks for a workout when there is none in the period, leading with the invitation', () => {
    const r = buildInsights(input({ days: 7, exercises: workouts }));
    expect(r.exercise).toEqual({ ready: false, reason: 'Log a workout to see your minutes, calories burned and top activities.', action: 'log-exercise' });
  });
});

describe('consistency', () => {
  it('marks every day of the period and leaves out the days before the first log', () => {
    const totals = [food(day(10), 1900), food(day(11), 2300), food(day(13), 400)];
    const r = buildInsights(input({ dayTotals: totals, loggedDates: totals.map((d) => d.date) }));
    expect(r.consistency.ready).toBe(true);
    if (!r.consistency.ready) throw new Error('not ready');
    const status = r.consistency.calendar.map((c) => c.status);
    expect(status).toHaveLength(30);
    expect(status.slice(0, 10).every((s) => s === 'before')).toBe(true);
    expect(status.slice(10, 14)).toEqual(['within', 'over', 'none', 'within']);
    expect(status.slice(14).every((s) => s === 'none')).toBe(true);
    expect(r.consistency.calendar[13].complete).toBe(false);
    // From 11 November to 29 November is 19 days; today is empty and not counted.
    // 1,900 is a full day within budget, 2,300 is over, and 400 kcal is not a day kept within budget.
    expect(r.consistency).toMatchObject({ loggedDays: 3, countedDays: 19, withinDays: 1, overDays: 1, partialDays: 1, todayOpen: false });
    expect(r.consistency.text).toBe('Logged 3 of 19 days: 1 full day within budget, 1 over, 1 with too little logged.');
    // Sunday 1 November sits in the seventh column of a Monday-first grid.
    expect(r.consistency.leadingBlanks).toBe(6);
    expect(r.consistency.streak).toEqual({ current: 0, best: 2, loggedToday: false });
    expect(r.period.firstLoggedDate).toBe(day(10));
  });

  it('carries a streak in from before the period', () => {
    const dates = Array.from({ length: 40 }, (_, i) => addDays(TODAY, -i));
    const totals = dates.filter((d) => d >= addDays(TODAY, -6)).map((d) => food(d, 1900));
    const r = buildInsights(input({ days: 7, dayTotals: totals, loggedDates: dates }));
    if (!r.consistency.ready) throw new Error('not ready');
    expect(r.consistency.streak).toEqual({ current: 40, best: 40, loggedToday: true });
    expect(r.consistency).toMatchObject({ loggedDays: 7, countedDays: 7 });
    expect(r.consistency.calendar.every((c) => c.status === 'within')).toBe(true);
  });

  it('shows the calendar even when the period itself is empty', () => {
    const r = buildInsights(input({ days: 7, loggedDates: [addDays(TODAY, -30), addDays(TODAY, -29)] }));
    expect(r.consistency).toMatchObject({ ready: true, loggedDays: 0, countedDays: 6, withinDays: 0, overDays: 0, partialDays: 0, todayOpen: false });
    expect(on(r.consistency).streak).toEqual({ current: 0, best: 2, loggedToday: false });
  });
});

describe('patterns', () => {
  // Monday 2 November to Sunday 29 November: 20 weekdays at 2,000, Saturdays at 2,600, Sundays at 2,500.
  const fourWeeks = Array.from({ length: 28 }, (_, i) => {
    const weekday = i % 7; // 0 is Monday
    return food(day(1 + i), weekday === 5 ? 2600 : weekday === 6 ? 2500 : 2000);
  });
  const meals = fourWeeks.flatMap((d) => [
    { date: d.date, meal: 'breakfast' as const, calories: 500 },
    { date: d.date, meal: 'lunch' as const, calories: 700 },
    { date: d.date, meal: 'dinner' as const, calories: 600 },
    { date: d.date, meal: 'snack' as const, calories: 200 },
  ]);
  /** The same four weeks with each day's calories from its place: `kcal(weekday, week)`, Monday and the first week being 0. */
  const fourWeeksOf = (kcal: (weekday: number, week: number) => number) =>
    Array.from({ length: 28 }, (_, i) => food(day(1 + i), kcal(i % 7, Math.floor(i / 7))));
  const patternsOf = (totals: DayFoodTotal[], over: Partial<InsightsInput> = {}) =>
    on(buildInsights(input({ dayTotals: totals, loggedDates: totals.map((d) => d.date), ...over })).patterns);

  it('compares weekdays with weekends', () => {
    const r = buildInsights(input({ dayTotals: fourWeeks, loggedDates: fourWeeks.map((d) => d.date), mealCalories: meals }));
    expect(r.patterns.ready).toBe(true);
    if (!r.patterns.ready) throw new Error('not ready');
    expect(r.patterns.days).toBe(28);
    // The 28 days average 60,400 / 28 = 2,157.1. Squared distances from that: 20 x 157.1^2 +
    // 4 x 442.9^2 + 4 x 342.9^2 = 1,748,571, over 27 is 64,762: a standard deviation of 254.5.
    // Twice the standard error of the difference is 2 x 254.5 x sqrt(1/20 + 1/8) = 212.9, and 550 is well over it.
    expect(r.patterns.weekSplit).toEqual({
      ready: true,
      weekday: { average: 2000, days: 20 },
      weekend: { average: 2550, days: 8 },
      difference: 550,
      clear: true,
      text: 'Weekends average 2,550 kcal a day, 550 more than weekdays.',
    });
  });

  it('states a weekend difference only when it is at least twice its standard error', () => {
    // Weekdays alternate 1,800 and 2,200 (average 2,000); Saturdays are 200 under the weekend
    // average and Sundays 200 over it. With the weekend average D above the weekdays', the 28 days
    // average 2,000 + 2D/7, and their squared distances from that add up to
    // 28 x 200^2 + 20 x (2D/7)^2 + 8 x (5D/7)^2 = 1,120,000 + (40/7) D^2.
    // Twice the standard error of the difference is 2 x sd x sqrt(1/20 + 1/8), whose square is
    // 0.7 x (1,120,000 + (40/7) D^2) / 27.
    const noisy = (d: number) =>
      patternsOf(fourWeeksOf((weekday, week) => (weekday < 5 ? ((week * 5 + weekday) % 2 === 0 ? 1800 : 2200) : 2000 + d + (weekday === 5 ? -200 : 200)))).weekSplit;
    // D = 190: 0.7 x (1,120,000 + 206,286) / 27 = 34,385, a threshold of 185.4. 190 is over it.
    expect(noisy(190)).toEqual({
      ready: true,
      weekday: { average: 2000, days: 20 },
      weekend: { average: 2190, days: 8 },
      difference: 190,
      clear: true,
      text: 'Weekends average 2,190 kcal a day, 190 more than weekdays.',
    });
    // D = 180: 0.7 x (1,120,000 + 185,143) / 27 = 33,837, a threshold of 183.9. 180 is under it,
    // and it is too big a gap to call "about the same".
    expect(noisy(180)).toEqual({
      ready: true,
      weekday: { average: 2000, days: 20 },
      weekend: { average: 2180, days: 8 },
      difference: 180,
      clear: false,
      text: 'Too few days to tell weekdays and weekends apart yet.',
    });
    // The other way round reads "less".
    expect(noisy(-190)).toMatchObject({ difference: -190, clear: true, text: 'Weekends average 1,810 kcal a day, 190 less than weekdays.' });
    expect(noisy(-180)).toMatchObject({ difference: -180, clear: false });
  });

  it('never states a weekend difference under 100 kcal, however steady the days are', () => {
    // The same days swinging by 100 instead of 200: at D = 100 the squared distances add up to
    // 280,000 + (40/7) x 10,000 = 337,143, and the threshold is sqrt(0.7 x 337,143 / 27) = 93.5.
    // That is under the 100 kcal floor, so the floor decides.
    const calm = (d: number) =>
      patternsOf(fourWeeksOf((weekday, week) => (weekday < 5 ? ((week * 5 + weekday) % 2 === 0 ? 1900 : 2100) : 2000 + d + (weekday === 5 ? -100 : 100)))).weekSplit;
    expect(calm(100)).toMatchObject({ difference: 100, clear: true, text: 'Weekends average 2,100 kcal a day, 100 more than weekdays.' });
    // 99 apart: the 28 days average 2,000 + 2 x 99 / 7 = 2,028.3.
    expect(calm(99)).toMatchObject({ difference: 99, clear: false, text: 'Weekdays and weekends look about the same so far, around 2,028 kcal a day.' });
  });

  it('needs three full days of each before comparing weekdays with weekends', () => {
    // Monday 2 to Friday 13 November: ten weekdays, and Saturday 7 and Sunday 8.
    const twoWeekendDays = fourWeeks.slice(0, 12);
    expect(patternsOf(twoWeekendDays).weekSplit).toEqual({
      ready: false,
      reason: 'Comparing weekdays with weekends needs 3 full days of each. So far you have 10 weekdays and 2 weekend days.',
      action: 'log-food',
    });
    // Saturday 14 November is the third weekend day.
    expect(patternsOf(fourWeeks.slice(0, 13)).weekSplit).toMatchObject({ ready: true, weekday: { days: 10 }, weekend: { days: 3 } });
    // Three weekend days and two weekdays is not enough either: Friday 6 to Monday 9, and Saturday 14.
    const twoWeekdays = [fourWeeks[4], fourWeeks[5], fourWeeks[6], fourWeeks[7], fourWeeks[12]];
    expect(off(patternsOf(twoWeekdays).weekSplit).reason).toBe(
      'Comparing weekdays with weekends needs 3 full days of each. So far you have 2 weekdays and 3 weekend days.',
    );
  });

  it('splits calories by meal', () => {
    const extra = [...meals, { date: TODAY, meal: 'breakfast' as const, calories: 300 }]; // today is not complete, so ignored
    const r = buildInsights(
      input({ dayTotals: [...fourWeeks, food(TODAY, 300)], loggedDates: [...fourWeeks.map((d) => d.date), TODAY], mealCalories: extra }),
    );
    if (!r.patterns.ready) throw new Error('not ready');
    expect(r.patterns.meals).toEqual([
      { meal: 'breakfast', label: 'Breakfast', average: 500, share: 0.25 },
      { meal: 'lunch', label: 'Lunch', average: 700, share: 0.35 },
      { meal: 'dinner', label: 'Dinner', average: 600, share: 0.3 },
      { meal: 'snack', label: 'Snacks', average: 200, share: 0.1 },
    ]);
  });

  it('leaves today out however much is logged on it', () => {
    // A Monday with 2,400 kcal on it already: still not one of the days the patterns are built on.
    const r = patternsOf([...fourWeeks, food(TODAY, 2400)], { mealCalories: [...meals, { date: TODAY, meal: 'dinner' as const, calories: 2400 }] });
    expect(r.days).toBe(28);
    expect(r.byWeekday[0]).toEqual({ weekday: 0, label: 'Monday', average: 2000, days: 4 });
    expect(r.meals[2]).toEqual({ meal: 'dinner', label: 'Dinner', average: 600, share: 0.3 });
  });

  it('finds the highest day of the week', () => {
    const r = buildInsights(input({ dayTotals: fourWeeks, loggedDates: fourWeeks.map((d) => d.date), mealCalories: meals }));
    if (!r.patterns.ready) throw new Error('not ready');
    expect(r.patterns.byWeekday.map((w) => [w.label, w.average, w.days])).toEqual([
      ['Monday', 2000, 4],
      ['Tuesday', 2000, 4],
      ['Wednesday', 2000, 4],
      ['Thursday', 2000, 4],
      ['Friday', 2000, 4],
      ['Saturday', 2600, 4],
      ['Sunday', 2500, 4],
    ]);
    // The average of all 28 days is 60,400 / 28 = 2,157, and their standard deviation 254.5 (see
    // the weekend test). Four Saturdays put twice the standard error at 2 x 254.5 / sqrt(4) = 254.5,
    // and Saturday is 443 above the average.
    expect(r.patterns.highestDay).toEqual({
      ready: true,
      weekday: 5,
      label: 'Saturday',
      average: 2600,
      aboveAverage: 443,
      standsOut: true,
      text: 'Saturday is your highest day, 2,600 kcal on average.',
    });
  });

  it('names a highest day only when it is at least twice its standard error above the average', () => {
    // Saturdays are all 2,000 + S. Every other day is 300 under 2,000 in the first and third week
    // and 300 over in the second and fourth, so each of the other weekdays averages 2,000 exactly.
    // The 28 days average 2,000 + S/7, which puts Saturday 6S/7 above the average. The squared
    // distances add up to 24 x 300^2 + 24 x (S/7)^2 + 4 x (6S/7)^2 = 2,160,000 + (24/7) S^2, and
    // with four Saturdays twice the standard error is 2 x sd / sqrt(4) = sd.
    const saturdays = (s: number) => patternsOf(fourWeeksOf((weekday, week) => (weekday === 5 ? 2000 + s : week % 2 === 0 ? 1700 : 2300))).highestDay;
    // S = 371: Saturday is 318 above. sd^2 = (2,160,000 + 471,912) / 27 = 97,478, sd = 312.2. Over it.
    expect(saturdays(371)).toEqual({
      ready: true,
      weekday: 5,
      label: 'Saturday',
      average: 2371,
      aboveAverage: 318,
      standsOut: true,
      text: 'Saturday is your highest day, 2,371 kcal on average.',
    });
    // S = 357: Saturday is 306 above. sd^2 = (2,160,000 + 436,968) / 27 = 96,184, sd = 310.1. Under it.
    expect(saturdays(357)).toEqual({
      ready: true,
      weekday: 5,
      label: 'Saturday',
      average: 2357,
      aboveAverage: 306,
      standsOut: false,
      text: 'No day of the week stands out yet.',
    });
  });

  it('never names a highest day under 150 kcal above the average, however steady the days are', () => {
    // The same weeks swinging by 50 instead of 300. At S = 175 Saturday is exactly 150 above, and
    // sd^2 = (24 x 2,500 + (24/7) x 30,625) / 27 = 6,111, sd = 78.2: the 150 kcal floor decides.
    const saturdays = (s: number) => patternsOf(fourWeeksOf((weekday, week) => (weekday === 5 ? 2000 + s : week % 2 === 0 ? 1950 : 2050))).highestDay;
    expect(saturdays(175)).toMatchObject({ label: 'Saturday', aboveAverage: 150, standsOut: true });
    // S = 174: the average is 2,000 + 174 / 7 = 2,024.9, and Saturday's 2,174 is 149 above it.
    expect(saturdays(174)).toMatchObject({ label: 'Saturday', aboveAverage: 149, standsOut: false, text: 'No day of the week stands out yet.' });
  });

  it('says when no day stands out', () => {
    const even = fourWeeks.map((d) => ({ ...d, calories: 2000 }));
    const r = buildInsights(input({ dayTotals: even, loggedDates: even.map((d) => d.date) }));
    if (!r.patterns.ready || !r.patterns.highestDay.ready) throw new Error('not ready');
    expect(r.patterns.highestDay).toMatchObject({ standsOut: false, aboveAverage: 0, text: 'No day of the week stands out yet.' });
    expect(r.patterns.weekSplit).toMatchObject({
      ready: true,
      difference: 0,
      clear: false,
      text: 'Weekdays and weekends look about the same so far, around 2,000 kcal a day.',
    });
    expect(r.patterns.meals.every((m) => m.share === 0 && m.average === 0)).toBe(true);
  });

  it('does not let a weekday with fewer than three full days be the highest, and carries its count for the chart', () => {
    // Monday 2 to Saturday 21 November: three of every weekday at 2,000, and two Sundays at 3,500.
    const totals = fourWeeks.slice(0, 20).map((d, i) => ({ ...d, calories: i % 7 === 6 ? 3500 : 2000 }));
    const r = patternsOf(totals);
    expect(r.days).toBe(20);
    // The chart gets the count, so it can draw Sunday as a stub.
    expect(r.byWeekday[6]).toEqual({ weekday: 6, label: 'Sunday', average: 3500, days: 2 });
    expect(r.byWeekday[5]).toEqual({ weekday: 5, label: 'Saturday', average: 2000, days: 3 });
    // The 20 days average (18 x 2,000 + 2 x 3,500) / 20 = 2,150, so the best of the others is 150 under.
    expect(r.highestDay).toMatchObject({ ready: true, label: 'Monday', average: 2000, aboveAverage: -150, standsOut: false });
    expect(on(r.highestDay).text).toBe('No day of the week stands out yet.');
  });

  it('needs five complete days', () => {
    const four = fourWeeks.slice(0, 4);
    const r = buildInsights(input({ dayTotals: four, loggedDates: four.map((d) => d.date) }));
    expect(r.patterns).toEqual({
      ready: false,
      reason: 'Log 1 more full day of meals to see your patterns. You have 4 so far.',
      action: 'log-food',
    });
    expect(patternsOf(fourWeeks.slice(0, 5)).days).toBe(5);
  });

  it('needs two weeks of full days, and three of two weekdays, before naming a highest day', () => {
    expect(patternsOf(fourWeeks.slice(0, 10)).highestDay).toEqual({
      ready: false,
      reason: 'Your highest day of the week shows after 14 full days. You have 10 so far.',
      action: 'log-food',
    });
    // Two whole weeks: 14 full days, but only two of each weekday.
    expect(patternsOf(fourWeeks.slice(0, 14)).highestDay).toEqual({
      ready: false,
      reason: 'Your highest day of the week shows once two weekdays have 3 full days each.',
      action: 'log-food',
    });
    // Monday 16 November is the third Monday: one weekday is not enough to compare.
    expect(patternsOf(fourWeeks.slice(0, 15)).highestDay.ready).toBe(false);
    // Tuesday 17 November is the third Tuesday.
    expect(patternsOf(fourWeeks.slice(0, 16)).highestDay).toMatchObject({ ready: true, label: 'Monday', standsOut: false });
  });

  it('offers 30 days in the 7-day view, where a week can never be enough', () => {
    // Tuesday 24 to Sunday 29 November: six full days.
    const lastWeek = fourWeeks.filter((d) => d.date >= addDays(TODAY, -6));
    const week = patternsOf(lastWeek, { days: 7 });
    expect(week.days).toBe(6);
    expect(week.highestDay).toEqual({ ready: false, reason: 'One week is too short to pick out a day of the week.', action: 'longer-period' });
    expect(week.weekSplit).toEqual({
      ready: false,
      reason: 'A week is too short to compare weekdays with weekends. That takes 3 full days of each.',
      action: 'longer-period',
    });
  });
});

describe('top foods', () => {
  it('lists the five that added the most, merging spellings of the same name', () => {
    const totals = [food(day(5), 5000), food(day(6), 5000)];
    const r = buildInsights(
      input({
        dayTotals: totals,
        loggedDates: totals.map((d) => d.date),
        topFoods: [
          { name: 'Rice', calories: 3000, count: 10 },
          { name: ' rice ', calories: 500, count: 2 },
          { name: 'Dal', calories: 2000, count: 8 },
          { name: 'Egg', calories: 900, count: 6 },
          { name: 'Milk', calories: 800, count: 5 },
          { name: 'Bread', calories: 700, count: 4 },
          { name: 'Banana', calories: 600, count: 6 },
          { name: '', calories: 9999, count: 1 },
          { name: 'Water', calories: 0, count: 30 },
        ],
      }),
    );
    expect(r.topFoods).toEqual({
      ready: true,
      totalCalories: 10000,
      foods: [
        { name: 'Rice', calories: 3500, count: 12, share: 0.35 },
        { name: 'Dal', calories: 2000, count: 8, share: 0.2 },
        { name: 'Egg', calories: 900, count: 6, share: 0.09 },
        { name: 'Milk', calories: 800, count: 5, share: 0.08 },
        { name: 'Bread', calories: 700, count: 4, share: 0.07 },
      ],
    });
  });

  it('never shows a share above the whole', () => {
    const r = buildInsights(input({ dayTotals: [food(day(5), 100)], loggedDates: [day(5)], topFoods: [{ name: 'Rice', calories: 300, count: 1 }] }));
    if (!r.topFoods.ready) throw new Error('not ready');
    expect(r.topFoods.foods[0].share).toBe(1);
  });
});

describe('every day', () => {
  it('lists days with food, a workout or a weigh-in, newest first', () => {
    const r = buildInsights(
      input({
        days: 7,
        dayTotals: [food(addDays(TODAY, -3), 2100.4, { protein: 99.6, count: 4 })],
        loggedDates: [addDays(TODAY, -3)],
        exercises: [{ date: addDays(TODAY, -1), activity: 'walk', minutes: 30, calories: 120 }],
        weights: [{ date: TODAY, kg: 79.4 }, { date: addDays(TODAY, -3), kg: 79.9 }],
      }),
    );
    expect(r.everyDay.ready).toBe(true);
    if (!r.everyDay.ready) throw new Error('not ready');
    expect(r.everyDay.days.map((d) => d.date)).toEqual([TODAY, addDays(TODAY, -1), addDays(TODAY, -3)]);
    expect(r.everyDay.days[0]).toMatchObject({ logged: false, calories: 0, weightKg: 79.4, workouts: 0 });
    expect(r.everyDay.days[1]).toMatchObject({ logged: false, burned: 120, budget: 2120, workouts: 1, exerciseMinutes: 30, weightKg: null });
    expect(r.everyDay.days[2]).toEqual({
      date: addDays(TODAY, -3),
      logged: true,
      count: 4,
      complete: true,
      calories: 2100,
      protein: 100,
      carbs: 250,
      fat: 60,
      burned: 0,
      budget: 2000,
      over: true,
      workouts: 0,
      exerciseMinutes: 0,
      weightKg: 79.9,
    });
    expect(r.empty).toBe(false);
  });
});

describe('full days and averages', () => {
  /** Days ending yesterday, oldest first, one for each figure given. */
  const before = (...kcals: number[]) => kcals.map((kcal, i) => food(addDays(TODAY, i - kcals.length), kcal));
  const insightsOf = (totals: DayFoodTotal[], over: Partial<InsightsInput> = {}) =>
    buildInsights(input({ dayTotals: totals, loggedDates: totals.map((d) => d.date), ...over }));

  it('does not call a first afternoon an average', () => {
    // Day one, 2 pm: breakfast and lunch are 1,070 kcal, over the 800 a full day needs, and one walk.
    const r = insightsOf([food(TODAY, 1070, { protein: 60 })], {
      exercises: [{ date: TODAY, activity: 'walk', minutes: 30, calories: 110 }],
      firstExerciseDate: TODAY,
    });
    expect(r.calories).toMatchObject({ ready: true, loggedDays: 1, countedDays: 1, completeDays: 0, withinBudgetDays: 0, todayPending: true });
    // Nothing is missing, the day is just not over: no step is offered.
    expect(on(r.calories).average).toEqual({ ready: false, reason: 'Today counts once the day is over. An average shows after 3 full days.' });
    expect(r.macros).toEqual({
      ready: false,
      reason: 'Today counts once the day is over. Your protein, carbs and fat averages show after 3 full days.',
    });
    expect(r.headline).toEqual({ ready: true, text: 'Your first day is logged. An average shows after 3 full days.', tone: 'neutral' });
    expect(on(r.exercise)).toMatchObject({ workouts: 1, minutes: 30, perWeek: null });
    expectPlainCopy(r);
  });

  it('says what a full day is on a first morning, without calling it short', () => {
    const r = insightsOf([food(TODAY, 380)]);
    expect(on(r.calories).average).toEqual({
      ready: false,
      reason: 'An average shows after 3 full days. A full day has at least 800 kcal logged, and today counts once it is over.',
      action: 'log-food',
    });
    expect(r.macros).toEqual({
      ready: false,
      reason: 'Your protein, carbs and fat averages show after 3 full days. A full day has at least 800 kcal logged, and today counts once it is over.',
      action: 'log-food',
    });
    expect(on(r.headline).text).toBe('Your first day is logged. An average shows after 3 full days.');
  });

  it('shows no average from one full day', () => {
    // Day two, before breakfast: yesterday's 1,950 is one day, not an average.
    const morning = insightsOf(before(1950));
    expect(morning.calories).toMatchObject({ ready: true, completeDays: 1, countedDays: 1, averageBudget: null, budgetText: null });
    expect(on(morning.calories).average).toEqual({ ready: false, reason: '1 full day logged so far. An average shows after 3.', action: 'log-food' });
    expect(morning.macros).toEqual({
      ready: false,
      reason: '1 full day logged so far. Your protein, carbs and fat averages show after 3.',
      action: 'log-food',
    });
    expect(on(morning.headline).text).toBe('Your first day is logged. An average shows after 3 full days.');

    // The same day after lunch.
    const afternoon = insightsOf([...before(1950), food(TODAY, 900)]);
    expect(afternoon.calories).toMatchObject({ completeDays: 1, countedDays: 2 });
    expect(off(on(afternoon.calories).average).reason).toBe('1 full day logged so far, not counting today. An average shows after 3.');
    expect(off(afternoon.macros).reason).toBe('1 full day logged so far, not counting today. Your protein, carbs and fat averages show after 3.');
    expect(on(afternoon.headline).text).toBe('1 full day of meals logged so far. An average shows after 3.');
  });

  it('shows no average from two full days', () => {
    const r = insightsOf(before(1900, 2100));
    expect(r.calories).toMatchObject({ ready: true, completeDays: 2, averageBudget: null, lowCoverage: false });
    expect(on(r.calories).average).toEqual({ ready: false, reason: '2 full days logged so far. An average shows after 3.', action: 'log-food' });
    expect(r.macros).toMatchObject({ ready: false, action: 'log-food' });
    expect(r.headline).toEqual({ ready: true, text: '2 full days of meals logged so far. An average shows after 3.', tone: 'neutral' });
  });

  it('shows the average from three full days', () => {
    // (1,800 + 2,000 + 2,200) / 3 = 2,000.
    const r = insightsOf(before(1800, 2000, 2200));
    expect(on(r.calories).average).toEqual({ ready: true, kcal: 2000, vsGoal: 0, days: 3 });
    expect(r.calories).toMatchObject({ completeDays: 3, averageBudget: 2000, budgetText: null, note: null });
    expect(r.macros).toMatchObject({ ready: true, days: 3, protein: { average: 100, goal: 100, ratio: 1 }, proteinDays: 3 });
    expect(r.headline).toEqual({ ready: true, text: 'Eating 2,000 kcal a day on average, right on your goal.', tone: 'neutral' });
  });

  it('never counts today as a full day, whatever is logged on it', () => {
    // Five finished days: 2,000 + 2,100 + 2,150 + 2,105 + 2,100 = 10,455, an average of 2,091.
    const finished = before(2000, 2100, 2150, 2105, 2100);
    const goals = { calories: 1900, protein: 100, carbs: 250, fat: 60 };
    // With today counted from 800 kcal, 1,000 at 2 pm made it 11,455 / 6 = 1,909, "right on your goal".
    for (const today of [null, 1000, 1900, 3000]) {
      const totals = today === null ? finished : [...finished, food(TODAY, today, { protein: 300 })];
      const r = insightsOf(totals, { goals });
      expect(on(r.calories).average).toEqual({ ready: true, kcal: 2091, vsGoal: 191, days: 5 });
      expect(r.headline).toEqual({ ready: true, text: 'Eating 2,091 kcal a day on average, 191 over your goal.', tone: 'neutral' });
      // Today's 300 g of protein is in no average and no count either.
      expect(r.macros).toMatchObject({ ready: true, days: 5, protein: { average: 100 }, proteinDays: 5 });
      expect(r.calories).toMatchObject({
        completeDays: 5,
        loggedDays: today === null ? 5 : 6,
        countedDays: today === null ? 5 : 6,
        withinBudgetDays: 0,
        // A day that is already over its budget is over, today included.
        overBudgetDays: today === 3000 ? 6 : 5,
        todayPending: today !== null,
        note: today === null ? null : 'Today is not counted in the averages yet.',
      });
      const bar = on(r.calories).bars[29];
      expect(bar).toMatchObject({ date: TODAY, isToday: true, complete: false, calories: today, status: today === null ? 'none' : today === 3000 ? 'over' : 'within' });
      expect(r.macros).toMatchObject({ note: today === null ? null : 'Today is not counted in the averages yet.' });
    }
  });

  it('does not blame the owner while today is the only day with enough on it', () => {
    // Yesterday was a coffee; today has 1,200 kcal so far.
    const r = insightsOf([...before(300), food(TODAY, 1200)]);
    expect(on(r.calories).average).toEqual({ ready: false, reason: 'Today counts once the day is over. An average shows after 3 full days.' });
    expect(r.calories).toMatchObject({ completeDays: 0, leftOutDays: 1 });
    expect(on(r.headline).text).toBe('Meals logged on 2 days. An average shows after 3 full days.');
    // Neither day has enough: then it says what a full day is.
    const thin = insightsOf([...before(300), food(TODAY, 400)]);
    expect(on(thin.calories).average).toEqual({
      ready: false,
      reason: 'No day has enough logged yet. A full day has at least 800 kcal logged. An average shows after 3 full days.',
      action: 'log-food',
    });
  });

  it('leaves today out of the days between the weigh-ins when the last weigh-in is this morning', () => {
    // Four weekly weigh-ins from 9 November to today, and meals on the first 13 of those days.
    const weights = [8, 15, 22, 29].map((d) => ({ date: day(d), kg: 80 - (0.5 / 7) * (d - 8) }));
    const meals = (count: number) => [...Array.from({ length: count }, (_, i) => food(day(8 + i), 1900)), food(TODAY, 1900)];
    // 9 to 29 November is 21 days that could have been full, and 60% of 21 is 12.6: 13 are needed.
    // Counting today, which cannot be full yet, it would be 60% of 22 = 13.2, so 14.
    const enough = insightsOf(meals(13), { weights });
    expect(enough.weighedToday).toBe(true);
    // 1,900 + 550 = 2,450, and four weekly weigh-ins leave it 295 either way (see what you actually burn).
    expect(enough.maintenance).toMatchObject({
      ready: true,
      kcal: 2450,
      low: 2150,
      high: 2750,
      averageIntake: 1900,
      basis: { weighIns: 4, completeDays: 13, windowDays: 21, fromDate: day(8), toDate: TODAY },
    });
    expect(insightsOf(meals(12), { weights }).maintenance).toEqual({
      ready: false,
      reason: 'Meals were fully logged on 12 of the 21 days between your weigh-ins. This needs at least 13.',
      action: 'log-food',
    });
  });
});

describe('the headline on a patchy period', () => {
  /** `count` full days from 1 November, so every day of the period counts once today has an entry. */
  const fullDays = (count: number, kcal = 1900) => Array.from({ length: count }, (_, i) => food(day(i), kcal));
  const insightsOf = (totals: DayFoodTotal[], over: Partial<InsightsInput> = {}) =>
    buildInsights(input({ dayTotals: totals, loggedDates: totals.map((d) => d.date), ...over }));

  it('leads with the day count when full days are under 60% of the days', () => {
    // 18 of 30 is 60% exactly: the average stands.
    const normal = insightsOf([...fullDays(18), food(TODAY, 300)]);
    expect(normal.calories).toMatchObject({ completeDays: 18, countedDays: 30, lowCoverage: false });
    expect(normal.headline).toEqual({ ready: true, text: 'Eating 1,900 kcal a day on average, 100 under your goal.', tone: 'neutral' });
    // 17 of 30 is under it.
    const low = insightsOf([...fullDays(17), food(TODAY, 300)]);
    expect(low.calories).toMatchObject({ completeDays: 17, countedDays: 30, lowCoverage: true });
    expect(low.headline).toEqual({
      ready: true,
      text: 'Meals fully logged on 17 of 30 days. On those days you ate 1,900 kcal on average.',
      tone: 'neutral',
    });
  });

  // Food on 14 of 30 days: 9 full days, 4 with very little, and today's breakfast.
  // The full days: 4 x 1,800 + 5 x 1,900 = 16,700, an average of 1,855.6.
  const patchy = [
    ...[0, 2, 4, 6].map((d) => food(day(d), 1800)),
    ...[8, 10, 12, 14, 16].map((d) => food(day(d), 1900)),
    ...[18, 20, 22, 24].map((d) => food(day(d), 500)),
    food(TODAY, 380),
  ];

  it('does not pass 9 days off as the month', () => {
    const r = insightsOf(patchy);
    expect(r.calories).toMatchObject({ loggedDays: 14, countedDays: 30, completeDays: 9, leftOutDays: 4, lowCoverage: true });
    expect(on(r.calories).average).toEqual({ ready: true, kcal: 1856, vsGoal: -144, days: 9 });
    expect(on(r.calories).note).toBe('4 days with very little logged were left out of the averages, and today is not counted yet.');
    expect(r.headline).toEqual({
      ready: true,
      text: 'Meals fully logged on 9 of 30 days. On those days you ate 1,856 kcal on average.',
      tone: 'neutral',
    });
  });

  it('names the days in the weight sentence too, and only on a patchy period', () => {
    const withWeight = insightsOf(patchy, { weights: steadyLoss });
    expect(withWeight.headline).toEqual({
      ready: true,
      text: 'Down 2.0 kg in 29 days, eating 1,856 kcal a day on the 9 days you logged in full.',
      tone: 'down',
    });
    const wellKept = insightsOf(fullDays(29), { weights: steadyLoss });
    expect(wellKept.headline).toEqual({ ready: true, text: 'Down 2.0 kg in 29 days, eating 1,900 kcal a day on average.', tone: 'down' });
  });

  it('says nothing about coverage while there is no average to qualify', () => {
    // 2 full days of 10.
    const r = insightsOf([food(day(20), 1900), food(day(21), 1900), food(TODAY, 300)]);
    expect(r.calories).toMatchObject({ completeDays: 2, countedDays: 10, lowCoverage: false });
    expect(on(r.headline).text).toBe('2 full days of meals logged so far. An average shows after 3.');
  });
});

describe('the invitations on an empty period', () => {
  it('leads with what to log, and does not tell a new install it missed a month', () => {
    const fresh = buildInsights(input());
    expect(fresh.headline).toEqual({ ready: false, reason: 'Log a meal, a workout or your weight to see how you are doing.', action: 'log-food' });
    expect(fresh.calories).toEqual({ ready: false, reason: 'Log your meals to see your average against your goal.', action: 'log-food' });
    expect(fresh.exercise).toEqual({ ready: false, reason: 'Log a workout to see your minutes, calories burned and top activities.', action: 'log-exercise' });
    expect(fresh.macros).toEqual({ ready: false, reason: 'Log your meals to see your protein, carbs and fat against your goals.', action: 'log-food' });
  });

  it('says how long ago the last meal was when the period itself is empty', () => {
    // Meals 30 and 29 days ago, nothing in the last 7.
    const back = buildInsights(input({ days: 7, loggedDates: [addDays(TODAY, -30), addDays(TODAY, -29)] }));
    expect(back.headline).toEqual({ ready: false, reason: 'Log a meal, a workout or your weight to see how the last 7 days went.', action: 'log-food' });
    expect(back.calories).toEqual({
      ready: false,
      reason: 'Log your meals to see your average against your goal. Your last logged meal was 29 days ago.',
      action: 'log-food',
    });
    // A weigh-in or a workout long ago counts as having used the app, too.
    const weighed = buildInsights(input({ days: 7, weights: [{ date: addDays(TODAY, -60), kg: 80 }] }));
    expect(off(weighed.headline).reason).toBe('Log a meal, a workout or your weight to see how the last 7 days went.');
    expect(off(weighed.calories).reason).toBe('Log your meals to see your average against your goal.');
    const trained = buildInsights(input({ days: 90, firstExerciseDate: addDays(TODAY, -200) }));
    expect(off(trained.headline).reason).toBe('Log a meal, a workout or your weight to see how the last 90 days went.');
  });

  it('lists what shows up, and what each takes, from the same constants the cards use', () => {
    expect(whatShowsUpHere()).toEqual([
      { card: 'weight', title: 'Where your weight is heading', needs: 'After 3 weigh-ins over at least a week' },
      { card: 'calories', title: 'Your average calories against your goal', needs: 'After 3 full days of meals' },
      { card: 'maintenance', title: 'What you actually burn', needs: 'After 4 or more weigh-ins over at least 2 weeks, with your meals logged in between' },
      { card: 'patterns', title: 'Patterns in your week', needs: 'After 5 full days of meals' },
    ]);
    expectPlainCopy(whatShowsUpHere());
  });
});

describe('the average against the budget', () => {
  const goals = { calories: 1900, protein: 100, carbs: 250, fat: 60 };
  // Four finished days at 2,011 kcal, against a goal of 1,900.
  const eaten = [-4, -3, -2, -1].map((n) => food(addDays(TODAY, n), 2011));
  const run = (daysAgo: number, calories: number): ExerciseLog => ({ date: addDays(TODAY, -daysAgo), activity: 'run', minutes: 30, calories });
  const caloriesOf = (exercises: ExerciseLog[], over: Partial<InsightsInput> = {}) =>
    on(buildInsights(input({ goals, dayTotals: eaten, loggedDates: eaten.map((d) => d.date), exercises, firstExerciseDate: exercises[0]?.date ?? null, ...over })).calories);

  it('gives the average budget over the same full days, and where the average sits against it', () => {
    // Two 308 kcal runs: budgets of 1,900, 1,900, 2,208 and 2,208 average 2,054. 2,011 is 43 under that.
    const c = caloriesOf([run(2, 308), run(1, 308)]);
    expect(c.average).toEqual({ ready: true, kcal: 2011, vsGoal: 111, days: 4 });
    expect(c).toMatchObject({ averageBudget: 2054, withinBudgetDays: 2, overBudgetDays: 2 });
    expect(c.budgetText).toBe('Your budget averaged 2,054 kcal with workouts, so you were 43 under it.');
  });

  it('mentions the budget only when workouts move it 25 kcal or more from the goal', () => {
    // One 100 kcal run over four days is 25 a day: 1,925, and 2,011 is 86 over it.
    const shown = caloriesOf([run(1, 100)]);
    expect(shown).toMatchObject({ averageBudget: 1925, budgetText: 'Your budget averaged 1,925 kcal with workouts, so you were 86 over it.' });
    // 96 kcal is 24 a day.
    expect(caloriesOf([run(1, 96)])).toMatchObject({ averageBudget: 1924, budgetText: null });
    expect(caloriesOf([])).toMatchObject({ averageBudget: 1900, budgetText: null });
  });

  it('builds it on full days only, and waits for the average', () => {
    // A long run today, and one on a day with only a coffee logged: neither day is in the average,
    // so neither budget is. Over all six logged days it would be (4 x 1,900 + 2,700 + 2,300) / 6 = 2,100.
    const others = [food(addDays(TODAY, -5), 300), ...eaten, food(TODAY, 500)];
    const c = caloriesOf([run(5, 400), run(0, 800)], { dayTotals: others, loggedDates: others.map((d) => d.date) });
    expect(c).toMatchObject({ loggedDays: 6, completeDays: 4, averageBudget: 1900, budgetText: null });
    expect(c.bars[24]).toMatchObject({ budget: 2300, complete: false });
    expect(c.bars[29]).toMatchObject({ budget: 2700, complete: false, isToday: true });
    // Two full days: no average, so no average budget.
    const two = eaten.slice(2);
    const r = buildInsights(input({ goals, dayTotals: two, loggedDates: two.map((d) => d.date), exercises: [run(1, 400)], firstExerciseDate: addDays(TODAY, -1) }));
    expect(r.calories).toMatchObject({ ready: true, averageBudget: null, budgetText: null });
  });

  it('says so when the average is right on the budget', () => {
    // A 111 kcal workout every day: a budget of 2,011 on each of the four days.
    const c = caloriesOf([run(4, 111), run(3, 111), run(2, 111), run(1, 111)]);
    expect(c).toMatchObject({ averageBudget: 2011, budgetText: 'Your budget averaged 2,011 kcal with workouts, so you were right on it.' });
  });

  const OTHER = 'Progress counts the workouts you logged, not activity from other apps, so a day can read differently here than on Today or its own page.';

  it('says what Progress cannot count when Today adds activity from other apps', () => {
    expect(caloriesOf([]).note).toBeNull();
    expect(caloriesOf([], { countsOtherActivity: false }).note).toBeNull();
    expect(caloriesOf([], { countsOtherActivity: true }).note).toBe(OTHER);
    // It follows what was left out.
    const withThin = [...eaten, food(addDays(TODAY, -5), 300), food(TODAY, 500)];
    const noted = on(
      buildInsights(input({ goals, dayTotals: withThin, loggedDates: withThin.map((d) => d.date), countsOtherActivity: true })).calories,
    );
    expect(noted.note).toBe(`1 day with very little logged was left out of the averages, and today is not counted yet. ${OTHER}`);
  });
});

describe('consistency counts', () => {
  // Food on 14 of the 30 days from 1 November: eight full days within budget, one over, four
  // with a few hundred kcal on them, and today's breakfast.
  const patchy = (today: number | null) => [
    ...Array.from({ length: 8 }, (_, i) => food(day(i), 1900)),
    food(day(8), 2400),
    ...[350, 500, 700, 600].map((kcal, i) => food(day(10 + 2 * i), kcal)),
    ...(today === null ? [] : [food(TODAY, today)]),
  ];
  const insightsOf = (totals: DayFoodTotal[], over: Partial<InsightsInput> = {}) =>
    buildInsights(input({ dayTotals: totals, loggedDates: totals.map((d) => d.date), ...over }));
  const adds = (c: { loggedDays: number; withinDays: number; overDays: number; partialDays: number; todayOpen: boolean }) =>
    c.withinDays + c.overDays + c.partialDays + (c.todayOpen ? 1 : 0) === c.loggedDays;

  it('counts a day within budget only when it is a full day, and adds up', () => {
    const r = insightsOf(patchy(380));
    const c = on(r.consistency);
    expect(c).toMatchObject({ loggedDays: 14, countedDays: 30, withinDays: 8, overDays: 1, partialDays: 4, todayOpen: true });
    expect(c.text).toBe('Logged 14 of 30 days: 8 full days within budget, 1 over, 4 with too little logged. Today is still open.');
    expect(adds(c)).toBe(true);
    // The Calories card says the same eight.
    expect(r.calories).toMatchObject({ withinBudgetDays: 8, completeDays: 9, overBudgetDays: 1 });
    // The calendar can tell the three apart: a full day, a day with too little, and today.
    expect(c.calendar[0]).toMatchObject({ status: 'within', complete: true, isToday: false });
    expect(c.calendar[10]).toMatchObject({ status: 'within', complete: false, isToday: false });
    expect(c.calendar[29]).toMatchObject({ status: 'within', complete: false, isToday: true });
    expect(c.calendar[8]).toMatchObject({ status: 'over', complete: true });
  });

  it('does not count today as too little logged, and counts it as over once it is', () => {
    const empty = on(insightsOf(patchy(null)).consistency);
    expect(empty).toMatchObject({ loggedDays: 13, countedDays: 29, withinDays: 8, overDays: 1, partialDays: 4, todayOpen: false });
    expect(empty.text).toBe('Logged 13 of 29 days: 8 full days within budget, 1 over, 4 with too little logged.');
    // 1,900 by the evening: still open, still not one of the days within budget.
    const evening = on(insightsOf(patchy(1900)).consistency);
    expect(evening).toMatchObject({ loggedDays: 14, withinDays: 8, partialDays: 4, todayOpen: true });
    const over = on(insightsOf(patchy(2500)).consistency);
    expect(over).toMatchObject({ loggedDays: 14, countedDays: 30, withinDays: 8, overDays: 2, partialDays: 4, todayOpen: false });
    expect(over.text).toBe('Logged 14 of 30 days: 8 full days within budget, 2 over, 4 with too little logged.');
    for (const c of [empty, evening, over]) expect(adds(c)).toBe(true);
  });

  it('adds up with a goal of 0, where a day with very little is over budget too', () => {
    const totals = [food(day(26), 300), food(day(27), 900), food(day(28), 1000)];
    const c = on(insightsOf(totals, { goals: { calories: 0, protein: 0, carbs: 0, fat: 0 } }).consistency);
    expect(c).toMatchObject({ loggedDays: 3, countedDays: 3, withinDays: 0, overDays: 3, partialDays: 0, todayOpen: false });
    expect(c.text).toBe('Logged 3 of 3 days: 0 full days within budget, 3 over.');
    expect(adds(c)).toBe(true);
  });

  it('keeps the sentence short when there is nothing to count yet', () => {
    const first = on(insightsOf([food(TODAY, 380)]).consistency);
    expect(first).toMatchObject({ loggedDays: 1, countedDays: 1, withinDays: 0, overDays: 0, partialDays: 0, todayOpen: true });
    expect(first.text).toBe('Logged 1 of 1 day. Today is still open.');
    const quiet = on(buildInsights(input({ days: 7, loggedDates: [addDays(TODAY, -30)] })).consistency);
    expect(quiet.text).toBe('Logged 0 of 6 days.');
    // Leaves out the third count when no day had too little.
    const tidy = on(insightsOf([food(day(27), 1900), food(day(28), 1900)]).consistency);
    expect(tidy.text).toBe('Logged 2 of 2 days: 2 full days within budget, 0 over.');
  });
});

describe('the weekday most often not logged in full', () => {
  // 1 November 2026 is a Sunday. Before today (Monday 30 November) the month has five Sundays and four of every other weekday.
  const month = Array.from({ length: 29 }, (_, i) => food(day(i), 1900));
  const SATURDAYS = [6, 13, 20, 27];
  const SUNDAYS = [0, 7, 14, 21, 28];
  const FRIDAYS = [5, 12, 19, 26];
  const without = (...offsets: number[]) => month.filter((_, i) => !offsets.includes(i));
  const skippedOf = (totals: DayFoodTotal[], over: Partial<InsightsInput> = {}) =>
    on(buildInsights(input({ dayTotals: totals, loggedDates: totals.map((d) => d.date), ...over })).consistency).skipped;

  it('names a weekday missed on at least half of three or more of them', () => {
    expect(skippedOf(without(13, 20, 27))).toEqual({
      weekdays: [{ weekday: 5, label: 'Saturday', missed: 3, of: 4 }],
      text: 'Saturdays are most often not logged in full (3 of 4), so your averages leave those days out.',
    });
    // Exactly half.
    expect(skippedOf(without(13, 20))?.text).toBe('Saturdays are most often not logged in full (2 of 4), so your averages leave those days out.');
    // One of four is not a habit.
    expect(skippedOf(without(13))).toBeNull();
    expect(skippedOf(month)).toBeNull();
  });

  it('counts a day with too little on it, because the averages leave that out as well', () => {
    const thin = month.map((d, i) => (i === 13 || i === 20 ? { ...d, calories: 300 } : d)).filter((_, i) => i !== 27);
    expect(skippedOf(thin)?.weekdays).toEqual([{ weekday: 5, label: 'Saturday', missed: 3, of: 4 }]);
  });

  it('does not count today, or the days before the first log', () => {
    // Mondays 2, 9 and 16 November missed. Today is a Monday too, and it is not over: 3 of 4, not of 5.
    expect(skippedOf(without(1, 8, 15))?.text).toBe('Mondays are most often not logged in full (3 of 4), so your averages leave those days out.');
    // First log on Tuesday 17 November: only two Saturdays since, both missed. Two is too few to call.
    const late = month.filter((_, i) => i >= 16 && i !== 20 && i !== 27);
    expect(skippedOf(late)).toBeNull();
  });

  it('names two weekdays level at the top, and none when it is three or more', () => {
    // A first log on Friday 30 October, then weekdays only.
    const earlier = { loggedDates: [addDays(FROM_30, -2), ...month.map((d) => d.date)] };
    expect(skippedOf(without(...SATURDAYS, ...SUNDAYS), earlier)).toEqual({
      weekdays: [
        { weekday: 5, label: 'Saturday', missed: 4, of: 4 },
        { weekday: 6, label: 'Sunday', missed: 5, of: 5 },
      ],
      text: 'Saturdays and Sundays are most often not logged in full (4 of 4 and 5 of 5), so your averages leave those days out.',
    });
    expect(skippedOf(without(...FRIDAYS, ...SATURDAYS, ...SUNDAYS), earlier)).toBeNull();
    // The larger share wins: every Sunday against three of four Saturdays.
    expect(skippedOf(without(13, 20, 27, ...SUNDAYS), earlier)?.weekdays).toEqual([{ weekday: 6, label: 'Sunday', missed: 5, of: 5 }]);
  });

  it('has nothing to say over 7 days', () => {
    expect(skippedOf(without(27, 28), { days: 7 })).toBeNull();
  });
});

describe('week by week', () => {
  const nov = (dayOfMonth: number) => day(dayOfMonth - 1);

  it('gives four 7-day blocks back from today over 30 days, newest first', () => {
    const totals = [
      // 1 and 2 November are in the period but in no block.
      food(nov(1), 2500),
      food(nov(2), 2500),
      // 3 to 9 November: exactly three full days, averaging (2,100 + 2,200 + 2,300) / 3 = 2,200.
      food(nov(3), 2100),
      food(nov(4), 2200),
      food(nov(5), 2300),
      // 10 to 16 November: two full days and one with very little.
      food(nov(10), 1900),
      food(nov(11), 2100),
      food(nov(12), 400),
      // 17 to 23 November: all seven.
      ...[17, 18, 19, 20, 21, 22, 23].map((d) => food(nov(d), 1800)),
      // 24 to 30 November: six finished days, and today.
      ...[24, 25, 26, 27, 28, 29].map((d) => food(nov(d), 2000)),
      food(TODAY, 900),
    ];
    const weights = [
      { date: nov(1), kg: 82 },
      { date: nov(3), kg: 81.2 },
      { date: nov(9), kg: 81 }, // 81.1 on average
      { date: nov(20), kg: 80.6 }, // one weigh-in: shown as that, not as an average
      { date: nov(25), kg: 80.4 },
      { date: nov(28), kg: 80 },
      { date: TODAY, kg: 79.9 }, // 240.3 / 3 = 80.1
    ];
    const exercises: ExerciseLog[] = [
      { date: nov(2), activity: 'swim', minutes: 90, calories: 600 },
      { date: nov(4), activity: 'yoga', minutes: 20, calories: 60 },
      { date: nov(4), activity: 'yoga', minutes: 20, calories: 60 },
      { date: nov(8), activity: 'yoga', minutes: 20, calories: 60 },
      { date: nov(12), activity: 'cycle', minutes: 60, calories: 400 },
      { date: nov(26), activity: 'run', minutes: 30, calories: 300 },
      { date: TODAY, activity: 'walk', minutes: 45, calories: 150 },
    ];
    const r = buildInsights(input({ dayTotals: totals, loggedDates: totals.map((d) => d.date), weights, exercises, firstExerciseDate: nov(2) }));
    expect(r.weeks).toEqual([
      { from: nov(24), to: TODAY, daysInUse: 7, completeDays: 6, averageKcal: 2000, weighIns: 3, averageKg: 80.1, singleKg: null, workouts: 2, minutes: 75 },
      { from: nov(17), to: nov(23), daysInUse: 7, completeDays: 7, averageKcal: 1800, weighIns: 1, averageKg: null, singleKg: 80.6, workouts: 0, minutes: 0 },
      { from: nov(10), to: nov(16), daysInUse: 7, completeDays: 2, averageKcal: null, weighIns: 0, averageKg: null, singleKg: null, workouts: 1, minutes: 60 },
      { from: nov(3), to: nov(9), daysInUse: 7, completeDays: 3, averageKcal: 2200, weighIns: 2, averageKg: 81.1, singleKg: null, workouts: 3, minutes: 60 },
    ]);
    expectAllFinite(r);
  });

  it('gives twelve blocks over 90 days, each null where it has too little behind it', () => {
    // Meals and a weigh-in every day for 89 days, except the block 41 to 35 days ago: two days of
    // meals and one weigh-in.
    const thinBlock = (ago: number) => ago <= 41 && ago >= 35;
    const totals = Array.from({ length: 89 }, (_, i) => i + 1)
      .filter((ago) => !thinBlock(ago) || ago >= 40)
      .map((ago) => food(addDays(TODAY, -ago), 1900));
    const weights = Array.from({ length: 90 }, (_, i) => i)
      .filter((ago) => !thinBlock(ago) || ago === 38)
      .map((ago) => ({ date: addDays(TODAY, -ago), kg: ago === 38 ? 81.3 : 80 }));
    const r = buildInsights(input({ days: 90, dayTotals: totals, loggedDates: totals.map((d) => d.date), weights }));
    expect(r.weeks).toHaveLength(12);
    expect(r.weeks.map((w) => w.to)).toEqual(Array.from({ length: 12 }, (_, i) => addDays(TODAY, -7 * i)));
    expect(r.weeks.map((w) => w.from)).toEqual(Array.from({ length: 12 }, (_, i) => addDays(TODAY, -7 * i - 6)));
    // The newest block holds today, which is never a full day.
    expect(r.weeks[0]).toEqual({ from: addDays(TODAY, -6), to: TODAY, daysInUse: 7, completeDays: 6, averageKcal: 1900, weighIns: 7, averageKg: 80, singleKg: null, workouts: 0, minutes: 0 });
    expect(r.weeks[5]).toEqual({
      from: addDays(TODAY, -41),
      to: addDays(TODAY, -35),
      daysInUse: 7,
      completeDays: 2,
      averageKcal: null,
      weighIns: 1,
      averageKg: null,
      singleKg: 81.3,
      workouts: 0,
      minutes: 0,
    });
    // The oldest block starts 83 days back: the first six days of the period are in no block.
    expect(r.weeks[11]).toMatchObject({ from: addDays(TODAY, -83), to: addDays(TODAY, -77), completeDays: 7, averageKcal: 1900, weighIns: 7, averageKg: 80 });
    expect(r.weeks.filter((w) => w.averageKcal === null)).toHaveLength(1);
  });

  it('has no block from before the first day anything was logged', () => {
    // Nine days of meals, ending yesterday.
    const totals = Array.from({ length: 9 }, (_, i) => food(addDays(TODAY, -(i + 1)), 1900));
    for (const days of [30, 90] as const) {
      const r = buildInsights(input({ days, dayTotals: totals, loggedDates: totals.map((d) => d.date) }));
      expect(r.weeks).toEqual([
        { from: addDays(TODAY, -6), to: TODAY, daysInUse: 7, completeDays: 6, averageKcal: 1900, weighIns: 0, averageKg: null, singleKg: null, workouts: 0, minutes: 0 },
        // Three of its seven days are since the first log, and three full days is just enough for an average.
        { from: addDays(TODAY, -13), to: addDays(TODAY, -7), daysInUse: 3, completeDays: 3, averageKcal: 1900, weighIns: 0, averageKg: null, singleKg: null, workouts: 0, minutes: 0 },
      ]);
    }
  });

  it('is empty when there is only one block to show: over 7 days, in a first week, and in an empty app', () => {
    const totals = Array.from({ length: 40 }, (_, i) => food(addDays(TODAY, -(i + 1)), 1900));
    expect(buildInsights(input({ days: 7, dayTotals: totals, loggedDates: totals.map((d) => d.date) })).weeks).toEqual([]);
    // First log 6 days ago: everything so far is inside the newest block.
    const firstWeek = totals.slice(0, 6);
    expect(buildInsights(input({ dayTotals: firstWeek, loggedDates: firstWeek.map((d) => d.date) })).weeks).toEqual([]);
    // First log 7 days ago: one day in the block before, so there are two rows to show.
    const eighthDay = totals.slice(0, 7);
    expect(buildInsights(input({ dayTotals: eighthDay, loggedDates: eighthDay.map((d) => d.date) })).weeks.map((w) => w.daysInUse)).toEqual([7, 1]);
    expect(buildInsights(input({ days: 30 })).weeks).toEqual([]);
    expect(buildInsights(input({ days: 90 })).weeks).toEqual([]);
  });
});

describe('periods', () => {
  const totals = Array.from({ length: 90 }, (_, i) => food(addDays(TODAY, -i), 1800 + (i % 3) * 100));
  const weights = Array.from({ length: 90 }, (_, i) => ({ date: addDays(TODAY, -i), kg: 78 + i * 0.05 }));

  it.each([7, 30, 90] as const)('covers exactly %i days ending today', (days) => {
    const r = buildInsights(input({ days, dayTotals: totals, loggedDates: totals.map((d) => d.date), weights }));
    expect(r.period.from).toBe(addDays(TODAY, -(days - 1)));
    if (!r.calories.ready || !r.consistency.ready || !r.weight.ready || !r.everyDay.ready) throw new Error('not ready');
    expect(r.calories.bars).toHaveLength(days);
    expect(r.calories.bars[0].date).toBe(r.period.from);
    expect(r.calories.bars[days - 1]).toMatchObject({ date: TODAY, isToday: true, dayIndex: days - 1 });
    expect(r.consistency.calendar).toHaveLength(days);
    expect(r.weight.points).toHaveLength(days);
    expect(r.everyDay.days).toHaveLength(days);
    expect(r.calories).toMatchObject({ loggedDays: days, countedDays: days, periodDays: days });
    // 0.05 kg a day is 0.35 kg a week, across the whole period. A week alone gets no rate of its own.
    if (days === 7) expect(r.weight.rate).toMatchObject({ ready: false, action: 'longer-period' });
    else expect(r.weight.rate).toMatchObject({ ready: true, clear: true, kgPerWeek: -0.35, days, weighIns: days });
    expect(r.weight.currentKg).toBe(78);
    expect(r.weighedToday).toBe(true);
    expect(r.maintenance.ready).toBe(days !== 7);
    expectAllFinite(r);
    expectPlainCopy(r);
  });
});
