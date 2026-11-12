/// <reference types="jest" />
import { addDays } from '../dates';
import {
  buildInsights,
  WEEKDAY_MIN_DAYS,
  type DayFoodTotal,
  type DaySummary,
  type InsightsInput,
  type PatternsInfo,
  type WeekBlock,
  type WeighIn,
} from '../insights';
import {
  averageVsGoalText,
  barsPath,
  biggestMealText,
  budgetProgress,
  calendarHeight,
  calendarMarkSize,
  calendarMonthLabels,
  calendarWeeks,
  calorieChartBars,
  cappedCirclesPath,
  chartOffset,
  chartRows,
  clamp01,
  dateSpanText,
  describeCalendar,
  describeCalorieChart,
  describeExerciseChart,
  describeWeekdayChart,
  describeWeightChart,
  dayRowText,
  dotsPath,
  exerciseChartBars,
  glanceText,
  latestWeighInText,
  layoutBars,
  layoutCalendar,
  layoutLineChart,
  maintenanceBasisText,
  niceTicks,
  overBudgetShare,
  percentText,
  periodAxis,
  periodRangeText,
  plural,
  recalcSummary,
  relativeToLargest,
  roundedRect,
  scaleLinear,
  splitAnswer,
  splitBarsPath,
  topRoundedBar,
  weekdayChartBars,
  weekRowText,
  weightChartMarks,
  WEEKDAY_AXIS,
} from '../progress-view';

// 30 November 2026 is a Monday, so the 30-day period starts on Sunday 1 November.
const TODAY = '2026-11-30';
const FROM_30 = '2026-11-01';
const nov = (dayOfMonth: number) => `2026-11-${String(dayOfMonth).padStart(2, '0')}`;

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

const food = (date: string, calories: number): DayFoodTotal => ({ date, calories, protein: 100, carbs: 250, fat: 60, count: 3 });

function on<T extends { ready: boolean }>(card: T): Extract<T, { ready: true }> {
  if (!card.ready) throw new Error(`expected a ready card, got: ${JSON.stringify(card)}`);
  return card as Extract<T, { ready: true }>;
}

/** Every number anywhere inside a value, to check none of them is NaN or Infinity. */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(numbersIn);
  return [];
}

describe('small helpers', () => {
  test('clamp01 keeps a share between 0 and 1 and turns nonsense into 0', () => {
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(7)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
  });

  test('scaleLinear maps a value across a range', () => {
    expect(scaleLinear(5, 0, 10, 0, 200)).toBe(100);
    // Chart y runs downward: the top of the range is the smaller pixel.
    expect(scaleLinear(80, 77, 81, 100, 0)).toBe(25);
  });

  test('scaleLinear puts everything in the middle when the domain has no width', () => {
    expect(scaleLinear(5, 3, 3, 0, 200)).toBe(100);
    expect(scaleLinear(NaN, 0, 10, 0, 200)).toBe(100);
    expect(scaleLinear(5, 0, Infinity, 0, 200)).toBe(100);
  });

  test('plural', () => {
    expect(plural(1, 'day')).toBe('1 day');
    expect(plural(0, 'day')).toBe('0 days');
    expect(plural(12, 'weigh-in')).toBe('12 weigh-ins');
  });

  test('percentText rounds a share and never shows a sliver as nothing', () => {
    expect(percentText(0.223)).toBe('22%');
    expect(percentText(1)).toBe('100%');
    expect(percentText(1.4)).toBe('100%');
    expect(percentText(0)).toBe('0%');
    expect(percentText(0.004)).toBe('under 1%');
    expect(percentText(NaN)).toBe('0%');
  });

  test('relativeToLargest scales to the biggest value and survives all zeros', () => {
    expect(relativeToLargest([10, 5, 0])).toEqual([1, 0.5, 0]);
    expect(relativeToLargest([0, 0])).toEqual([0, 0]);
    expect(relativeToLargest([NaN, -3, 4])).toEqual([0, 0, 1]);
    expect(relativeToLargest([])).toEqual([]);
  });

  test('budgetProgress never divides by zero', () => {
    expect(budgetProgress(1000, 2000)).toBe(0.5);
    expect(budgetProgress(3000, 2000)).toBe(1);
    expect(budgetProgress(0, 0)).toBe(0);
    expect(budgetProgress(500, 0)).toBe(1);
    expect(budgetProgress(NaN, 2000)).toBe(0);
  });

  test('overBudgetShare is the part of a day past its budget, as a share of the budget', () => {
    expect(overBudgetShare(2500, 2000)).toBe(0.25);
    expect(overBudgetShare(2000, 2000)).toBe(0);
    expect(overBudgetShare(1500, 2000)).toBe(0);
    // More than twice the budget is still one full second lap.
    expect(overBudgetShare(5000, 2000)).toBe(1);
    expect(overBudgetShare(500, 0)).toBe(1);
    expect(overBudgetShare(0, 0)).toBe(0);
    expect(overBudgetShare(NaN, 2000)).toBe(0);
  });
});

describe('axis labels and ticks', () => {
  test('a week gets the letter of each day, with today marked', () => {
    // 24 November 2026 is a Tuesday.
    expect(periodAxis(nov(24), 7, TODAY)).toEqual({ mode: 'slots', labels: ['T', 'W', 'T', 'F', 'S', 'S', 'M'], todayIndex: 6 });
  });

  test('a month gets its first day, its middle and today', () => {
    expect(periodAxis(FROM_30, 30, TODAY)).toEqual({ mode: 'ends', labels: ['1 Nov', '15 Nov', 'Today'], todayIndex: null });
  });

  test('ninety days', () => {
    const from = addDays(TODAY, -89);
    expect(from).toBe('2026-09-02');
    expect(periodAxis(from, 90, TODAY).labels).toEqual(['2 Sep', '16 Oct', 'Today']);
  });

  test('a period that starts last year says so', () => {
    expect(periodAxis('2025-12-20', 30, '2026-01-18').labels).toEqual(['20 Dec 2025', '3 Jan', 'Today']);
  });

  test('no days, no labels', () => {
    expect(periodAxis(FROM_30, 0, TODAY).labels).toEqual([]);
  });

  test('the weekday axis is Monday first', () => {
    expect(WEEKDAY_AXIS.labels).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  });

  test('periodRangeText', () => {
    expect(periodRangeText(FROM_30, TODAY)).toBe('1 Nov to 30 Nov');
    expect(periodRangeText('2025-12-20', '2026-01-18')).toBe('20 Dec 2025 to 18 Jan');
  });

  test('dateSpanText says the month once when both ends share it', () => {
    expect(dateSpanText(nov(24), TODAY, TODAY)).toBe('24 to 30 Nov');
    expect(dateSpanText('2026-10-27', nov(2), TODAY)).toBe('27 Oct to 2 Nov');
    expect(dateSpanText('2025-12-29', '2026-01-04', '2026-01-18')).toBe('29 Dec 2025 to 4 Jan');
  });

  test('niceTicks picks the finest round step that fits', () => {
    expect(niceTicks(77, 79)).toEqual([77, 78, 79]);
    expect(niceTicks(77, 80)).toEqual([77, 78, 79, 80]);
    expect(niceTicks(76.5, 78.5)).toEqual([77, 78]);
    expect(niceTicks(70, 82)).toEqual([70, 75, 80]);
    expect(niceTicks(77, 78.5, 4)).toEqual([77, 77.5, 78, 78.5]);
  });

  test('niceTicks gives nothing rather than something wrong', () => {
    expect(niceTicks(80, 70)).toEqual([]);
    expect(niceTicks(77.1, 77.4)).toEqual([]);
    expect(niceTicks(NaN, 80)).toEqual([]);
    expect(niceTicks(70, 80, 0)).toEqual([]);
  });
});

