/// <reference types="jest" />
import {
  goalPlanText,
  backupProblemsText,
  changeSincePrevious,
  cleanNumberText,
  countBackup,
  dayWords,
  exerciseTileText,
  goalStatusText,
  healthText,
  keepUnits,
  parseNumberText,
  restoreConfirmText,
  restoreDoneText,
  startingWeightKg,
  streakBadgeText,
  streakTileText,
  weightTileText,
  WEIGHT_RANGE_HINT,
  type DataCounts,
  type TileText,
} from '../../components/screen-text';
import { makeBackupFile } from '../backup-format';
import type { HealthGrants } from '../health';
import { buildTodaySummary, currentWeightKg, loggingStreak, type TodaySummary } from '../insights';
import { DEFAULT_SETTINGS } from '../settings-schema';
import type { Entry, Exercise, SavedFood, WeightEntry } from '../types';

const TODAY = '2026-11-11';

/** No sentence the owner reads may carry a number that could not be worked out. */
function expectClean(text: string) {
  expect(text).not.toMatch(/NaN|Infinity|undefined|null/);
  expect(text).not.toMatch(/!|·|successfully/);
}

function expectCleanTile(tile: TileText) {
  expectClean(tile.title);
  expectClean(tile.detail);
  expectClean(tile.label);
  expect(tile.title.length).toBeGreaterThan(0);
  expect(tile.detail.length).toBeGreaterThan(0);
}

describe('dayWords', () => {
  it('names today and yesterday, and dates everything else', () => {
    expect(dayWords('2026-11-11', TODAY)).toBe('today');
    expect(dayWords('2026-11-10', TODAY)).toBe('yesterday');
    expect(dayWords('2026-11-09', TODAY)).toBe('9 Nov');
  });

  it('adds the year when it is not this year', () => {
    expect(dayWords('2025-12-23', TODAY)).toBe('23 Dec 2025');
  });

  it('counts yesterday across a month and a year boundary', () => {
    expect(dayWords('2026-10-31', '2026-11-01')).toBe('yesterday');
    expect(dayWords('2025-12-31', '2026-01-01')).toBe('yesterday');
  });
});

describe('keepUnits', () => {
  const NB = '\u00A0';

  it('ties a figure to its unit and changes nothing else', () => {
    expect(keepUnits('Down 0.4 kg since yesterday (78.8 kg)')).toBe(`Down 0.4${NB}kg since yesterday (78.8${NB}kg)`);
    expect(keepUnits('Your weigh-ins put you at 78.7 kg, 6.7 kg to go.')).toBe(`Your weigh-ins put you at 78.7${NB}kg, 6.7${NB}kg to go.`);
    expect(keepUnits('0.4 kg a week')).toBe(`0.4${NB}kg a week`);
    expect(keepUnits('45 min, moderate')).toBe(`45${NB}min, moderate`);
    expect(keepUnits('+1,320 kcal')).toBe(`+1,320${NB}kcal`);
  });

  it('leaves alone text with no figure and unit, and words that only start like a unit', () => {
    for (const text of ['No change since yesterday', 'Logged 9 Nov', 'This is your first weigh-in.', '3 goals', '2 minutes', '5 kgs']) {
      expect(keepUnits(text)).toBe(text);
    }
  });

  it('reads the same once the spaces are ordinary again', () => {
    const line = changeSincePrevious(78.4, { date: '2026-11-10', kg: 78.8 }, TODAY);
    expect(keepUnits(line?.text ?? '').replace(new RegExp(NB, 'g'), ' ')).toBe(line?.text);
  });
});

describe('startingWeightKg', () => {
  it('opens on the day’s own weigh-in when there is one', () => {
    expect(startingWeightKg({ entryKg: 78.4, earlierKg: 79, latestKg: 77, profileKg: 80 })).toBe(78.4);
  });

  it('falls back to the weigh-in before, then the latest, then the profile, then 70 kg', () => {
    expect(startingWeightKg({ entryKg: null, earlierKg: 79, latestKg: 77, profileKg: 80 })).toBe(79);
    expect(startingWeightKg({ earlierKg: null, latestKg: 77, profileKg: 80 })).toBe(77);
    expect(startingWeightKg({ profileKg: 80 })).toBe(80);
    expect(startingWeightKg({})).toBe(70);
  });

  it('skips anything that is not a possible body weight', () => {
    expect(startingWeightKg({ entryKg: 0, earlierKg: Number.NaN, latestKg: 900, profileKg: 64.2 })).toBe(64.2);
    expect(startingWeightKg({ entryKg: Number.POSITIVE_INFINITY, profileKg: 0 })).toBe(70);
  });

  it('starts on the 0.1 kg grid', () => {
    expect(startingWeightKg({ entryKg: 72.34 })).toBe(72.3);
    expect(startingWeightKg({ latestKg: 72.30000000000001 })).toBe(72.3);
  });
});