describe('line chart', () => {
  const base = { xMax: 29, yMin: 77, yMax: 81, width: 300, height: 100, inset: 0 };

  test('places dots by day and value, and the direction line from end to end', () => {
    const layout = layoutLineChart({
      ...base,
      goal: 79,
      points: [
        { x: 0, y: 80 },
        { x: 29, y: 78 },
      ],
      line: { from: { x: 0, y: 80 }, to: { x: 29, y: 79 } },
    });
    expect(layout.dots).toEqual([
      { x: 0, y: 25 },
      { x: 300, y: 75 },
    ]);
    expect(layout.line).toEqual({ from: { x: 0, y: 25 }, to: { x: 300, y: 50 } });
    expect(layout.goalY).toBe(50);
    expect(layout.ticks).toEqual([
      { value: 78, y: 75 },
      { value: 80, y: 25 },
    ]);
  });

  test('the ring goes on the latest weigh-in, not on the end of the line', () => {
    const layout = layoutLineChart({
      ...base,
      goal: null,
      points: [
        { x: 0, y: 80 },
        { x: 29, y: 78 },
      ],
      line: { from: { x: 0, y: 80 }, to: { x: 29, y: 79 } },
    });
    // The scale read 78 that day; the line passes that day at 79.
    expect(layout.latest).toEqual({ x: 300, y: 75 });
    expect(layout.line?.to).toEqual({ x: 300, y: 50 });
  });

  test('the latest weigh-in is the one furthest along, whatever order the points come in', () => {
    const layout = layoutLineChart({
      ...base,
      goal: null,
      points: [
        { x: 29, y: 78 },
        { x: 0, y: 80 },
        { x: 10, y: 79 },
      ],
    });
    expect(layout.latest).toEqual({ x: 300, y: 75 });
  });

  test('without a line the dots stand alone: nothing joins them', () => {
    const points = [
      { x: 0, y: 80 },
      { x: 20, y: 79 },
    ];
    expect(layoutLineChart({ ...base, goal: null, points }).line).toBeNull();
    expect(layoutLineChart({ ...base, goal: null, points, line: null }).line).toBeNull();
    // A line with no length, or with an end that is not a number, is no line.
    expect(layoutLineChart({ ...base, goal: null, points, line: { from: { x: 5, y: 80 }, to: { x: 5, y: 79 } } }).line).toBeNull();
    expect(layoutLineChart({ ...base, goal: null, points, line: { from: { x: 0, y: NaN }, to: { x: 20, y: 79 } } }).line).toBeNull();
  });

  test('a day without a weigh-in leaves a gap: x follows the day, not the position in the list', () => {
    const layout = layoutLineChart({
      ...base,
      goal: null,
      points: [
        { x: 0, y: 80 },
        { x: 20, y: 79 },
      ],
    });
    expect(layout.dots[1].x).toBeCloseTo((20 / 29) * 300, 6);
    expect(layout.goalY).toBeNull();
  });

  test('the goal line is left out when the goal is outside the range', () => {
    const points = [{ x: 0, y: 80 }];
    expect(layoutLineChart({ ...base, goal: 70, points }).goalY).toBeNull();
    expect(layoutLineChart({ ...base, goal: 90, points }).goalY).toBeNull();
    expect(layoutLineChart({ ...base, goal: 77, points }).goalY).toBe(100);
  });

  test('one weigh-in is a ringed dot with no line', () => {
    const layout = layoutLineChart({ ...base, goal: null, points: [{ x: 29, y: 78 }] });
    expect(layout.dots).toHaveLength(1);
    expect(layout.line).toBeNull();
    expect(layout.latest).toEqual({ x: 300, y: 75 });
  });

  test('no weigh-ins, no ring', () => {
    expect(layoutLineChart({ ...base, goal: null, points: [] }).latest).toBeNull();
  });

  test('the inset keeps the marks off the edges', () => {
    const layout = layoutLineChart({
      xMax: 29,
      yMin: 77,
      yMax: 81,
      width: 300,
      height: 100,
      goal: null,
      points: [
        { x: 0, y: 77 },
        { x: 29, y: 81 },
      ],
    });
    expect(layout.dots).toEqual([
      { x: 6, y: 94 },
      { x: 294, y: 6 },
    ]);
  });

  test('a separate side inset lines a week of points up with the letters under it', () => {
    // Seven slots of 40: the first point belongs over the middle of the first slot.
    const layout = layoutLineChart({
      xMax: 6,
      yMin: 77,
      yMax: 81,
      width: 280,
      height: 100,
      goal: null,
      insetX: 20,
      points: [
        { x: 0, y: 79 },
        { x: 3, y: 79 },
        { x: 6, y: 79 },
      ],
    });
    expect(layout.dots.map((d) => d.x)).toEqual([20, 140, 260]);
  });

  test('dots get smaller as the days get closer together', () => {
    const points = [{ x: 0, y: 78 }];
    expect(layoutLineChart({ ...base, xMax: 6, goal: null, points }).dotRadius).toBe(3);
    expect(layoutLineChart({ ...base, xMax: 29, goal: null, points }).dotRadius).toBe(3);
    expect(layoutLineChart({ ...base, xMax: 60, goal: null, points }).dotRadius).toBe(2.5);
    expect(layoutLineChart({ ...base, xMax: 89, goal: null, points }).dotRadius).toBe(2);
  });

  test('bad input never becomes NaN or Infinity on screen', () => {
    const layout = layoutLineChart({
      xMax: 0,
      yMin: NaN,
      yMax: 80,
      width: 300,
      height: 100,
      goal: 78,
      points: [
        { x: 0, y: 78 },
        { x: NaN, y: 78 },
        { x: 3, y: Infinity },
      ],
      line: { from: { x: 0, y: 78 }, to: { x: Infinity, y: 78 } },
    });
    expect(layout.dots).toEqual([{ x: 150, y: 50 }]);
    expect(layout.line).toBeNull();
    expect(layout.ticks).toEqual([]);
    expect(layout.goalY).toBeNull();
    expect(numbersIn(layout).every(Number.isFinite)).toBe(true);
  });

  test('dotsPath draws a full circle around each point', () => {
    expect(dotsPath([{ x: 10, y: 20 }], 2)).toBe('M8 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z');
    expect(dotsPath([], 2)).toBe('');
  });
});

describe('where the charts start', () => {
  // 30 days ending 30 Nov start on 1 Nov; ninety start on 2 Sep.
  const period30 = { days: 30 as const, from: FROM_30, chartFrom: FROM_30 };
  const period90 = { days: 90 as const, from: '2026-09-02', chartFrom: FROM_30 };

  test('a chart that starts with the period takes nothing off', () => {
    expect(chartOffset(period30)).toBe(0);
    expect(chartRows([1, 2, 3], period30)).toEqual([1, 2, 3]);
  });

  test('a month of use in the 90-day view: the first 60 days are left off', () => {
    expect(chartOffset(period90)).toBe(60);
    const rows = Array.from({ length: 90 }, (_, i) => i);
    expect(chartRows(rows, period90)).toHaveLength(30);
    expect(chartRows(rows, period90)[0]).toBe(60);
  });

  test('a start that makes no sense takes nothing off, or leaves at least one day', () => {
    expect(chartOffset({ days: 30, from: FROM_30, chartFrom: '2026-10-01' })).toBe(0);
    expect(chartOffset({ days: 30, from: FROM_30, chartFrom: 'nonsense' })).toBe(0);
    expect(chartOffset({ days: 30, from: FROM_30, chartFrom: '2027-03-01' })).toBe(29);
  });

  test('weigh-ins and the direction line move to the chart’s own days', () => {
    const noRate = { ready: false as const, reason: 'Not yet.' };
    const w = {
      points: [
        { date: nov(1), dayIndex: 60, kg: 80 },
        { date: nov(30), dayIndex: 89, kg: 78 },
      ],
      line: { from: { date: nov(1), dayIndex: 60, kg: 80.1 }, to: { date: nov(30), dayIndex: 89, kg: 78.2 } },
      rate: noRate,
    };
    expect(weightChartMarks(w, period90)).toMatchObject({
      points: [
        { x: 0, y: 80 },
        { x: 29, y: 78 },
      ],
      line: { from: { x: 0, y: 80.1 }, to: { x: 29, y: 78.2 } },
    });
    expect(weightChartMarks({ ...w, line: null }, period30)).toEqual({
      points: [
        { x: 60, y: 80 },
        { x: 89, y: 78 },
      ],
      line: null,
      tentative: false,
    });
  });

  test('the line is held back only when the card names neither a direction nor a steady weight', () => {
    const falling: WeighIn[] = Array.from({ length: 30 }, (_, i) => ({ date: addDays(FROM_30, i), kg: 80 - (i * 2) / 29 }));
    const level: WeighIn[] = Array.from({ length: 30 }, (_, i) => ({ date: addDays(FROM_30, i), kg: 80 + (i % 2 ? 0.1 : -0.1) }));
    const zigzag: WeighIn[] = [1, 8, 15, 22, 29].map((d, i) => ({ date: nov(d), kg: 80 + (i % 2 ? 0.9 : -0.9) }));
    const marksOf = (weights: WeighIn[], days: 7 | 30 = 30) => {
      const insights = buildInsights(input({ days, weights }));
      return weightChartMarks(on(insights.weight), insights.period);
    };
    expect(marksOf(falling).tentative).toBe(false); // "Losing 0.5 kg a week"
    expect(marksOf(level).tentative).toBe(false); // "Holding steady"
    expect(marksOf(zigzag)).toMatchObject({ tentative: true }); // "No clear direction yet", and a line all the same
    expect(marksOf(zigzag).line).not.toBeNull();
    // No line in the 7-day view, so nothing to hold back.
    expect(marksOf(falling, 7)).toMatchObject({ line: null, tentative: false });
  });

  test('the real thing: a month of weigh-ins seen over 90 days fills the chart', () => {
    const weights: WeighIn[] = Array.from({ length: 30 }, (_, i) => ({ date: addDays(FROM_30, i), kg: 80 - (i * 2) / 29 }));
    const insights = buildInsights(input({ days: 90, weights }));
    expect(insights.period.chartFrom).toBe(FROM_30);
    expect(insights.period.chartDays).toBe(30);
    const marks = weightChartMarks(on(insights.weight), insights.period);
    expect(marks.points[0]).toEqual({ x: 0, y: 80 });
    expect(marks.points[29].x).toBe(29);
    // The fit runs from the first to the last weigh-in, so it spans the whole chart.
    expect(marks.line?.from.x).toBe(0);
    expect(marks.line?.to.x).toBe(29);
    expect(marks.line?.from.y).toBeCloseTo(80, 2);
    expect(marks.line?.to.y).toBeCloseTo(78, 2);
  });
});