describe('changeSincePrevious', () => {
  it('says how far down since yesterday, with the weight it is compared with', () => {
    const line = changeSincePrevious(78.4, { date: '2026-11-10', kg: 78.8 }, TODAY);
    expect(line).toEqual({ text: 'Down 0.4 kg since yesterday (78.8 kg)', direction: 'down', deltaKg: -0.4 });
  });

  it('dates an older weigh-in', () => {
    const line = changeSincePrevious(78.4, { date: '2026-11-02', kg: 77.2 }, TODAY);
    expect(line?.text).toBe('Up 1.2 kg since 2 Nov (77.2 kg)');
    expect(line?.direction).toBe('up');
  });

  it('calls two weights that show the same number no change', () => {
    const line = changeSincePrevious(78.44, { date: '2026-11-10', kg: 78.36 }, TODAY);
    expect(line?.text).toBe('No change since yesterday (78.4 kg)');
    expect(line?.direction).toBe('flat');
    expect(Object.is(line?.deltaKg, 0)).toBe(true);
  });

  it('does not let floating point invent a change', () => {
    // 72.3 - 72.2 is 0.09999999999999432 in floating point.
    expect(changeSincePrevious(72.3, { date: '2026-11-10', kg: 72.2 }, TODAY)?.text).toBe('Up 0.1 kg since yesterday (72.2 kg)');
    expect(changeSincePrevious(72.2, { date: '2026-11-10', kg: 72.3 }, TODAY)?.deltaKg).toBe(-0.1);
  });

  it('has nothing to say without an earlier weigh-in or a possible weight', () => {
    expect(changeSincePrevious(78.4, null, TODAY)).toBeNull();
    expect(changeSincePrevious(0, { date: '2026-11-10', kg: 78.8 }, TODAY)).toBeNull();
    expect(changeSincePrevious(Number.NaN, { date: '2026-11-10', kg: 78.8 }, TODAY)).toBeNull();
    expect(changeSincePrevious(500, { date: '2026-11-10', kg: 78.8 }, TODAY)).toBeNull();
    expect(changeSincePrevious(78.4, { date: '2026-11-10', kg: 0 }, TODAY)).toBeNull();
  });
});

describe('typed numbers', () => {
  it('keeps digits and one decimal point', () => {
    expect(cleanNumberText('80.5')).toBe('80.5');
    expect(cleanNumberText('8 0.5 kg')).toBe('80.5');
    expect(cleanNumberText('-12')).toBe('12');
    expect(cleanNumberText('12.')).toBe('12.');
    expect(cleanNumberText('.5')).toBe('.5');
    expect(cleanNumberText('')).toBe('');
  });

  it('takes a comma for the point, and drops a second point', () => {
    expect(cleanNumberText('80,5')).toBe('80.5');
    expect(cleanNumberText('1.2.3')).toBe('1.23');
    expect(cleanNumberText('1,2,3')).toBe('1.23');
    expect(cleanNumberText('..')).toBe('.');
  });

  it('stops at the decimal places it is given', () => {
    expect(cleanNumberText('80.55', 1)).toBe('80.5');
    expect(cleanNumberText('80.', 1)).toBe('80.');
    expect(cleanNumberText('80', 1)).toBe('80');
    expect(cleanNumberText('80.129', 2)).toBe('80.12');
    // No decimal places means no point at all.
    expect(cleanNumberText('80.5', 0)).toBe('80');
    // Without a limit, whatever was typed is kept.
    expect(cleanNumberText('80.555')).toBe('80.555');
  });

  it('reads the number the text stands for', () => {
    expect(parseNumberText('80.5')).toBe(80.5);
    expect(parseNumberText('12.')).toBe(12);
    expect(parseNumberText('.5')).toBe(0.5);
    expect(parseNumberText('007')).toBe(7);
  });

  it('reports 0, never NaN, for text that is not a number yet', () => {
    expect(parseNumberText('')).toBe(0);
    expect(parseNumberText('.')).toBe(0);
    for (const typed of ['', '.', ',', 'kg', '1e5', '--', '80,5 kg', '\u0668\u0660', ' 7 ']) {
      const n = parseNumberText(cleanNumberText(typed, 1));
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  it('reads a stepped weight back as the same number, so stepping never fights the text', () => {
    // The weight sheet writes a stepped value with one decimal and compares it with what the text says.
    for (const kg of [20, 72.3, 79.9, 80, 80.1, 100.5, 400]) {
      expect(parseNumberText(cleanNumberText(kg.toFixed(1), 1))).toBe(kg);
    }
  });
});

describe('weightTileText', () => {
  const summary = (weights: { date: string; kg: number }[]): TodaySummary['weight'] =>
    buildTodaySummary({ today: TODAY, loggedDates: [], weights }).weight;

  it('is an unlit invitation before the first weigh-in', () => {
    const tile = weightTileText(summary([]), TODAY);
    expect(tile).toEqual({ title: 'Log weight', detail: 'No weigh-in yet', icon: null, lit: false, label: 'Log weight. No weigh-in yet' });
    expectCleanTile(tile);
  });

  it('is lit once today has its weigh-in, and says so while there is no rate to state', () => {
    expect(weightTileText(summary([{ date: TODAY, kg: 78.4 }]), TODAY)).toEqual({
      title: '78.4 kg',
      detail: 'Logged today',
      icon: null,
      lit: true,
      label: 'Weight, 78.4 kilograms, logged today. Edit today’s weight',
    });
    // Three weigh-ins across a first week give a slope, but not one that can be stated.
    const firstWeek = weightTileText(summary([{ date: '2026-11-05', kg: 80 }, { date: '2026-11-08', kg: 79.7 }, { date: TODAY, kg: 79.4 }]), TODAY);
    expect(firstWeek).toMatchObject({ title: '79.4 kg', detail: 'Logged today', icon: null, lit: true });
    expect(firstWeek.label).toBe('Weight, 79.4 kilograms, logged today. Edit today’s weight');
    expectCleanTile(firstWeek);
  });

  it('is unlit, and says when the latest weigh-in was, until today has one', () => {
    expect(weightTileText(summary([{ date: '2026-11-10', kg: 78.4 }]), TODAY)).toEqual({
      title: '78.4 kg',
      detail: 'Logged yesterday',
      icon: null,
      lit: false,
      label: 'Weight, 78.4 kilograms, logged yesterday. Log today’s weight',
    });
    const stale = weightTileText(summary([{ date: '2026-10-20', kg: 80 }, { date: '2026-11-01', kg: 79.1 }]), TODAY);
    expect(stale).toMatchObject({ title: '79.1 kg', detail: 'Logged 1 Nov', icon: null, lit: false });
    expect(stale.label).toBe('Weight, 79.1 kilograms, logged 1 Nov. Log today’s weight');
    // Two mornings in a row a week ago are a day of water, not a change over 7 days.
    const twoMornings = weightTileText(summary([{ date: '2026-11-04', kg: 81 }, { date: '2026-11-05', kg: 81.5 }]), TODAY);
    expect(twoMornings).toMatchObject({ title: '81.5 kg', detail: 'Logged 5 Nov', icon: null, lit: false });
    expect(twoMornings.label).not.toMatch(/Losing|Gaining|steady/);
  });

  // Five weekly weigh-ins ending today, all inside the last 30 days.
  const weekly = (kgs: number[]) => ['2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04', TODAY].map((date, i) => ({ date, kg: kgs[i] }));
  // The same five, one day earlier: the last one is yesterday's and the first is still inside the last 30 days.
  const weeklyToYesterday = (kgs: number[]) =>
    ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10'].map((date, i) => ({ date, kg: kgs[i] }));

  it('shows the weekly rate with its arrow when it is clear and today is weighed', () => {
    // 0.5 kg lower each week.
    const tile = weightTileText(summary(weekly([80, 79.5, 79, 78.5, 78])), TODAY);
    expect(tile).toEqual({
      title: '78.0 kg',
      detail: '0.5 kg a week',
      icon: 'trending-down',
      lit: true,
      label: 'Weight, 78.0 kilograms, logged today. Losing 0.5 kilograms a week. Edit today’s weight',
    });
  });

  it('points up when the weight is rising', () => {
    const tile = weightTileText(summary(weekly([70, 70.3, 70.6, 70.9, 71.2])), TODAY);
    expect(tile).toMatchObject({ title: '71.2 kg', detail: '0.3 kg a week', icon: 'trending-up', lit: true });
    expect(tile.label).toContain('Gaining 0.3 kilograms a week');
    expect(tile.label).toContain('logged today');
  });

  it('says steady when the weigh-ins pin the weight down as steady', () => {
    const tile = weightTileText(summary(weekly([70, 70.02, 70, 70.03, 70])), TODAY);
    expect(tile).toMatchObject({ title: '70.0 kg', detail: 'Steady', icon: 'trending-neutral', lit: true });
    expect(tile.label).toBe('Weight, 70.0 kilograms, logged today. Holding steady. Edit today’s weight');
  });

  it('shows no rate on a day without a weigh-in, and still speaks it', () => {
    // The same clear 0.5 kg a week, but the number on the tile is yesterday's: the tile has to say
    // that first, and an arrow beside an old weight would make it look current.
    const losing = weightTileText(summary(weeklyToYesterday([80, 79.5, 79, 78.5, 78])), TODAY);
    expect(losing).toEqual({
      title: '78.0 kg',
      detail: 'Logged yesterday',
      icon: null,
      lit: false,
      label: 'Weight, 78.0 kilograms, logged yesterday. Losing 0.5 kilograms a week. Log today’s weight',
    });
    const steady = weightTileText(summary(weeklyToYesterday([70, 70.02, 70, 70.03, 70])), TODAY);
    expect(steady).toMatchObject({ detail: 'Logged yesterday', icon: null, lit: false });
    expect(steady.label).toBe('Weight, 70.0 kilograms, logged yesterday. Holding steady. Log today’s weight');
  });

  it('never shows a rate of 0.0 kg with an arrow, or one that is not a number', () => {
    const base = summary(weekly([80, 79.5, 79, 78.5, 78]));
    if (!base.rate.ready) throw new Error('expected a rate');
    const rounding = weightTileText({ ...base, rate: { ...base.rate, kgPerWeek: -0.04 } }, TODAY);
    expect(rounding).toMatchObject({ detail: 'Steady', icon: 'trending-neutral' });
    const broken = weightTileText({ ...base, rate: { ...base.rate, kgPerWeek: Number.NaN } }, TODAY);
    expect(broken.detail).toBe('Logged today');
    expect(broken.icon).toBeNull();
    expectCleanTile(broken);
  });

  it('states a rate only when the data layer calls it clear or steady', () => {
    const base = summary(weekly([80, 79.5, 79, 78.5, 78]));
    if (!base.rate.ready) throw new Error('expected a rate');
    // A slope that is neither clear nor steady: no arrow, no figure, nothing spoken about it.
    const unclear = weightTileText({ ...base, rate: { ...base.rate, clear: false, steady: false, direction: null } }, TODAY);
    expect(unclear).toMatchObject({ detail: 'Logged today', icon: null, lit: true });
    expect(unclear.label).toBe('Weight, 78.0 kilograms, logged today. Edit today’s weight');
  });

  it('never calls an older weigh-in today’s', () => {
    // The flag and the date disagree only if the data is broken; the date on the weigh-in wins.
    const base = summary([{ date: '2026-11-10', kg: 78.4 }]);
    const tile = weightTileText({ ...base, weighedToday: true }, TODAY);
    expect(tile).toMatchObject({ detail: 'Logged yesterday', lit: false });
  });

  it('treats a weight that is not possible as no weigh-in', () => {
    const tile = weightTileText({ latest: { date: TODAY, kg: Number.NaN }, weighedToday: true, rate: { ready: false, reason: 'x' } }, TODAY);
    expect(tile.lit).toBe(false);
    expectCleanTile(tile);
  });
});

describe('streakTileText', () => {
  it('invites a first streak', () => {
    const tile = streakTileText({ current: 0, best: 0, loggedToday: false });
    expect(tile).toMatchObject({ title: 'Start a streak', detail: 'Log a meal today', lit: false, icon: null });
    expectCleanTile(tile);
  });

  it('invites a new streak and remembers the best one', () => {
    expect(streakTileText({ current: 0, best: 12, loggedToday: false })).toMatchObject({
      title: 'Start a streak',
      detail: 'Best 12 days',
      lit: false,
    });
    expect(streakTileText({ current: 0, best: 1, loggedToday: false }).detail).toBe('Best 1 day');
  });

  it('shows the streak with the best one underneath', () => {
    const tile = streakTileText({ current: 5, best: 12, loggedToday: true });
    expect(tile).toEqual({
      title: '5-day streak',
      detail: 'Best 12 days',
      icon: null,
      lit: true,
      label: '5-day logging streak. Best 12 days. Opens Progress',
    });
  });

  it('says so when this streak is the longest', () => {
    expect(streakTileText({ current: 1, best: 1, loggedToday: true })).toMatchObject({ title: '1-day streak', detail: 'Your longest yet' });
    expect(streakTileText({ current: 30, best: 30, loggedToday: true }).detail).toBe('Your longest yet');
    expect(streakTileText({ current: 30, best: 30, loggedToday: true }).label).toBe('30-day logging streak. Your longest yet. Opens Progress');
  });

  it('tells a screen reader when today still needs logging', () => {
    expect(streakTileText({ current: 5, best: 12, loggedToday: false }).label).toBe(
      '5-day logging streak. Best 12 days. Log a meal today to keep it going. Opens Progress',
    );
  });

  it('copes with figures that make no sense', () => {
    // A best below the current streak cannot be right; the current one is then the best.
    expect(streakTileText({ current: 7, best: 3, loggedToday: true }).detail).toBe('Your longest yet');
    const broken = streakTileText({ current: Number.NaN, best: Number.NaN, loggedToday: false });
    expect(broken.title).toBe('Start a streak');
    expectCleanTile(broken);
    expectCleanTile(streakTileText({ current: -2, best: Number.POSITIVE_INFINITY, loggedToday: false }));
  });

  it('reads the streak the data layer works out', () => {
    const streak = loggingStreak(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-09', '2026-11-10'], TODAY);
    expect(streakTileText(streak)).toMatchObject({ title: '2-day streak', detail: 'Best 3 days', lit: true });
  });
});

describe('streakBadgeText', () => {
  it('shows the run of days and is lit only once today is logged', () => {
    expect(streakBadgeText({ current: 12, best: 30, loggedToday: true })).toEqual({
      count: '12',
      lit: true,
      label: '12-day logging streak. Best 30 days. Opens Progress',
    });
    // Yesterday's streak still stands this morning, but today has nothing yet.
    expect(streakBadgeText({ current: 12, best: 30, loggedToday: false })).toEqual({
      count: '12',
      lit: false,
      label: '12-day logging streak. Best 30 days. Log a meal today to keep it going. Opens Progress',
    });
  });

  it('is an unlit zero with the old tile’s invitation when there is no streak', () => {
    expect(streakBadgeText({ current: 0, best: 0, loggedToday: false })).toEqual({
      count: '0',
      lit: false,
      label: 'No streak yet. Log a meal today to start one. Opens Progress',
    });
    expect(streakBadgeText({ current: 0, best: 12, loggedToday: false }).label).toBe(
      'No streak at the moment. Your best is 12 days. Log a meal to start a new one. Opens Progress',
    );
  });

  it('says the same as the streak tile did, and copes with figures that make no sense', () => {
    for (const streak of [
      { current: 1, best: 1, loggedToday: true },
      { current: 5, best: 12, loggedToday: false },
      { current: 0, best: 3, loggedToday: false },
    ]) {
      expect(streakBadgeText(streak).label).toBe(streakTileText(streak).label);
    }
    const broken = streakBadgeText({ current: Number.NaN, best: Number.NaN, loggedToday: true });
    expect(broken).toMatchObject({ count: '0', lit: false });
    expectClean(broken.label);
    expect(streakBadgeText({ current: 7.9, best: 3, loggedToday: true }).count).toBe('7');
    expect(streakBadgeText({ current: 1200, best: 1200, loggedToday: true }).count).toBe('1,200');
  });
});

describe('exerciseTileText', () => {
  const run = { activity: 'Run', minutes: 30, calories: 320 };
  const walk = { activity: 'Walk', minutes: 25, calories: 80.4 };

  it('is an unlit invitation until a workout is logged today', () => {
    const tile = exerciseTileText([]);
    expect(tile).toEqual({
      title: 'Log exercise',
      detail: 'Adds to today’s budget',
      icon: null,
      lit: false,
      label: 'Log exercise',
    });
    expectCleanTile(tile);
  });

  it('is lit by one workout, with the calories burned first and the workout underneath', () => {
    expect(exerciseTileText([run])).toEqual({
      title: '320 kcal',
      detail: 'Run, 30 min',
      icon: null,
      lit: true,
      label: 'Exercise, 320 calories burned today. Run, 30 min. Log another workout',
    });
    expect(exerciseTileText([{ activity: 'Cycle', minutes: 75, calories: 1240 }])).toMatchObject({ title: '1,240 kcal', detail: 'Cycle, 1 h 15 min' });
  });

  it('adds several workouts up', () => {
    expect(exerciseTileText([run, walk])).toEqual({
      title: '400 kcal',
      detail: '2 workouts, 55 min',
      icon: null,
      lit: true,
      label: 'Exercise, 400 calories burned today. 2 workouts, 55 min. Log another workout',
    });
    expect(exerciseTileText([run, walk, run]).detail).toBe('3 workouts, 1 h 25 min');
  });

  it('copes with figures that make no sense', () => {
    const broken = exerciseTileText([{ activity: 'Run', minutes: Number.NaN, calories: Number.POSITIVE_INFINITY }]);
    expect(broken).toMatchObject({ title: '0 kcal', detail: 'Run, 0 min', lit: true });
    expectCleanTile(broken);
    expectCleanTile(exerciseTileText([run, { activity: 'Walk', minutes: -5, calories: -40 }]));
    expect(exerciseTileText([run, { activity: 'Walk', minutes: -5, calories: -40 }]).title).toBe('320 kcal');
  });
});

describe('goalStatusText', () => {
  const latest = { date: '2026-11-10', kg: 78.4 };

  it('asks for whatever is missing', () => {
    expect(goalStatusText(null, null, null)).toBe('Set a target to see how far there is to go.');
    expect(goalStatusText(null, latest, null)).toBe('Latest weigh-in 78.4 kg. Set a target to aim for.');
    expect(goalStatusText(72, null, null)).toBe('Log your weight to see how far there is to go.');
  });

  it('shows the latest weigh-in and how far there is to go', () => {
    expect(goalStatusText(72, latest, 80)).toBe('Latest weigh-in 78.4 kg, 6.4 kg to go.');
    // Gaining towards a higher target.
    expect(goalStatusText(82, latest, 76)).toBe('Latest weigh-in 78.4 kg, 3.6 kg to go.');
    // No starting weight yet: the distance is still known.
    expect(goalStatusText(72, latest, null)).toBe('Latest weigh-in 78.4 kg, 6.4 kg to go.');
  });

  it('counts the target as reached once it is passed in the direction it was set', () => {
    expect(goalStatusText(72, { date: TODAY, kg: 71.6 }, 80)).toBe('Latest weigh-in 71.6 kg, at your target.');
    expect(goalStatusText(82, { date: TODAY, kg: 82.5 }, 76)).toBe('Latest weigh-in 82.5 kg, at your target.');
    expect(goalStatusText(72, { date: TODAY, kg: 72 }, null)).toBe('Latest weigh-in 72.0 kg, at your target.');
  });

  it('measures from the current weight when it is given, and says what that is built on', () => {
    // The latest reading is 78.4, but the recent weigh-ins put the weight at 78.7.
    expect(goalStatusText(72, latest, 80, 78.7)).toBe('Your weigh-ins put you at 78.7 kg, 6.7 kg to go.');
    // Gaining towards a higher target.
    expect(goalStatusText(82, latest, 76, 78.1)).toBe('Your weigh-ins put you at 78.1 kg, 3.9 kg to go.');
    // A current weight that shows as the same number is called what it is: the weigh-in.
    expect(goalStatusText(72, latest, 80, 78.4)).toBe('Latest weigh-in 78.4 kg, 6.4 kg to go.');
    expect(goalStatusText(72, latest, 80, 78.44)).toBe('Latest weigh-in 78.4 kg, 6.4 kg to go.');
    // A weigh-in read from a scale keeps two decimals; it is compared as it is shown.
    expect(goalStatusText(72, { date: '2026-11-10', kg: 78.44 }, 80, 78.4)).toBe('Latest weigh-in 78.4 kg, 6.4 kg to go.');
  });

  it('does not call the target reached on one low morning', () => {
    // 71.9 this morning is under the 72 target; the weight the recent weigh-ins give, 72.6, is not.
    expect(goalStatusText(72, { date: TODAY, kg: 71.9 }, 80, 72.6)).toBe('Your latest weigh-in is at your target. A few more will confirm it.');
    // The same for a target that is being gained towards.
    expect(goalStatusText(82, { date: TODAY, kg: 82.1 }, 76, 81.5)).toBe('Your latest weigh-in is at your target. A few more will confirm it.');
    // Without a starting weight, "at" means within 0.05 kg.
    expect(goalStatusText(72, { date: TODAY, kg: 72 }, null, 72.6)).toBe('Your latest weigh-in is at your target. A few more will confirm it.');
  });

  it('calls it reached when the current weight is there, whatever the last reading was', () => {
    // One high morning does not take the target away again.
    expect(goalStatusText(72, { date: TODAY, kg: 72.6 }, 80, 71.9)).toBe('Your weigh-ins put you at 71.9 kg, at your target.');
    expect(goalStatusText(82, { date: TODAY, kg: 81.6 }, 76, 82)).toBe('Your weigh-ins put you at 82.0 kg, at your target.');
  });

  it('falls back to the latest weigh-in when the current weight is missing or not possible', () => {
    for (const current of [null, Number.NaN, 0, 900, Number.POSITIVE_INFINITY]) {
      expect(goalStatusText(72, latest, 80, current)).toBe('Latest weigh-in 78.4 kg, 6.4 kg to go.');
    }
    // A current weight cannot stand in for a weigh-in that is not there.
    expect(goalStatusText(72, null, 80, 78.4)).toBe('Log your weight to see how far there is to go.');
    expect(goalStatusText(null, latest, null, 78.7)).toBe('Latest weigh-in 78.4 kg. Set a target to aim for.');
  });

  it('reads the same current weight as Progress', () => {
    // Four weekly weigh-ins on a 0.5 kg a week line, then one low morning. The line through them
    // is at 77.64 kg on the last day (mean 78.88 kg on day 14, slope -43.4 / 490 kg a day).
    const weights = [
      { date: '2026-10-14', kg: 80 },
      { date: '2026-10-21', kg: 79.5 },
      { date: '2026-10-28', kg: 79 },
      { date: '2026-11-04', kg: 78.5 },
      { date: TODAY, kg: 77.4 },
    ];
    const current = currentWeightKg(weights, TODAY);
    expect(current).toBe(77.6);
    const low = weights[weights.length - 1];
    expect(goalStatusText(72, low, 80, current)).toBe('Your weigh-ins put you at 77.6 kg, 5.6 kg to go.');
    // Against a 77.5 kg target the morning's 77.4 is there and the current weight is not.
    expect(goalStatusText(77.5, low, 80, current)).toBe('Your latest weigh-in is at your target. A few more will confirm it.');
    // With one weigh-in the current weight is that weigh-in, and it is named as one.
    const only = [{ date: TODAY, kg: 77.4 }];
    expect(goalStatusText(72, only[0], 80, currentWeightKg(only, TODAY))).toBe('Latest weigh-in 77.4 kg, 5.4 kg to go.');
    expect(goalStatusText(77.5, only[0], 80, currentWeightKg(only, TODAY))).toBe('Latest weigh-in 77.4 kg, at your target.');
  });

  it('does not call it reached from the wrong side', () => {
    // Set to gain from 76 to 82, now below where it started.
    expect(goalStatusText(82, { date: TODAY, kg: 75 }, 76)).toBe('Latest weigh-in 75.0 kg, 7.0 kg to go.');
    // Without a starting weight, being under a target is not the same as being at it.
    expect(goalStatusText(72, { date: TODAY, kg: 71 }, null)).toBe('Latest weigh-in 71.0 kg, 1.0 kg to go.');
  });

  it('ignores weights that are not possible', () => {
    expect(goalStatusText(Number.NaN, latest, null)).toBe('Latest weigh-in 78.4 kg. Set a target to aim for.');
    expect(goalStatusText(72, { date: TODAY, kg: Number.NaN }, 80)).toBe('Log your weight to see how far there is to go.');
    expectClean(goalStatusText(72, latest, Number.NaN));
    expectClean(goalStatusText(0, { date: TODAY, kg: 0 }, 0));
  });
});

describe('healthText', () => {
  const all: HealthGrants = {
    writeNutrition: true,
    writeExercise: true,
    readSteps: true,
    readActiveCalories: true,
    writeWeight: true,
    readWeight: true,
  };

  it('says what connecting does when not connected', () => {
    const text = healthText(false, null);
    expect(text.status).toBe('Send meals, workouts and weigh-ins to Google Fit, and see steps and activity');
    expect(text.workouts).toBeNull();
    expect(text.weight).toBeNull();
    // Old grants do not matter while syncing is off.
    expect(healthText(false, { ...all, writeWeight: false }).weight).toBeNull();
  });

  it('offers nothing until the grants have been read', () => {
    expect(healthText(true, null)).toEqual({ status: 'Meals go to Google Fit', workouts: null, weight: null });
  });

  it('offers nothing when everything is allowed', () => {
    expect(healthText(true, all)).toEqual({
      status: 'Meals, workouts and weigh-ins go to Google Fit; steps and activity show on Today',
      workouts: null,
      weight: null,
    });
  });

  it('offers weight to someone who connected before weigh-ins existed', () => {
    const text = healthText(true, { ...all, writeWeight: false, readWeight: false });
    expect(text.status).toBe('Meals and workouts go to Google Fit. Weigh-ins are not shared yet');
    expect(text.workouts).toBeNull();
    expect(text.weight).toEqual({ headline: 'Weight is not shared', supporting: 'Send weigh-ins to Google Fit and read them from your scale' });
  });

  it('tells writing weight and reading weight apart', () => {
    const writeOnly = healthText(true, { ...all, readWeight: false });
    expect(writeOnly.status).toBe('Meals, workouts and weigh-ins go to Google Fit. Weigh-ins from other apps are not read yet');
    expect(writeOnly.weight?.headline).toBe('Weigh-ins are not read');
    const readOnly = healthText(true, { ...all, writeWeight: false });
    expect(readOnly.status).toBe('Meals and workouts go to Google Fit. Weigh-ins are not shared yet');
    expect(readOnly.weight?.headline).toBe('Weigh-ins are not sent');
  });

  it('ends every row on a whole phrase', () => {
    const rows = [
      healthText(true, { ...all, writeWeight: false, readWeight: false }).weight,
      healthText(true, { ...all, readWeight: false }).weight,
      healthText(true, { ...all, writeWeight: false }).weight,
      healthText(true, { ...all, writeExercise: false }).workouts,
    ];
    for (const row of rows) {
      expect(row).not.toBeNull();
      // Not on a possessive or a joining word with nothing after it.
      expect(row?.supporting).not.toMatch(/(’s|'s| and| or| your| the| to)$/);
    }
  });

  it('offers workouts and weight separately when both are missing', () => {
    const text = healthText(true, { ...all, writeExercise: false, writeWeight: false, readWeight: false });
    expect(text.status).toBe('Meals go to Google Fit. Workouts and weigh-ins are not shared yet');
    expect(text.workouts?.headline).toBe('Workouts are not shared');
    expect(text.weight?.headline).toBe('Weight is not shared');
  });

  it('offers only workouts when weight is already allowed', () => {
    const text = healthText(true, { ...all, writeExercise: false });
    expect(text.status).toBe('Meals and weigh-ins go to Google Fit. Workouts are not shared yet');
    expect(text.workouts).not.toBeNull();
    expect(text.weight).toBeNull();
  });
});

describe('backup dialogs', () => {
  const entry = (id: number, date: string): Entry => ({
    id,
    date,
    meal: 'lunch',
    name: 'Rice',
    portion: '1 cup',
    calories: 200,
    protein: 4,
    carbs: 44,
    fat: 0.5,
    source: 'text',
    createdAt: 1,
    hcRecordId: null,
  });
  const workout = (id: number, date: string): Exercise => ({
    id,
    date,
    activity: 'walk',
    minutes: 30,
    intensity: 'moderate',
    calories: 90,
    createdAt: 1,
    hcSessionId: null,
    hcCaloriesId: null,
  });
  const weighIn = (id: number, date: string): WeightEntry => ({ id, date, kg: 78, source: 'manual', createdAt: 1, hcRecordId: null });
  const food = (id: number): SavedFood => ({
    id,
    name: `Food ${id}`,
    portion: '',
    calories: 100,
    protein: 1,
    carbs: 1,
    fat: 1,
    pinned: false,
    useCount: 1,
    lastUsedAt: 1,
  });

  const file: DataCounts = { foodDays: 62, workouts: 38, weighIns: 61, savedFoods: 54 };
  const phone: DataCounts = { foodDays: 12, workouts: 1, weighIns: 5, savedFoods: 0 };
  const now = new Date(2026, 10, 11, 9, 0);
  const madeOn = (year: number, month: number, day: number) => new Date(year, month - 1, day, 8, 30).toISOString();

  it('counts days of food, not food entries', () => {
    const backup = makeBackupFile({
      entries: [entry(1, '2026-11-01'), entry(2, '2026-11-01'), entry(3, '2026-11-02'), entry(4, '2026-11-05')],
      foods: [food(1), food(2)],
      exercises: [workout(1, '2026-11-01'), workout(2, '2026-11-01')],
      weights: [weighIn(1, '2026-11-01'), weighIn(2, '2026-11-02'), weighIn(3, '2026-11-03')],
      settings: DEFAULT_SETTINGS,
    });
    expect(countBackup(backup)).toEqual({ foodDays: 3, workouts: 2, weighIns: 3, savedFoods: 2 });
  });

  it('counts an empty backup as nothing', () => {
    const backup = makeBackupFile({ entries: [], foods: [], exercises: [], weights: [], settings: DEFAULT_SETTINGS });
    expect(countBackup(backup)).toEqual({ foodDays: 0, workouts: 0, weighIns: 0, savedFoods: 0 });
  });

  it('says what the file holds and exactly what it replaces', () => {
    expect(restoreConfirmText(file, phone, madeOn(2026, 11, 9), now)).toBe(
      'The backup from 9 Nov has 62 days of food, 38 workouts and 61 weigh-ins, plus 54 saved foods and your settings.' +
        '\n\nIt replaces everything on this phone: 12 days of food, 1 workout and 5 weigh-ins, 0 saved foods and your settings. This cannot be undone.' +
        '\n\nYour Groq API key is not part of a backup and stays as it is.',
    );
  });

  it('uses one of each correctly and groups thousands', () => {
    const one: DataCounts = { foodDays: 1, workouts: 1, weighIns: 1, savedFoods: 1 };
    const text = restoreConfirmText(one, { foodDays: 1240, workouts: 0, weighIns: 0, savedFoods: 1 }, madeOn(2026, 11, 11), now);
    expect(text).toContain('The backup from today has 1 day of food, 1 workout and 1 weigh-in, plus 1 saved food and your settings.');
    expect(text).toContain('1,240 days of food, 0 workouts and 0 weigh-ins, 1 saved food and your settings');
  });

  it('dates the backup in words', () => {
    expect(restoreConfirmText(file, phone, madeOn(2026, 11, 10), now)).toContain('The backup from yesterday has');
    expect(restoreConfirmText(file, phone, madeOn(2025, 12, 23), now)).toContain('The backup from 23 Dec 2025 has');
  });

  it('leaves out a date it cannot read', () => {
    const text = restoreConfirmText(file, phone, 'not a date', now);
    expect(text.startsWith('The backup has 62 days of food')).toBe(true);
    expectClean(text);
  });

  it('says so when there is nothing on the phone to lose', () => {
    const text = restoreConfirmText(file, { foodDays: 0, workouts: 0, weighIns: 0, savedFoods: 0 }, madeOn(2026, 11, 9), now);
    expect(text).toContain('Nothing is logged on this phone yet, so only its settings are replaced.');
    expect(text).not.toContain('cannot be undone');
  });

  it('confirms a restore with the counts from the file', () => {
    expect(restoreDoneText(file)).toBe('Backup restored: 62 days of food, 38 workouts and 61 weigh-ins');
    expect(restoreDoneText({ foodDays: 1, workouts: 0, weighIns: 1, savedFoods: 0 })).toBe('Backup restored: 1 day of food, 0 workouts and 1 weigh-in');
  });

  it('lists why a file cannot be restored, and that nothing changed', () => {
    expect(backupProblemsText(['Food entry 3 has no name.', 'Weigh-in 2 has a weight that is not possible.'])).toBe(
      'Food entry 3 has no name.\nWeigh-in 2 has a weight that is not possible.\n\nNothing on this phone was changed.',
    );
  });

  it('still says something when no reason was given', () => {
    expect(backupProblemsText([])).toBe('This file is not a Calorie Tracker backup.\n\nNothing on this phone was changed.');
    expect(backupProblemsText(['  ', ''])).toBe('This file is not a Calorie Tracker backup.\n\nNothing on this phone was changed.');
  });
});

describe('copy rules', () => {
  it('states the weight range in plain words', () => {
    expect(WEIGHT_RANGE_HINT).toBe('Enter a weight between 20 and 400 kg.');
  });
});

describe('goalPlanText', () => {
  const me = { sex: 'male' as const, age: 30, heightCm: 175, weightKg: 80, activity: 'moderate' as const };

  it('says how far under or over and the protein', () => {
    expect(goalPlanText({ ...me, goal: 'lose_fat', rateKg: 0.5 }, null)).toBe(
      'About 550 kcal a day under what you burn, with 2 g of protein per kg so you keep muscle.',
    );
    expect(goalPlanText({ ...me, goal: 'build_muscle', rateKg: 0.25 }, null)).toMatch(/^About 280 kcal a day over what you burn, with 2 g/);
    expect(goalPlanText({ ...me, goal: 'maintain' }, null)).toBe('What you burn, with 1.6 g of protein per kg.');
    expect(goalPlanText({ ...me, goal: 'recomp' }, null)).toMatch(/2\.2 g of protein per kg\. It needs strength training/);
  });

  it('adds the weeks to a target weight in the goal\'s direction only', () => {
    expect(goalPlanText({ ...me, goal: 'lose_fat', rateKg: 0.5 }, 75)).toMatch(/At this pace, 75(\.0)? kg takes about 10 weeks\.$/);
    expect(goalPlanText({ ...me, goal: 'build_muscle', rateKg: 0.25 }, 75)).not.toMatch(/weeks/);
    expect(goalPlanText({ ...me, goal: 'build_muscle', rateKg: 0.25 }, 82)).toMatch(/takes about 8 weeks\.$/);
  });

  it('says when the floor holds the calories up', () => {
    const tiny = { sex: 'female' as const, age: 70, heightCm: 145, weightKg: 40, activity: 'sedentary' as const };
    expect(goalPlanText({ ...tiny, goal: 'lose_fat', rateKg: 1 }, 35)).toMatch(/Held at 1,?200 kcal, the lowest this suggests\.$/);
  });
});