describe('bar chart', () => {
  test('a week: thick bars, capped at 24dp, standing on the bottom edge', () => {
    const layout = layoutBars({
      bars: [{ value: 1000 }, { value: null }, { value: 2000 }, { value: 0 }, { value: null, hidden: true }, { value: 500 }, { value: 1500 }],
      max: 2000,
      goal: 1500,
      width: 280,
      height: 100,
    });
    expect(layout.slot).toBe(40);
    expect(layout.barWidth).toBe(24);
    expect(layout.radius).toBe(4);
    expect(layout.bars[0]).toEqual({ kind: 'bar', x: 8, y: 50, width: 24, height: 50, overHeight: 0 });
    // Nothing logged: a short stub, not a zero-height bar.
    expect(layout.bars[1]).toEqual({ kind: 'stub', x: 48, y: 97, width: 24, height: 3, overHeight: 0 });
    expect(layout.bars[2]).toEqual({ kind: 'bar', x: 88, y: 0, width: 24, height: 100, overHeight: 0 });
    // Logged but zero calories still shows as a bar you can see.
    expect(layout.bars[3]).toEqual({ kind: 'bar', x: 128, y: 98, width: 24, height: 2, overHeight: 0 });
    expect(layout.bars[4].kind).toBe('none');
    expect(layout.goalY).toBe(25);
  });

  test('a month keeps a 2dp gap between bars', () => {
    const layout = layoutBars({ bars: Array.from({ length: 30 }, () => ({ value: 1800 })), max: 2400, width: 300, height: 120 });
    expect(layout.slot).toBe(10);
    expect(layout.barWidth).toBe(8);
    expect(layout.bars[0].x).toBe(1);
    expect(layout.bars[0].height).toBe(90);
  });

  test('ninety bars stay apart and inside the chart', () => {
    // 297 / 90 = 3.3 a day: a 2dp bar, and what is left over goes into the gaps, 1 or 2dp each.
    const layout = layoutBars({ bars: Array.from({ length: 90 }, (_, i) => ({ value: 1000 + i * 10 })), max: 2400, width: 297, height: 120 });
    expect(layout.bars).toHaveLength(90);
    expect(layout.slot).toBeCloseTo(3.3, 6);
    expect(layout.barWidth).toBe(2);
    expect(layout.radius).toBe(1);
    layout.bars.forEach((b, i) => {
      expect(Number.isInteger(b.x)).toBe(true);
      expect(b.width).toBe(2);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(297);
      if (i > 0) {
        const gap = b.x - (layout.bars[i - 1].x + layout.bars[i - 1].width);
        expect(gap === 1 || gap === 2).toBe(true);
      }
    });
    // They still span the chart: the first and last bars sit within a slot of its edges.
    expect(layout.bars[0].x).toBeLessThan(3.3);
    expect(297 - (layout.bars[89].x + 2)).toBeLessThan(3.3);
  });

  test('on a dense screen every bar is the same whole number of pixels, starting on a pixel', () => {
    // The Pixel 8 draws 2.625 pixels to the dp. Its 90-day calorie chart is 307dp wide: 805 pixels,
    // 8.94 a day. Each bar is 6 pixels (2.41dp x 2.625 = 6.3, rounded), with 2 or 3 between them.
    const ratio = 2.625;
    const layout = layoutBars({ bars: Array.from({ length: 90 }, () => ({ value: 1800 })), max: 2400, width: 307, height: 120, pixelRatio: ratio });
    expect(layout.barWidth * ratio).toBeCloseTo(6, 9);
    const pixels = layout.bars.map((b) => b.x * ratio);
    pixels.forEach((x, i) => {
      expect(Math.abs(x - Math.round(x))).toBeLessThan(1e-9);
      if (i > 0) {
        const gap = Math.round(x - pixels[i - 1]) - 6;
        expect(gap === 2 || gap === 3).toBe(true);
      }
    });
    expect(pixels[0]).toBeGreaterThanOrEqual(0);
    expect(Math.round(pixels[89]) + 6).toBeLessThanOrEqual(805);
    expect(805 - (Math.round(pixels[89]) + 6)).toBeLessThan(9);
  });

  test('a pixel ratio that is not a number is treated as 1', () => {
    const bars = Array.from({ length: 30 }, () => ({ value: 1800 }));
    const plain = layoutBars({ bars, max: 2400, width: 300, height: 120 });
    expect(layoutBars({ bars, max: 2400, width: 300, height: 120, pixelRatio: NaN })).toEqual(plain);
    expect(layoutBars({ bars, max: 2400, width: 300, height: 120, pixelRatio: 0 })).toEqual(plain);
  });

  test('a bar over its limit says how far over: only the part above the limit is marked', () => {
    const layout = layoutBars({
      bars: [{ value: 2600, limit: 2000 }, { value: 1800, limit: 2000 }, { value: 2010, limit: 2000 }, { value: 500, limit: 0 }, { value: 2000, limit: 2000 }],
      max: 4000,
      width: 500,
      height: 100,
    });
    // 2,600 of 4,000 is 65 high; the first 2,000 is 50, so 15 is over.
    expect(layout.bars[0]).toMatchObject({ y: 35, height: 65, overHeight: 15 });
    expect(layout.bars[1].overHeight).toBe(0);
    // 10 kcal over would be a quarter of a dp. The mark is kept tall enough to see.
    expect(layout.bars[2].height).toBeCloseTo(50.25, 9);
    expect(layout.bars[2].overHeight).toBe(2);
    // With no budget at all, the whole bar is over.
    expect(layout.bars[3]).toMatchObject({ height: 12.5, overHeight: 12.5 });
    // Exactly on the limit is not over it.
    expect(layout.bars[4].overHeight).toBe(0);
  });

  test('a limit that is not a number marks nothing', () => {
    const layout = layoutBars({ bars: [{ value: 2600, limit: NaN }, { value: 2600, limit: null }, { value: 2600 }], max: 4000, width: 300, height: 100 });
    expect(layout.bars.map((b) => b.overHeight)).toEqual([0, 0, 0]);
  });

  test('the goal line is dropped when there is no goal or it is off the top', () => {
    const bars = [{ value: 1000 }];
    expect(layoutBars({ bars, max: 2000, goal: 2500, width: 100, height: 100 }).goalY).toBeNull();
    expect(layoutBars({ bars, max: 2000, goal: 0, width: 100, height: 100 }).goalY).toBeNull();
    expect(layoutBars({ bars, max: 2000, goal: null, width: 100, height: 100 }).goalY).toBeNull();
    expect(layoutBars({ bars, max: 2000, width: 100, height: 100 }).goalY).toBeNull();
  });

  test('a scale that is too small grows to fit the tallest bar', () => {
    const layout = layoutBars({ bars: [{ value: 3000 }, { value: 1500 }], max: 2000, width: 100, height: 100 });
    expect(layout.bars[0].height).toBe(100);
    expect(layout.bars[1].height).toBe(50);
  });

  test('without a scale the tallest bar fills the height', () => {
    const layout = layoutBars({ bars: [{ value: 30 }, { value: 60 }], width: 100, height: 64 });
    expect(layout.bars[1].height).toBe(64);
    expect(layout.bars[0].height).toBe(32);
  });

  test('nothing to draw, and nothing that is not a number', () => {
    expect(layoutBars({ bars: [], width: 300, height: 100 })).toEqual({ slot: 0, barWidth: 0, radius: 0, bars: [], goalY: null });
    expect(layoutBars({ bars: [], width: 300, height: 100, pixelRatio: 2.625 }).bars).toEqual([]);
    expect(layoutBars({ bars: [{ value: 5 }], width: 0, height: 100 }).bars).toEqual([]);
    const odd = layoutBars({ bars: [{ value: Infinity }, { value: NaN }, { value: 0 }], max: NaN, goal: NaN, width: 90, height: 60 });
    expect(odd.bars.map((b) => b.kind)).toEqual(['stub', 'stub', 'bar']);
    expect(numbersIn(odd).every(Number.isFinite)).toBe(true);
  });

  test('a bar has a rounded top and a square foot', () => {
    expect(topRoundedBar({ x: 0, y: 10, width: 10, height: 20 }, 4)).toBe('M0 30V14Q0 10 4 10H6Q10 10 10 14V30Z');
    // A bar shorter than its corner radius rounds only as far as it is tall.
    expect(topRoundedBar({ x: 0, y: 28, width: 10, height: 2 }, 4)).toBe('M0 30V30Q0 28 2 28H8Q10 28 10 30V30Z');
    expect(barsPath([], 4)).toBe('');
  });

  test('splitBarsPath: the part within the limit ends flat, the part over it keeps the rounded top', () => {
    const within = { x: 0, y: 10, width: 10, height: 20, overHeight: 0 };
    expect(splitBarsPath([within], 4)).toEqual({ within: 'M0 30V14Q0 10 4 10H6Q10 10 10 14V30Z', over: '' });
    // 8 of its 20 are over: the over part runs from 10 to 18, the rest from 18 to the baseline at 30.
    expect(splitBarsPath([{ ...within, overHeight: 8 }], 4)).toEqual({
      within: 'M0 30V18Q0 18 0 18H10Q10 18 10 18V30Z',
      over: 'M0 18V14Q0 10 4 10H6Q10 10 10 14V18Z',
    });
    // Over from the ground up: nothing is within.
    expect(splitBarsPath([{ ...within, overHeight: 20 }], 4)).toEqual({ within: '', over: 'M0 30V14Q0 10 4 10H6Q10 10 10 14V30Z' });
    expect(splitBarsPath([{ ...within, overHeight: 99 }], 4).within).toBe('');
    expect(splitBarsPath([{ ...within, overHeight: NaN }], 4).over).toBe('');
    expect(splitBarsPath([], 4)).toEqual({ within: '', over: '' });
  });

  test('calorie bars: over budget, counted, not in the average, missed, and before the first log', () => {
    const insights = buildInsights(
      input({
        dayTotals: [food(nov(26), 1800), food(nov(27), 2600), food(nov(28), 300), food(nov(30), 300)],
        loggedDates: [nov(26), nov(27), nov(28), nov(30)],
      }),
    );
    const bars = calorieChartBars(on(insights.calories).bars);
    expect(bars).toHaveLength(30);
    expect(bars[0]).toEqual({ value: null, tone: 'data', hidden: true }); // 1 Nov, before anything was logged
    expect(bars[25]).toEqual({ value: 1800, tone: 'data' });
    // Over budget: still a counted day, with the budget as the limit the chart marks it above.
    expect(bars[26]).toEqual({ value: 2600, tone: 'data', limit: 2000 });
    expect(bars[27]).toEqual({ value: 300, tone: 'faded' });
    expect(bars[28]).toEqual({ value: null, tone: 'data', hidden: false }); // 29 Nov, missed
    expect(bars[29]).toEqual({ value: 300, tone: 'faded' }); // today, not complete yet
  });

  test('calorie bars: the limit is the day’s own budget, workout included, and today over budget stays out of the average', () => {
    const insights = buildInsights(
      input({
        dayTotals: [food(nov(27), 2600), food(nov(28), 2200), food(nov(30), 2400)],
        loggedDates: [nov(27), nov(28), nov(30)],
        exercises: [
          { date: nov(27), activity: 'run', minutes: 30, calories: 300 },
          { date: nov(28), activity: 'run', minutes: 30, calories: 300 },
        ],
        firstExerciseDate: nov(27),
      }),
    );
    const bars = calorieChartBars(on(insights.calories).bars);
    expect(bars[26]).toEqual({ value: 2600, tone: 'data', limit: 2300 });
    // Past the 2,000 goal but inside that day's 2,300 budget: no limit, nothing marked.
    expect(bars[27]).toEqual({ value: 2200, tone: 'data' });
    expect(bars[29]).toEqual({ value: 2400, tone: 'faded', limit: 2000 });
  });

  test('exercise bars: a rest day draws nothing', () => {
    expect(
      exerciseChartBars([
        { date: nov(1), dayIndex: 0, minutes: 45, calories: 130, workouts: 1 },
        { date: nov(2), dayIndex: 1, minutes: 0, calories: 0, workouts: 0 },
      ]),
    ).toEqual([
      { value: 45, tone: 'exercise' },
      { value: null, tone: 'exercise', hidden: true },
    ]);
  });

  test('weekday bars pick out the day that stands out, and stub a weekday with too few full days', () => {
    // One heavy Saturday must not stand a third taller than the Friday the card names.
    const byWeekday: PatternsInfo['byWeekday'] = [
      { weekday: 0, label: 'Monday', average: 1800, days: WEEKDAY_MIN_DAYS },
      { weekday: 1, label: 'Tuesday', average: null, days: 0 },
      { weekday: 4, label: 'Friday', average: 2250, days: WEEKDAY_MIN_DAYS },
      { weekday: 5, label: 'Saturday', average: 3100, days: 1 },
      { weekday: 6, label: 'Sunday', average: 2900, days: WEEKDAY_MIN_DAYS - 1 },
    ];
    expect(weekdayChartBars(byWeekday, 4)).toEqual([
      { value: 1800, tone: 'faded' },
      { value: null, tone: 'faded' },
      { value: 2250, tone: 'data' },
      { value: null, tone: 'faded' },
      { value: null, tone: 'faded' },
    ]);
  });

  test('weekday bars all look the same when no day stands out', () => {
    const byWeekday: PatternsInfo['byWeekday'] = [
      { weekday: 0, label: 'Monday', average: 1800, days: 4 },
      { weekday: 5, label: 'Saturday', average: 1900, days: 4 },
    ];
    expect(weekdayChartBars(byWeekday, null)).toEqual([
      { value: 1800, tone: 'data' },
      { value: 1900, tone: 'data' },
    ]);
  });
});

describe('calendar', () => {
  test('a month that starts on a Sunday: six blanks, then full Monday-first weeks', () => {
    const calendar = on(buildInsights(input({ dayTotals: [food(nov(1), 1800)], loggedDates: [nov(1)] })).consistency);
    expect(calendar.leadingBlanks).toBe(6);
    const weeks = calendarWeeks(calendar.calendar, calendar.leadingBlanks);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0].map((d) => d?.dayOfMonth ?? null)).toEqual([null, null, null, null, null, null, 1]);
    expect(weeks[1].map((d) => d?.dayOfMonth ?? null)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    // 30 November is a Monday: alone on the last row, with the rest of the week outside the period.
    expect(weeks[5].map((d) => d?.dayOfMonth ?? null)).toEqual([30, null, null, null, null, null, null]);
    expect(calendarMonthLabels(weeks)).toEqual(['Nov', null, null, null, null, null]);
  });

  test('a week that starts on a Tuesday spills onto a second row', () => {
    const calendar = on(buildInsights(input({ days: 7, dayTotals: [food(nov(24), 1800)], loggedDates: [nov(24)] })).consistency);
    const weeks = calendarWeeks(calendar.calendar, calendar.leadingBlanks);
    expect(weeks.map((w) => w.map((d) => d?.dayOfMonth ?? null))).toEqual([
      [null, 24, 25, 26, 27, 28, 29],
      [30, null, null, null, null, null, null],
    ]);
  });

  test('ninety days: a month name beside the first week and each week that opens a new month', () => {
    const calendar = on(buildInsights(input({ days: 90, dayTotals: [food(TODAY, 1800)], loggedDates: [TODAY] })).consistency);
    const weeks = calendarWeeks(calendar.calendar, calendar.leadingBlanks);
    expect(weeks).toHaveLength(14);
    const labels = calendarMonthLabels(weeks);
    expect(labels.map((label, row) => (label ? `${row}:${label}` : null)).filter(Boolean)).toEqual(['0:Sep', '5:Oct', '9:Nov']);
  });

  test('blanks are clamped to a week, and no days means no rows', () => {
    expect(calendarWeeks([1, 2, 3], 9)).toEqual([
      [null, null, null, null, null, null, 1],
      [2, 3, null, null, null, null, null],
    ]);
    expect(calendarWeeks([1], -4)).toEqual([[1, null, null, null, null, null, null]]);
    expect(calendarWeeks([1], NaN)).toEqual([[1, null, null, null, null, null, null]]);
    expect(calendarWeeks([], 3)).toEqual([]);
    expect(calendarMonthLabels([[null, null, null, null, null, null, null]])).toEqual([null]);
  });

  test('cells sit in seven columns to the right of the month gutter', () => {
    const weeks = calendarWeeks(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], 0);
    const layout = layoutCalendar(weeks, { width: 320, gutter: 30, gap: 4, cellHeight: 28 });
    expect(layout.cellWidth).toBe(38);
    expect(layout.height).toBe(60);
    expect(layout.rowTops).toEqual([0, 32]);
    expect(layout.cells).toHaveLength(10);
    expect(layout.cells[0]).toEqual({ day: 'a', row: 0, col: 0, x: 30, y: 0, width: 38, height: 28 });
    expect(layout.cells[9]).toEqual({ day: 'j', row: 1, col: 2, x: 114, y: 32, width: 38, height: 28 });
    // The last column ends exactly at the right edge.
    expect(layout.cells[6].x + layout.cells[6].width).toBe(320);
  });

  test('a calendar narrower than its gutter has no negative cells', () => {
    const layout = layoutCalendar(calendarWeeks(['a'], 0), { width: 20, gutter: 30, gap: 4, cellHeight: 16 });
    expect(layout.cellWidth).toBe(0);
    expect(numbersIn(layout).every((n) => Number.isFinite(n) && n >= 0)).toBe(true);
  });

  test('calendarHeight', () => {
    expect(calendarHeight(6, 28, 4)).toBe(188);
    expect(calendarHeight(14, 16, 4)).toBe(276);
    expect(calendarHeight(0, 28, 4)).toBe(0);
  });

  test('roundedRect', () => {
    expect(roundedRect({ x: 0, y: 0, width: 10, height: 10 }, 2)).toBe('M2 0H8A2 2 0 0 1 10 2V8A2 2 0 0 1 8 10H2A2 2 0 0 1 0 8V2A2 2 0 0 1 2 0Z');
    expect(roundedRect({ x: 0, y: 0, width: 10, height: 10 }, 2, 1)).toBe('M3 1H7A2 2 0 0 1 9 3V7A2 2 0 0 1 7 9H3A2 2 0 0 1 1 7V3A2 2 0 0 1 3 1Z');
    // The radius never exceeds half the shorter side.
    expect(roundedRect({ x: 0, y: 0, width: 20, height: 8 }, 8)).toBe('M4 0H16A4 4 0 0 1 20 4V4A4 4 0 0 1 16 8H4A4 4 0 0 1 0 4V4A4 4 0 0 1 4 0Z');
  });

  test('calendarMarkSize: as large as the cell allows, up to the cap', () => {
    // A month on a Pixel 8: cells about 40dp wide on a 36dp row.
    expect(calendarMarkSize(39.6, 36)).toBe(36);
    // Ninety days: 16dp rows.
    expect(calendarMarkSize(39.6, 16)).toBe(16);
    expect(calendarMarkSize(12, 36)).toBe(12);
    expect(calendarMarkSize(39.6, 36, 32)).toBe(32);
    expect(calendarMarkSize(0, 36)).toBe(0);
    expect(calendarMarkSize(NaN, 36)).toBe(0);
  });

  test('cappedCirclesPath: the cap is the top of the circle, the body the rest, and they meet on one line', () => {
    // Radius 10 at (10, 10), a cap 30% of the height: the line is 6 down, 4 above the centre,
    // and half as wide as the square root of 100 - 16 = 9.165.
    const { body, cap } = cappedCirclesPath([{ x: 10, y: 10 }], 10, 0.3);
    expect(cap).toBe('M0.835 6A10 10 0 0 1 19.165 6Z');
    expect(body).toBe('M19.165 6A10 10 0 1 1 0.835 6Z');
  });

  test('cappedCirclesPath: every circle is in both paths', () => {
    const { body, cap } = cappedCirclesPath(
      [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
      ],
      10,
      0.5,
    );
    // Cut through the middle: the line is the diameter.
    expect(cap).toBe('M0 10A10 10 0 0 1 20 10ZM40 10A10 10 0 0 1 60 10Z');
    expect(body).toBe('M20 10A10 10 0 1 1 0 10ZM60 10A10 10 0 1 1 40 10Z');
  });

  test('cappedCirclesPath: a cap past the middle takes the long way round, and the ends are whole circles', () => {
    const tall = cappedCirclesPath([{ x: 10, y: 10 }], 10, 0.7);
    expect(tall.cap).toBe('M0.835 14A10 10 0 1 1 19.165 14Z');
    expect(tall.body).toBe('M19.165 14A10 10 0 0 1 0.835 14Z');
    const circle = dotsPath([{ x: 10, y: 10 }], 10);
    expect(cappedCirclesPath([{ x: 10, y: 10 }], 10, 0)).toEqual({ body: circle, cap: '' });
    expect(cappedCirclesPath([{ x: 10, y: 10 }], 10, 1)).toEqual({ body: '', cap: circle });
    expect(cappedCirclesPath([{ x: 10, y: 10 }], 10, NaN)).toEqual({ body: circle, cap: '' });
    expect(cappedCirclesPath([{ x: 10, y: 10 }], 0, 0.3)).toEqual({ body: '', cap: '' });
    expect(cappedCirclesPath([], 10, 0.3)).toEqual({ body: '', cap: '' });
  });
});

describe('what each chart says', () => {
  // A month of daily weigh-ins, falling steadily from 80.0 to 78.0 kg.
  const weights: WeighIn[] = Array.from({ length: 30 }, (_, i) => ({ date: addDays(FROM_30, i), kg: 80 - (i * 2) / 29 }));
  // Eleven days of food ending today, one of them over budget.
  const eleven = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map((d) => food(nov(d), d === 25 ? 2600 : 1800));
  const loggedDates = eleven.map((d) => d.date);

  test('the weight chart, with its direction line and the target on it', () => {
    const w = on(buildInsights(input({ weights, weightGoalKg: 75, goalStartWeightKg: 80, goalStartDate: FROM_30 })).weight);
    expect(w.chart.goalOffChart).toBeNull();
    expect(describeWeightChart(w, TODAY)).toBe(
      'Weight chart. 30 weigh-ins from 1 Nov to 30 Nov. First 80.0 kg, latest 78.0 kg. ' +
        'The direction line runs from 80.0 kg to 78.0 kg. Losing 0.5 kg a week. Down 2.0 kg in 30 days. ' +
        'The dashed line is your 75.0 kg target.',
    );
  });

  test('the weight chart names no direction when the rate is not clear, though the line is drawn', () => {
    // Five weekly weigh-ins swinging 0.9 kg either side of 80: a fit exists, and says nothing.
    const zigzag: WeighIn[] = [1, 8, 15, 22, 29].map((d, i) => ({ date: nov(d), kg: 80 + (i % 2 ? 0.9 : -0.9) }));
    const w = on(buildInsights(input({ weights: zigzag })).weight);
    expect(w.line).not.toBeNull();
    expect(on(w.rate).clear).toBe(false);
    expect(on(w.rate).steady).toBe(false);
    const spoken = describeWeightChart(w, TODAY);
    expect(spoken).toBe(
      'Weight chart. 5 weigh-ins from 1 Nov to 29 Nov. First 79.1 kg, latest 79.1 kg. A straight line is drawn through the weigh-ins. ' +
        'No clear direction yet. Your weigh-ins vary from day to day by more than the change so far.',
    );
    expect(spoken).not.toMatch(/runs from|Losing|Gaining|Down|Up /);
  });

  test('the weight chart for a steady weight says so', () => {
    const level: WeighIn[] = Array.from({ length: 30 }, (_, i) => ({ date: addDays(FROM_30, i), kg: 80 + (i % 2 ? 0.1 : -0.1) }));
    const w = on(buildInsights(input({ weights: level })).weight);
    expect(describeWeightChart(w, TODAY)).toContain('The direction line runs from 80.0 kg to 80.0 kg. Holding steady. Steady over 30 days.');
  });

  test('the weight chart in the 7-day view has no line to describe', () => {
    const w = on(buildInsights(input({ days: 7, weights })).weight);
    expect(w.line).toBeNull();
    expect(describeWeightChart(w, TODAY)).toBe('Weight chart. 7 weigh-ins from 24 Nov to 30 Nov. First 78.4 kg, latest 78.0 kg.');
  });

  test('the weight chart says when the target is off the chart', () => {
    const w = on(buildInsights(input({ weights, weightGoalKg: 60, goalStartWeightKg: 80, goalStartDate: FROM_30 })).weight);
    expect(w.chart.goalOffChart).toBe('below');
    expect(describeWeightChart(w, TODAY)).toContain('Your 60.0 kg target is below the chart.');
  });

  test('the weight chart with one weigh-in and no target', () => {
    const w = on(buildInsights(input({ weights: [{ date: TODAY, kg: 78.4 }] })).weight);
    expect(describeWeightChart(w, TODAY)).toBe('Weight chart. One weigh-in, 78.4 kg on 30 Nov.');
  });

  test('the calorie chart, with how far the one day over budget went', () => {
    const c = on(buildInsights(input({ dayTotals: eleven, loggedDates })).calories);
    expect(describeCalorieChart(c, TODAY)).toBe(
      // Today is never a full day, so the eleven days hold ten full ones: (9 x 1,800 + 2,600) / 10 = 1,880.
      'Calories by day. 11 of 11 days logged. Average 1,880 calories a day on 10 full days, against a goal of 2,000. ' +
        '9 full days within budget, 1 day over: 2,600 against a budget of 2,000 on 25 Nov. Highest day 2,600 on 25 Nov.',
    );
  });

  test('the calorie chart with two days over names the one that went furthest past its own budget', () => {
    // 25 Nov: 2,600 against 2,000, 600 over. 27 Nov: 2,700 against 2,300 with a workout, 400 over.
    // The 27th is the highest day, but the 25th went furthest over.
    const days = eleven.map((d) => (d.date === nov(27) ? food(nov(27), 2700) : d));
    const c = on(
      buildInsights(
        input({ dayTotals: days, loggedDates, exercises: [{ date: nov(27), activity: 'run', minutes: 30, calories: 300 }], firstExerciseDate: nov(27) }),
      ).calories,
    );
    expect(describeCalorieChart(c, TODAY)).toBe(
      // (8 x 1,800 + 2,600 + 2,700) / 10 = 1,970.
      'Calories by day. 11 of 11 days logged. Average 1,970 calories a day on 10 full days, against a goal of 2,000. ' +
        '8 full days within budget, 2 days over, the furthest 2,600 against a budget of 2,000 on 25 Nov. Highest day 2,700 on 27 Nov.',
    );
  });

  test('the calorie chart before any day is full enough for an average', () => {
    const c = on(buildInsights(input({ dayTotals: [food(TODAY, 300)], loggedDates: [TODAY] })).calories);
    expect(describeCalorieChart(c, TODAY)).toBe('Calories by day. 1 of 1 day logged. Goal 2,000 calories. 0 full days within budget, 0 days over.');
  });

  test('the calendar speaks the card’s own sentence, which adds up, and counts a missed day', () => {
    const withGap = eleven.filter((d) => d.date !== nov(22));
    const c = on(buildInsights(input({ dayTotals: withGap, loggedDates: withGap.map((d) => d.date) })).consistency);
    // Ten logged: eight full days within budget, the 25th over, and today, which is still open.
    expect(c.withinDays + c.overDays + c.partialDays + (c.todayOpen ? 1 : 0)).toBe(c.loggedDays);
    expect(describeCalendar(c)).toBe(
      'Calendar of the last 30 days. Logged 10 of 11 days: 8 full days within budget, 1 over. Today is still open. 1 day not logged.',
    );
  });

  test('the calendar counts a day with too little on it apart from the full days', () => {
    const thin = eleven.map((d) => (d.date === nov(22) ? food(nov(22), 300) : d));
    const c = on(buildInsights(input({ dayTotals: thin, loggedDates })).consistency);
    expect(describeCalendar(c)).toBe(
      'Calendar of the last 30 days. Logged 11 of 11 days: 8 full days within budget, 1 over, 1 with too little logged. Today is still open. 0 days not logged.',
    );
  });

  test('the exercise chart', () => {
    const e = on(
      buildInsights(
        input({
          exercises: [
            { date: nov(20), activity: 'walk', minutes: 45, calories: 131 },
            { date: nov(27), activity: 'run', minutes: 30, calories: 300 },
          ],
          firstExerciseDate: nov(20),
        }),
      ).exercise,
    );
    expect(describeExerciseChart(e, TODAY)).toBe('Exercise by day. 2 workouts on 2 days, 1 h 15 min in total. Longest day 45 min on 20 Nov.');
  });

  test('the day-of-the-week chart gives no figure for a weekday it would not draw', () => {
    // Monday 23 to Friday 27 November: one full day of each, which is too few for a bar.
    const week = [23, 24, 25, 26, 27].map((d) => food(nov(d), d === 25 ? 2600 : 1800));
    const p = on(buildInsights(input({ dayTotals: week, loggedDates: week.map((d) => d.date) })).patterns);
    expect(describeWeekdayChart(p.byWeekday)).toBe(
      'Average calories by day of the week. Monday too few days, Tuesday too few days, Wednesday too few days, Thursday too few days, ' +
        'Friday too few days, Saturday no full days, Sunday no full days.',
    );
  });

  test('the day-of-the-week chart with a month behind it', () => {
    // 1 to 29 November, 2,500 on the five Sundays and 1,800 on every other day.
    const month = Array.from({ length: 29 }, (_, i) => food(addDays(FROM_30, i), i % 7 === 0 ? 2500 : 1800));
    const p = on(buildInsights(input({ dayTotals: month, loggedDates: month.map((d) => d.date) })).patterns);
    expect(describeWeekdayChart(p.byWeekday)).toBe(
      'Average calories by day of the week. Monday 1,800, Tuesday 1,800, Wednesday 1,800, Thursday 1,800, Friday 1,800, Saturday 1,800, Sunday 2,500.',
    );
    // And the picture agrees with the words: Sunday is the one bar picked out.
    const highest = on(p.highestDay);
    expect(highest.standsOut).toBe(true);
    expect(weekdayChartBars(p.byWeekday, highest.weekday).map((b) => b.tone)).toEqual(['faded', 'faded', 'faded', 'faded', 'faded', 'faded', 'data']);
  });
});

describe('sentences beside the figures', () => {
  test('averageVsGoalText', () => {
    expect(averageVsGoalText(-130, 2000)).toBe('130 under your 2,000 kcal goal');
    expect(averageVsGoalText(212.4, 2000)).toBe('212 over your 2,000 kcal goal');
    expect(averageVsGoalText(0, 2000)).toBe('Right on your 2,000 kcal goal');
    expect(averageVsGoalText(NaN, 2000)).toBe('Right on your 2,000 kcal goal');
  });

  test('maintenanceBasisText quotes the rate only when it is clear enough to state', () => {
    const clear = { rateClear: true, rateSteady: false };
    expect(maintenanceBasisText({ averageIntake: 1870, kgPerWeek: -0.48, ...clear })).toBe('Worked out from eating 1,870 kcal a day while you lost 0.5 kg a week.');
    expect(maintenanceBasisText({ averageIntake: 2600, kgPerWeek: 0.3, ...clear })).toBe('Worked out from eating 2,600 kcal a day while you gained 0.3 kg a week.');
  });

  test('maintenanceBasisText says steady when the Weight card says steady, whatever the slope', () => {
    const steady = { rateClear: false, rateSteady: true };
    expect(maintenanceBasisText({ averageIntake: 2200, kgPerWeek: 0.02, ...steady })).toBe('Worked out from eating 2,200 kcal a day while your weight held steady.');
    // The slope is -0.2, but the card above reads "Holding steady": the two must not disagree.
    expect(maintenanceBasisText({ averageIntake: 2200, kgPerWeek: -0.2, ...steady })).toBe('Worked out from eating 2,200 kcal a day while your weight held steady.');
  });

  test('maintenanceBasisText names no rate when there is no clear one', () => {
    const neither = { rateClear: false, rateSteady: false };
    const plain = 'Worked out from eating 2,200 kcal a day and how your weigh-ins moved over the same days.';
    expect(maintenanceBasisText({ averageIntake: 2200, kgPerWeek: -0.2, ...neither })).toBe(plain);
    expect(maintenanceBasisText({ averageIntake: 2200, kgPerWeek: NaN, rateClear: true, rateSteady: false })).toBe(plain);
  });

  test('latestWeighInText adds the plain change when two weigh-ins are all there is', () => {
    const w = on(
      buildInsights(
        input({
          weights: [
            { date: nov(2), kg: 84 },
            { date: nov(27), kg: 84.6 },
          ],
        }),
      ).weight,
    );
    expect(w.rate.ready).toBe(false);
    expect(latestWeighInText(w, TODAY)).toBe('Your latest weigh-in, 27 Nov. Up 0.6 kg since 2 Nov (84.0 kg).');
  });

  test('latestWeighInText: no change is said as no change, and one weigh-in has nothing to compare', () => {
    const same = on(
      buildInsights(
        input({
          weights: [
            { date: nov(2), kg: 84 },
            { date: TODAY, kg: 84 },
          ],
        }),
      ).weight,
    );
    expect(latestWeighInText(same, TODAY)).toBe('Your latest weigh-in, today. No change since 2 Nov (84.0 kg).');
    const one = on(buildInsights(input({ weights: [{ date: TODAY, kg: 78.4 }] })).weight);
    expect(latestWeighInText(one, TODAY)).toBe('Your latest weigh-in, today.');
  });

  test('latestWeighInText leaves the change out when a week is simply too short', () => {
    // A month of daily weigh-ins seen over 7 days: first against last inside one week is noise.
    const weights: WeighIn[] = Array.from({ length: 30 }, (_, i) => ({ date: addDays(FROM_30, i), kg: 80 - (i * 2) / 29 }));
    const w = on(buildInsights(input({ days: 7, weights })).weight);
    expect(w.rate).toMatchObject({ ready: false, action: 'longer-period' });
    expect(w.rawChangeKg).not.toBeNull();
    expect(latestWeighInText(w, TODAY)).toBe('Your latest weigh-in, today.');
  });

  test('latestWeighInText leaves the change out in a short week even without two weeks to compare', () => {
    // Weekly weigh-ins and one extra: the last 30 days give a rate, so the 7-day view sends the owner
    // there. This week has two weigh-ins and the week before only one, so there are no weekly averages.
    const weights: WeighIn[] = [1, 8, 15, 22, 26, 29].map((d, i) => ({ date: nov(d), kg: 80 - i * 0.4 }));
    const w = on(buildInsights(input({ days: 7, weights })).weight);
    expect(w.rate).toMatchObject({ ready: false, action: 'longer-period' });
    expect(w.weekAverages).toBeNull();
    expect(w.rawChangeKg).toBe(-0.4);
    expect(latestWeighInText(w, TODAY)).toBe('Your latest weigh-in, 29 Nov.');
  });

  test('latestWeighInText in a first week still gives the change between the two weigh-ins', () => {
    const w = on(
      buildInsights(
        input({
          days: 7,
          weights: [
            { date: nov(26), kg: 84 },
            { date: nov(29), kg: 84.5 },
          ],
        }),
      ).weight,
    );
    expect(w.rate).toMatchObject({ ready: false, action: 'log-weight' });
    expect(latestWeighInText(w, TODAY)).toBe('Your latest weigh-in, 29 Nov. Up 0.5 kg since 26 Nov (84.0 kg).');
  });

  test('recalcSummary lists the new targets and the change in calories', () => {
    const targets = { calories: 1930, protein: 124, carbs: 215, fat: 54 };
    expect(recalcSummary({ targets, calorieChange: -70 })).toBe(
      'New targets: 1,930 kcal, 124 g protein, 215 g carbs and 54 g fat. That is 70 kcal less a day than now.',
    );
    expect(recalcSummary({ targets, calorieChange: 120 })).toContain('That is 120 kcal more a day than now.');
    expect(recalcSummary({ targets, calorieChange: 0 })).toContain('The same calories as now.');
  });

  test('splitAnswer cuts a sentence into its answer and the rest, and keeps every word', () => {
    expect(splitAnswer('Logged 14 of 30 days: 8 full days within budget, 1 over, 4 with too little logged. Today is still open.')).toEqual({
      lead: 'Logged 14 of 30 days',
      rest: '8 full days within budget, 1 over, 4 with too little logged. Today is still open.',
    });
    // No colon: the first sentence is the answer.
    expect(splitAnswer('Logged 1 of 1 day. Today is still open.')).toEqual({ lead: 'Logged 1 of 1 day', rest: 'Today is still open.' });
    expect(splitAnswer('Logged 0 of 12 days.')).toEqual({ lead: 'Logged 0 of 12 days', rest: null });
    // A decimal point is not the end of a sentence.
    expect(splitAnswer('Down 1.8 kg in 30 days.')).toEqual({ lead: 'Down 1.8 kg in 30 days', rest: null });
    expect(splitAnswer('')).toEqual({ lead: '', rest: null });
  });

  test('splitAnswer on the sentence the data layer builds', () => {
    const month = Array.from({ length: 29 }, (_, i) => food(addDays(FROM_30, i), i % 7 === 0 ? 2500 : 1800));
    const text = on(buildInsights(input({ dayTotals: month, loggedDates: month.map((d) => d.date) })).consistency).text;
    const { lead, rest } = splitAnswer(text);
    expect(lead).toBe('Logged 29 of 29 days');
    expect(`${lead}: ${rest}`).toBe(text);
  });

  test('biggestMealText', () => {
    const meals: PatternsInfo['meals'] = [
      { meal: 'breakfast', label: 'Breakfast', average: 400, share: 0.2 },
      { meal: 'lunch', label: 'Lunch', average: 600, share: 0.3 },
      { meal: 'dinner', label: 'Dinner', average: 820, share: 0.41 },
      { meal: 'snack', label: 'Snacks', average: 180, share: 0.09 },
    ];
    expect(biggestMealText(meals)).toBe('The most calories come from dinner, 41% of the total.');
    expect(biggestMealText(meals.map((m) => ({ ...m, share: m.meal === 'snack' ? 0.6 : 0.1 })))).toBe('The most calories come from snacks, 60% of the total.');
    expect(biggestMealText(meals.map((m) => ({ ...m, share: 0 })))).toBeNull();
    expect(biggestMealText([])).toBeNull();
  });
});

describe('week by week', () => {
  const block: WeekBlock = {
    from: nov(24),
    to: nov(30),
    daysInUse: 7,
    completeDays: 6,
    averageKcal: 1917,
    weighIns: 3,
    averageKg: 78.2,
    singleKg: null,
    workouts: 3,
    minutes: 125,
  };

  test('a week with everything in it', () => {
    expect(weekRowText(block, TODAY)).toEqual({
      title: '24 to 30 Nov',
      kcal: '1,917 kcal',
      kcalBasis: '6 full days',
      weight: '78.2 kg average, 3 weigh-ins',
      exercise: '3 workouts, 2 h 5 min',
      note: null,
      spoken: '24 to 30 Nov. Average 1,917 calories a day on 6 full days. 78.2 kg average, 3 weigh-ins. 3 workouts, 2 h 5 min.',
    });
  });

  test('a thin first week: a dash for the average, the one weigh-in shown as one, and how many days it covers', () => {
    const thin: WeekBlock = { ...block, from: '2026-10-27', to: nov(2), daysInUse: 4, completeDays: 2, averageKcal: null, weighIns: 1, averageKg: null, singleKg: 80.6, workouts: 0, minutes: 0 };
    expect(weekRowText(thin, TODAY)).toEqual({
      title: '27 Oct to 2 Nov',
      kcal: '–',
      kcalBasis: 'too few full days',
      weight: '80.6 kg, one weigh-in',
      exercise: 'No workouts',
      note: 'Covers 4 days: your first log was part-way through.',
      spoken: '27 Oct to 2 Nov. Too few full days for an average. 80.6 kg, one weigh-in. No workouts. Covers 4 days: your first log was part-way through.',
    });
  });

  test('a week with no weigh-in says so, and one workout is singular', () => {
    const text = weekRowText({ ...block, weighIns: 0, averageKg: null, singleKg: null, workouts: 1, minutes: 45 }, TODAY);
    expect(text.weight).toBe('No weigh-ins');
    expect(text.exercise).toBe('1 workout, 45 min');
  });

  test('the rows the data layer builds for a month', () => {
    // 1 to 29 November logged at 1,800, with 2,500 on Sundays; weighed every day, 80.0 down to 78.0.
    const month = Array.from({ length: 29 }, (_, i) => food(addDays(FROM_30, i), i % 7 === 0 ? 2500 : 1800));
    const weights: WeighIn[] = Array.from({ length: 30 }, (_, i) => ({ date: addDays(FROM_30, i), kg: 80 - (i * 2) / 29 }));
    const weeks = buildInsights(input({ dayTotals: month, loggedDates: month.map((d) => d.date), weights })).weeks;
    expect(weeks.map((b) => weekRowText(b, TODAY).title)).toEqual(['24 to 30 Nov', '17 to 23 Nov', '10 to 16 Nov', '3 to 9 Nov']);
    // The newest week holds today, which is never a full day: six days, (5 x 1,800 + 2,500) / 6 = 1,917.
    expect(weekRowText(weeks[0], TODAY)).toMatchObject({ kcal: '1,917 kcal', kcalBasis: '6 full days', exercise: 'No workouts', note: null });
    expect(weekRowText(weeks[1], TODAY)).toMatchObject({ kcal: '1,900 kcal', kcalBasis: '7 full days' });
  });
});

describe('the glance tiles', () => {
  test('an app with nothing in it: every tile says what to log, and logs it', () => {
    const text = glanceText(buildInsights(input()));
    expect(text.weight).toEqual({
      title: 'Log your weight',
      detail: 'To see where it is heading',
      waiting: true,
      action: 'log-weight',
      spoken: 'Weight. Log your weight. To see where it is heading.',
    });
    expect(text.calories).toMatchObject({ title: 'Log your meals', waiting: true, action: 'log-food' });
    expect(text.exercise).toMatchObject({ title: 'Log a workout', waiting: true, action: 'log-exercise' });
    expect(text.streak).toMatchObject({ title: 'Start a streak', detail: 'Log a meal today', waiting: true, action: 'log-food' });
  });

  test('a first day: what is there is shown, with no rate and no average claimed', () => {
    const text = glanceText(buildInsights(input({ dayTotals: [food(TODAY, 900)], loggedDates: [TODAY], weights: [{ date: TODAY, kg: 80 }] })));
    expect(text.weight).toMatchObject({ title: '80.0 kg', detail: 'Weighed today', waiting: false, action: null });
    expect(text.calories).toMatchObject({ title: '1 day logged', detail: 'No average yet', waiting: false, action: null });
    expect(text.exercise.waiting).toBe(true);
    expect(text.streak).toMatchObject({ title: '1 day in a row', detail: 'Today is logged', waiting: false, action: null });
  });

  test('a month in: each tile repeats its card’s answer', () => {
    // 1 to 29 November logged, 2,500 on the five Sundays: (5 x 2,500 + 24 x 1,800) / 29 = 1,921, 79 under 2,000.
    const month = Array.from({ length: 29 }, (_, i) => food(addDays(FROM_30, i), i % 7 === 0 ? 2500 : 1800));
    const weights: WeighIn[] = Array.from({ length: 30 }, (_, i) => ({ date: addDays(FROM_30, i), kg: 80 - (i * 2) / 29 }));
    const insights = buildInsights(
      input({
        dayTotals: month,
        loggedDates: month.map((d) => d.date),
        weights,
        exercises: [
          { date: nov(20), activity: 'walk', minutes: 45, calories: 131 },
          { date: nov(27), activity: 'run', minutes: 30, calories: 300 },
        ],
        firstExerciseDate: nov(20),
      }),
    );
    const text = glanceText(insights);
    expect(text.weight).toMatchObject({ title: 'Losing 0.5 kg a week', detail: 'Latest 78.0 kg, today', waiting: false });
    expect(text.weight.title).toBe(on(on(insights.weight).rate).rateText);
    expect(text.calories).toMatchObject({ title: '1,921 kcal a day', detail: '79 under your 2,000 kcal goal', waiting: false });
    expect(text.exercise).toMatchObject({ title: '2 workouts', detail: '1 h 15 min on 2 days', waiting: false });
    // Nothing logged today yet, so the run of 29 days is up to yesterday.
    expect(text.streak).toEqual({
      title: '29 days in a row',
      detail: 'Log a meal today to keep it going',
      waiting: false,
      action: null,
      spoken: 'Streak. 29 days in a row. Log a meal today to keep it going.',
    });
  });

  test('a broken streak is a waiting tile again, though the period has food in it', () => {
    // Food on the 20th only: logged days exist, but the run of days ended long before yesterday.
    const insights = buildInsights(input({ dayTotals: [food(nov(20), 1800)], loggedDates: [nov(20)] }));
    expect(on(insights.consistency).streak.current).toBe(0);
    expect(glanceText(insights).streak).toMatchObject({ title: 'Start a streak', detail: 'Log a meal today', waiting: true, action: 'log-food' });
  });

  test('a weight with no clear direction is not given one on the tile either', () => {
    const zigzag: WeighIn[] = [1, 8, 15, 22, 29].map((d, i) => ({ date: nov(d), kg: 80 + (i % 2 ? 0.9 : -0.9) }));
    const text = glanceText(buildInsights(input({ weights: zigzag })));
    expect(text.weight).toMatchObject({ title: 'No clear direction yet', detail: 'Latest 79.1 kg, 29 Nov' });
  });
});

describe('the list of days', () => {
  const full: DaySummary = {
    date: nov(29),
    logged: true,
    count: 4,
    complete: true,
    calories: 1870,
    protein: 112.4,
    carbs: 210,
    fat: 60,
    burned: 131,
    budget: 2131,
    over: false,
    workouts: 1,
    exerciseMinutes: 45,
    weightKg: 78.4,
  };

  test('a full day with a workout and a weigh-in', () => {
    expect(dayRowText(full, TODAY)).toEqual({
      title: 'Yesterday',
      macros: '112 g protein, 210 g carbs, 60 g fat',
      extras: '45 min of exercise, weighed 78.4 kg',
      spoken: 'Yesterday, 1,870 calories of a 2,131 budget, 112 g protein, 210 g carbs, 60 g fat, 45 min of exercise, weighed 78.4 kg. Opens the day.',
    });
  });

  test('a plain day has nothing extra to say', () => {
    const text = dayRowText({ ...full, date: nov(21), burned: 0, budget: 2000, workouts: 0, exerciseMinutes: 0, weightKg: null }, TODAY);
    expect(text.title).toBe('Sat, 21 Nov');
    expect(text.extras).toBeNull();
    expect(text.spoken).toBe('Sat, 21 Nov, 1,870 calories of a 2,000 budget, 112 g protein, 210 g carbs, 60 g fat. Opens the day.');
  });

  test('an over-budget day says so in words, not only in colour', () => {
    const text = dayRowText({ ...full, calories: 2600, over: true, workouts: 0, exerciseMinutes: 0, weightKg: null }, TODAY);
    expect(text.extras).toBe('Over budget');
    expect(text.spoken).toContain(', over budget. Opens the day.');
  });

  test('a past day with too little logged is flagged, today is not', () => {
    const thin = { ...full, calories: 300, complete: false, workouts: 0, exerciseMinutes: 0, weightKg: null };
    expect(dayRowText(thin, TODAY).extras).toBe('Too little logged for the averages');
    expect(dayRowText({ ...thin, date: TODAY }, TODAY)).toMatchObject({ title: 'Today', extras: null });
  });

  test('a day with only a workout or only a weigh-in', () => {
    const empty = { ...full, logged: false, count: 0, complete: false, calories: 0, protein: 0, carbs: 0, fat: 0 };
    expect(dayRowText({ ...empty, exerciseMinutes: 0, workouts: 2, weightKg: null }, TODAY)).toEqual({
      title: 'Yesterday',
      macros: null,
      extras: 'No food logged, 2 workouts',
      spoken: 'Yesterday, no food logged, 2 workouts. Opens the day.',
    });
    expect(dayRowText({ ...empty, workouts: 0, exerciseMinutes: 0 }, TODAY).extras).toBe('No food logged, weighed 78.4 kg');
  });
});
