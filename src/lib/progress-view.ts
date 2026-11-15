/**
 * Presentation maths and wording for the Progress tab: where each mark of a chart goes, which axis
 * labels to show, how a period folds into calendar weeks, and what each chart says out loud to a
 * screen reader.
 *
 * Pure: no React, no React Native, no SQLite, so it can be tested with hand-worked numbers. The
 * figures themselves come from `insights.ts`; nothing here works out a new one. It only turns
 * them into coordinates and sentences, and whatever it is given it never returns NaN or Infinity.
 */
import { addDays, dateKeyToDate, daysBetween, formatDayLabel, formatShortDate, weekdayIndex } from './dates';
import { formatMinutes } from './exercise';
import {
  PROTEIN_HIT_SHARE,
  WEEK_SPLIT_MIN_KCAL,
  WEEKDAY_MIN_DAYS,
  type Card,
  type CalorieBar,
  type CaloriesInfo,
  type ConsistencyInfo,
  type DaySummary,
  type ExerciseInfo,
  type InsightAction,
  type Insights,
  type MaintenanceInfo,
  type NotReadyProgress,
  type PatternsInfo,
  type TargetsSuggestion,
  type WeekBlock,
  type WeekAverages,
  type WeekSplit,
  type WeightGoalProgress,
  type WeightInfo,
  type WeightRate,
} from './insights';
import { formatKcal } from './nutrition';
import { formatKg, formatKgChange, roundKg } from './weight';

// ---------------------------------------------------------------- small helpers

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Three decimals: fine enough to land on a device pixel at any screen density, and still a short string. */
const px = (n: number): string => String(Math.round(n * 1000) / 1000);

export function clamp01(n: number): number {
  return finite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Map a value from one range onto another. A domain with no width lands in the middle. */
export function scaleLinear(value: number, domainMin: number, domainMax: number, rangeMin: number, rangeMax: number): number {
  const span = domainMax - domainMin;
  if (!finite(value) || !finite(span) || span === 0) return (rangeMin + rangeMax) / 2;
  return rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

/** "1 day", "3 days". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** A share from 0 to 1 as "22%". A sliver that would round to nothing reads "under 1%". */
export function percentText(share: number): string {
  const s = clamp01(share);
  if (s > 0 && s < 0.005) return 'under 1%';
  return `${Math.round(s * 100)}%`;
}

/** Each value as a share of the largest, for bars that are compared with each other. */
export function relativeToLargest(values: readonly number[]): number[] {
  const usable = values.map((v) => (finite(v) && v > 0 ? v : 0));
  const largest = Math.max(0, ...usable);
  return usable.map((v) => (largest > 0 ? v / largest : 0));
}

/** How full a day's ring is: calories over the day's budget, from 0 to 1. */
export function budgetProgress(calories: number, budget: number): number {
  if (!finite(calories) || calories <= 0) return 0;
  // Food against no budget at all is a full ring, not a division by zero.
  if (!finite(budget) || budget <= 0) return 1;
  return clamp01(calories / budget);
}

/**
 * How far past its budget a day went, as a share of the budget from 0 to 1: the second lap of the
 * day's ring, drawn over the first. 0 for a day within budget.
 */
export function overBudgetShare(calories: number, budget: number): number {
  if (!finite(calories) || calories <= 0) return 0;
  // Food against no budget at all is over by all of it.
  if (!finite(budget) || budget <= 0) return 1;
  return clamp01((calories - budget) / budget);
}

// ---------------------------------------------------------------- axis

const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface AxisLabels {
  /** 'slots': one label under every bar. 'ends': the start, the middle and the end of the period. */
  mode: 'slots' | 'ends';
  labels: string[];
  /** Which slot is today, when one is. */
  todayIndex: number | null;
}

/** Monday to Sunday, for the day-of-the-week chart. */
export const WEEKDAY_AXIS: AxisLabels = { mode: 'slots', labels: WEEKDAY_INITIALS, todayIndex: null };

/**
 * Labels under a chart of the period. A week gets the letter of each day; a month or a quarter has
 * no room for that, so it gets three dates.
 */
export function periodAxis(from: string, days: number, today: string): AxisLabels {
  const count = finite(days) && days > 0 ? Math.round(days) : 0;
  if (count === 0) return { mode: 'ends', labels: [], todayIndex: null };
  if (count <= 7) {
    const dates = Array.from({ length: count }, (_, i) => addDays(from, i));
    const todayIndex = dates.indexOf(today);
    return { mode: 'slots', labels: dates.map((d) => WEEKDAY_INITIALS[weekdayIndex(d)]), todayIndex: todayIndex >= 0 ? todayIndex : null };
  }
  const now = dateKeyToDate(today);
  const to = addDays(from, count - 1);
  return {
    mode: 'ends',
    labels: [
      formatShortDate(from, now),
      formatShortDate(addDays(from, Math.floor((count - 1) / 2)), now),
      to === today ? 'Today' : formatShortDate(to, now),
    ],
    todayIndex: null,
  };
}

/** "13 Oct to 11 Nov", for the line under the screen title. */
export function periodRangeText(from: string, to: string): string {
  const now = dateKeyToDate(to);
  return `${formatShortDate(from, now)} to ${formatShortDate(to, now)}`;
}

/** "5 to 11 Nov" inside one month, "29 Oct to 4 Nov" across two. */
export function dateSpanText(from: string, to: string, today: string): string {
  const now = dateKeyToDate(today);
  const a = dateKeyToDate(from);
  const b = dateKeyToDate(to);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${a.getDate()} to ${formatShortDate(to, now)}`;
  return `${formatShortDate(from, now)} to ${formatShortDate(to, now)}`;
}

type Period = Insights['period'];

/**
 * How many days of the period come before the charts start. The charts open on the first day
 * anything was logged (`period.chartFrom`), so a month of use is not a third of a 90-day chart;
 * every `dayIndex` still counts from `period.from`, and this is what to take off it.
 */
export function chartOffset(period: Pick<Period, 'from' | 'chartFrom' | 'days'>): number {
  const offset = daysBetween(period.from, period.chartFrom);
  if (!finite(offset) || offset <= 0) return 0;
  return Math.min(Math.round(offset), Math.max(0, period.days - 1));
}

/** One row per day of the period, cut down to the days a chart shows. */
export function chartRows<T>(rows: readonly T[], period: Pick<Period, 'from' | 'chartFrom' | 'days'>): T[] {
  return rows.slice(chartOffset(period));
}

const TICK_STEPS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

/** Round numbers inside a range for gridlines: the finest step that needs no more than `maxCount`. */
export function niceTicks(min: number, max: number, maxCount = 4): number[] {
  if (!finite(min) || !finite(max) || max <= min || maxCount < 1) return [];
  for (const step of TICK_STEPS) {
    const first = Math.ceil(min / step - 1e-9);
    const last = Math.floor(max / step + 1e-9);
    const count = last - first + 1;
    if (count >= 1 && count <= maxCount) return Array.from({ length: count }, (_, i) => (first + i) * step);
  }
  return [];
}

// ---------------------------------------------------------------- line chart

export interface LinePoint {
  /** Days from the start of the chart. */
  x: number;
  /** The value as logged. */
  y: number;
}

/** A straight line between two points, in the same units as the points it runs through. */
export interface LineSegment {
  from: LinePoint;
  to: LinePoint;
}

export interface XY {
  x: number;
  y: number;
}

export interface LineChartLayout {
  /** One dot per logged value. */
  dots: XY[];
  dotRadius: number;
  /** The straight line through the values, end to end; null when there is none to draw. */
  line: { from: XY; to: XY } | null;
  /** The dot of the latest value: the one that gets the ring. Null without any dots. */
  latest: XY | null;
  /** The dashed goal line, or null when there is no goal or it is outside the chart. */
  goalY: number | null;
  ticks: { value: number; y: number }[];
}

/**
 * Place a line chart's marks. `x` runs from 0 to `xMax` across the width, so a day without a
 * value leaves a real gap. `inset` keeps the dots and the line's round ends inside the drawing.
 * The dots are never joined: the only line is the one handed in.
 */
export function layoutLineChart(input: {
  points: readonly LinePoint[];
  line?: LineSegment | null;
  xMax: number;
  yMin: number;
  yMax: number;
  goal: number | null;
  width: number;
  height: number;
  inset?: number;
  /** A different inset for the left and right edges, to line the points up with labels underneath. */
  insetX?: number;
}): LineChartLayout {
  const { width, height } = input;
  const inset = input.inset ?? 6;
  const insetX = input.insetX !== undefined && finite(input.insetX) ? Math.max(0, input.insetX) : inset;
  const left = Math.min(insetX, width / 2);
  const right = Math.max(left, width - insetX);
  const top = inset;
  const bottom = Math.max(top, height - inset);
  const xMax = finite(input.xMax) && input.xMax > 0 ? input.xMax : 0;
  const hasRange = finite(input.yMin) && finite(input.yMax) && input.yMax > input.yMin;

  const xOf = (x: number) => (xMax > 0 ? scaleLinear(Math.min(xMax, Math.max(0, x)), 0, xMax, left, right) : (left + right) / 2);
  const yOf = (y: number) =>
    hasRange ? scaleLinear(Math.min(input.yMax, Math.max(input.yMin, y)), input.yMin, input.yMax, bottom, top) : (top + bottom) / 2;
  const usable = (p: LinePoint | null | undefined): p is LinePoint => !!p && finite(p.x) && finite(p.y);

  const points = input.points.filter(usable);
  const dots = points.map((p) => ({ x: xOf(p.x), y: yOf(p.y) }));
  let latest: number | null = null;
  points.forEach((p, i) => {
    if (latest === null || p.x >= points[latest].x) latest = i;
  });
  const segment = input.line;
  const line =
    segment && usable(segment.from) && usable(segment.to) && segment.to.x > segment.from.x
      ? { from: { x: xOf(segment.from.x), y: yOf(segment.from.y) }, to: { x: xOf(segment.to.x), y: yOf(segment.to.y) } }
      : null;
  const perDay = xMax > 0 ? (right - left) / xMax : right - left;
  const goal = input.goal;

  return {
    dots,
    dotRadius: perDay >= 8 ? 3 : perDay >= 4.5 ? 2.5 : 2,
    line,
    latest: latest === null ? null : dots[latest],
    goalY: hasRange && goal !== null && finite(goal) && goal >= input.yMin && goal <= input.yMax ? yOf(goal) : null,
    ticks: hasRange ? niceTicks(input.yMin, input.yMax).map((value) => ({ value, y: yOf(value) })) : [],
  };
}

/**
 * The weight chart's marks in the chart's own days: day 0 is `period.chartFrom`. The line is the
 * least-squares line the card's figures come from, or null when the period has no fit.
 *
 * The line is drawn whether or not the rate is clear, because it is the fit, not a claim. But a
 * bold line slanting down under the words "No clear direction yet" would be a claim, so
 * `tentative` says when to hold it back: there is a line, and the card states neither a direction
 * nor a steady weight.
 */
export function weightChartMarks(
  w: Pick<WeightInfo, 'points' | 'line' | 'rate'>,
  period: Pick<Period, 'from' | 'chartFrom' | 'days'>,
): { points: LinePoint[]; line: LineSegment | null; tentative: boolean } {
  const offset = chartOffset(period);
  const at = (p: { dayIndex: number; kg: number }): LinePoint => ({ x: p.dayIndex - offset, y: p.kg });
  const line = w.line ? { from: at(w.line.from), to: at(w.line.to) } : null;
  return {
    points: w.points.map(at).filter((p) => finite(p.x) && finite(p.y) && p.x >= 0),
    line,
    tentative: line !== null && !(w.rate.ready && (w.rate.clear || w.rate.steady)),
  };
}

/** Every dot as one SVG path of small circles, so ninety weigh-ins are one shape, not ninety views. */
export function dotsPath(points: readonly XY[], radius: number): string {
  const r = px(radius);
  const d = px(radius * 2);
  return points.map((p) => `M${px(p.x - radius)} ${px(p.y)}a${r} ${r} 0 1 0 ${d} 0a${r} ${r} 0 1 0 -${d} 0Z`).join('');
}

// ---------------------------------------------------------------- bar chart

export type BarTone =
  /** A counted day, in the system primary. */
  | 'data'
  /** A day that is on the chart but not in the figures beside it. */
  | 'faded'
  /** Exercise, in the colour workouts have everywhere else in the app. */
  | 'exercise';

export interface ChartBar {
  /** Null draws a short stub: there was nothing that day. */
  value: number | null;
  tone: BarTone;
  /** Draw nothing at all, not even a stub. */
  hidden?: boolean;
  /**
   * The day's limit. A bar taller than it is drawn in its tone up to the limit, and only the part
   * above it is marked as over: the chart then shows how far over a day went.
   */
  limit?: number | null;
}

export interface BarBox {
  kind: 'bar' | 'stub' | 'none';
  x: number;
  y: number;
  width: number;
  height: number;
  /** How much of the bar's height, from its top, is over its limit. 0 for a bar within it. */
  overHeight: number;
}

export interface BarChartLayout {
  /** The width each day gets, bar and gap together. */
  slot: number;
  barWidth: number;
  /** Corner radius of a bar's top end. The foot stays square on the baseline. */
  radius: number;
  bars: BarBox[];
  /** The dashed goal line, or null when there is none or it is above the chart. */
  goalY: number | null;
}

/** Bars never get thicker than this; the rest of a wide slot is left as air. */
const MAX_BAR_WIDTH = 24;
const STUB_HEIGHT = 3;
const MIN_BAR_HEIGHT = 2;

/**
 * Place one bar per value across the width, all standing on the bottom edge. Works from 7 bars
 * (thick, well apart) to 90 (a couple of dp each with a hairline between), because the gap
 * shrinks before the bar does.
 *
 * With `pixelRatio` (device pixels per dp) every bar is the same whole number of pixels wide and
 * starts on a pixel, so ninety thin bars are ninety identical bars instead of a picket fence of
 * blurred edges. The bars still span the whole width: what does not divide evenly goes into the
 * gaps, a pixel at a time.
 */
export function layoutBars(input: {
  bars: readonly Pick<ChartBar, 'value' | 'hidden' | 'limit'>[];
  max?: number;
  goal?: number | null;
  width: number;
  height: number;
  pixelRatio?: number;
}): BarChartLayout {
  const { width, height } = input;
  const n = input.bars.length;
  if (n === 0 || !(width > 0) || !(height > 0)) return { slot: 0, barWidth: 0, radius: 0, bars: [], goalY: null };

  const values = input.bars.map((b) => (b.value !== null && finite(b.value) && b.value > 0 ? b.value : 0));
  const tallest = Math.max(0, ...values);
  const given = input.max;
  // A scale smaller than the tallest bar would push that bar off the top.
  const max = Math.max(given !== undefined && finite(given) && given > 0 ? given : 0, tallest) || 1;

  const ratio = input.pixelRatio !== undefined && finite(input.pixelRatio) && input.pixelRatio > 0 ? input.pixelRatio : 1;
  const widthPx = Math.max(1, Math.floor(width * ratio + 1e-6));
  const slotPx = widthPx / n;
  const slot = width / n;
  const gap = slot >= 16 ? Math.max(4, slot * 0.36) : slot >= 6 ? 2 : 1;
  const barPx = Math.max(1, Math.min(Math.round(MAX_BAR_WIDTH * ratio), Math.round((slot - gap) * ratio)));
  const barWidth = barPx / ratio;
  const goal = input.goal;

  return {
    slot,
    barWidth,
    radius: Math.min(4, barWidth / 2),
    bars: input.bars.map((b, i) => {
      // Centred in its slot, then moved onto a whole pixel.
      const x = Math.max(0, Math.min(Math.max(0, widthPx - barPx), Math.round(i * slotPx + (slotPx - barPx) / 2))) / ratio;
      if (b.value === null || !finite(b.value)) {
        return b.hidden
          ? { kind: 'none', x, y: height, width: barWidth, height: 0, overHeight: 0 }
          : { kind: 'stub', x, y: height - STUB_HEIGHT, width: barWidth, height: STUB_HEIGHT, overHeight: 0 };
      }
      if (b.hidden) return { kind: 'none', x, y: height, width: barWidth, height: 0, overHeight: 0 };
      const h = Math.min(height, Math.max(MIN_BAR_HEIGHT, (values[i] / max) * height));
      const limit = b.limit;
      let overHeight = 0;
      if (limit !== undefined && limit !== null && finite(limit) && values[i] > limit) {
        const within = limit > 0 ? Math.min(h, (limit / max) * height) : 0;
        // However little a day went over, the mark that says so stays visible.
        overHeight = Math.min(h, Math.max(MIN_BAR_HEIGHT, h - within));
      }
      return { kind: 'bar', x, y: height - h, width: barWidth, height: h, overHeight };
    }),
    goalY: goal !== null && goal !== undefined && finite(goal) && goal > 0 && goal <= max ? height - (goal / max) * height : null,
  };
}

/** A bar with a rounded top and a square foot, as an SVG path. */
export function topRoundedBar(box: Pick<BarBox, 'x' | 'y' | 'width' | 'height'>, radius: number): string {
  const r = Math.max(0, Math.min(radius, box.width / 2, box.height));
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  return (
    `M${px(box.x)} ${px(bottom)}V${px(box.y + r)}Q${px(box.x)} ${px(box.y)} ${px(box.x + r)} ${px(box.y)}` +
    `H${px(right - r)}Q${px(right)} ${px(box.y)} ${px(right)} ${px(box.y + r)}V${px(bottom)}Z`
  );
}

/** Several bars as one path, so a tone is a single shape. */
export function barsPath(boxes: readonly Pick<BarBox, 'x' | 'y' | 'width' | 'height'>[], radius: number): string {
  return boxes.map((b) => topRoundedBar(b, radius)).join('');
}

/**
 * Bars as two paths: the part of each within its limit, and the part over it. A bar that went
 * over keeps its rounded top on the over part; what is under the limit ends flat against it.
 */
export function splitBarsPath(boxes: readonly Pick<BarBox, 'x' | 'y' | 'width' | 'height' | 'overHeight'>[], radius: number): { within: string; over: string } {
  let within = '';
  let over = '';
  for (const b of boxes) {
    const cut = finite(b.overHeight) ? Math.min(b.height, Math.max(0, b.overHeight)) : 0;
    if (cut <= 0) {
      within += topRoundedBar(b, radius);
      continue;
    }
    over += topRoundedBar({ x: b.x, y: b.y, width: b.width, height: cut }, radius);
    if (b.height - cut > 0) within += topRoundedBar({ x: b.x, y: b.y + cut, width: b.width, height: b.height - cut }, 0);
  }
  return { within, over };
}

/**
 * Daily calories as chart bars: counted, or logged but not in the average. A day over budget keeps
 * its tone up to that day's budget, and carries the budget as its limit so only the rest is marked.
 */
export function calorieChartBars(bars: readonly CalorieBar[]): ChartBar[] {
  return bars.map((b) => {
    // Before the first food log there is nothing to miss, so not even a stub.
    if (b.calories === null) return { value: null, tone: 'data', hidden: b.status === 'before' };
    const tone: BarTone = b.complete ? 'data' : 'faded';
    return b.status === 'over' ? { value: b.calories, tone, limit: b.budget } : { value: b.calories, tone };
  });
}

/** Minutes of exercise per day. A rest day is not a missed day, so it draws nothing. */
export function exerciseChartBars(daily: ExerciseInfo['daily']): ChartBar[] {
  return daily.map((d) => (d.minutes > 0 ? { value: d.minutes, tone: 'exercise' } : { value: null, tone: 'exercise', hidden: true }));
}

/**
 * Average calories for Monday to Sunday. A weekday with too few full days for an average worth
 * drawing is a stub, not a bar. One day is picked out only when the card says it stands out;
 * with `highlight` null every bar looks the same.
 */
export function weekdayChartBars(byWeekday: PatternsInfo['byWeekday'], highlight: number | null): ChartBar[] {
  return byWeekday.map((w) => ({
    value: w.average !== null && w.days >= WEEKDAY_MIN_DAYS ? w.average : null,
    tone: highlight === null || w.weekday === highlight ? 'data' : 'faded',
  }));
}

// ---------------------------------------------------------------- calendar

/** Fold the period into Monday-first weeks. Null cells are outside the period. */
export function calendarWeeks<T>(days: readonly T[], leadingBlanks: number): (T | null)[][] {
  if (days.length === 0) return [];
  const lead = finite(leadingBlanks) ? Math.min(6, Math.max(0, Math.round(leadingBlanks))) : 0;
  const cells: (T | null)[] = [...Array.from({ length: lead }, () => null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (T | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** A month name beside the first week, and beside each later week that opens in a new month. */
export function calendarMonthLabels(weeks: readonly (readonly ({ date: string } | null)[])[]): (string | null)[] {
  let shown: number | null = null;
  return weeks.map((week) => {
    const first = week.find((d) => d !== null);
    if (!first) return null;
    const d = dateKeyToDate(first.date);
    const month = d.getFullYear() * 12 + d.getMonth();
    if (month === shown) return null;
    shown = month;
    return MONTHS[d.getMonth()];
  });
}

export function calendarHeight(rows: number, cellHeight: number, gap: number): number {
  return rows > 0 ? rows * cellHeight + (rows - 1) * gap : 0;
}

export interface CalendarCell<T> {
  day: T;
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where each day's cell goes: seven columns to the right of a gutter for the month names. */
export function layoutCalendar<T>(
  weeks: readonly (readonly (T | null)[])[],
  box: { width: number; gutter: number; gap: number; cellHeight: number },
): { cells: CalendarCell<T>[]; cellWidth: number; height: number; rowTops: number[] } {
  const cellWidth = Math.max(0, (box.width - box.gutter - 6 * box.gap) / 7);
  const rowTops = weeks.map((_, row) => row * (box.cellHeight + box.gap));
  const cells: CalendarCell<T>[] = [];
  weeks.forEach((week, row) => {
    week.forEach((day, col) => {
      if (day === null) return;
      cells.push({ day, row, col, x: box.gutter + col * (cellWidth + box.gap), y: rowTops[row], width: cellWidth, height: box.cellHeight });
    });
  });
  return { cells, cellWidth, height: calendarHeight(weeks.length, box.cellHeight, box.gap), rowTops };
}

/** A rounded rectangle as an SVG path, inset by `inset` on every side. */
export function roundedRect(box: { x: number; y: number; width: number; height: number }, radius: number, inset = 0): string {
  const x = box.x + inset;
  const y = box.y + inset;
  const w = Math.max(0, box.width - inset * 2);
  const h = Math.max(0, box.height - inset * 2);
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const a = `A${px(r)} ${px(r)} 0 0 1 `;
  return (
    `M${px(x + r)} ${px(y)}H${px(x + w - r)}${a}${px(x + w)} ${px(y + r)}V${px(y + h - r)}${a}${px(x + w - r)} ${px(y + h)}` +
    `H${px(x + r)}${a}${px(x)} ${px(y + h - r)}V${px(y + r)}${a}${px(x + r)} ${px(y)}Z`
  );
}

/**
 * How wide the mark of a calendar day is: as large as its cell allows, and never larger than
 * `max`, so a week's seven wide cells do not grow marks that touch the rows above and below.
 */
export function calendarMarkSize(cellWidth: number, cellHeight: number, max = Infinity): number {
  const size = Math.min(finite(cellWidth) ? cellWidth : 0, finite(cellHeight) ? cellHeight : 0, max);
  return size > 0 ? size : 0;
}

/**
 * Circles cut in two by a level line, as two paths: the cap above the line and the body under it.
 * `capShare` is how much of a circle's height the cap takes, from 0 to 1. This is how a day over
 * budget is drawn on the calendar: the circle is the day and the cap is the part that went over,
 * the way a bar on the Calories chart is marked only above its budget.
 */
export function cappedCirclesPath(centres: readonly XY[], radius: number, capShare: number): { body: string; cap: string } {
  const r = finite(radius) && radius > 0 ? radius : 0;
  if (r === 0 || centres.length === 0) return { body: '', cap: '' };
  const share = clamp01(capShare);
  if (share <= 0) return { body: dotsPath(centres, r), cap: '' };
  if (share >= 1) return { body: '', cap: dotsPath(centres, r) };
  const capHeight = share * 2 * r;
  // From the centre up to the line. Negative once the cap passes the middle of the circle.
  const rise = r - capHeight;
  const half = Math.sqrt(Math.max(0, r * r - rise * rise));
  const capIsLarger = capHeight > r ? 1 : 0;
  const arc = `A${px(r)} ${px(r)} 0 `;
  let body = '';
  let cap = '';
  for (const c of centres) {
    const y = px(c.y - rise);
    const left = px(c.x - half);
    const right = px(c.x + half);
    // Both run clockwise: the cap from the left end of the line over the top, the body from the right end round the foot.
    cap += `M${left} ${y}${arc}${capIsLarger} 1 ${right} ${y}Z`;
    body += `M${right} ${y}${arc}${1 - capIsLarger} 1 ${left} ${y}Z`;
  }
  return { body, cap };
}

// ---------------------------------------------------------------- what each chart says

/** The weight chart in words: the same facts the dots and lines show. */
export function describeWeightChart(w: WeightInfo, today: string): string {
  const now = dateKeyToDate(today);
  const parts: string[] = [];
  if (w.weighIns <= 1) {
    parts.push(`Weight chart. One weigh-in, ${formatKg(w.latest.kg)} on ${formatShortDate(w.latest.date, now)}.`);
  } else {
    parts.push(
      `Weight chart. ${w.weighIns} weigh-ins from ${formatShortDate(w.first.date, now)} to ${formatShortDate(w.latest.date, now)}.`,
      `First ${formatKg(w.first.kg)}, latest ${formatKg(w.latest.kg)}.`,
    );
  }
  const rate = w.rate;
  if (w.line) {
    // The line is drawn whether or not it is clear, but its two ends are a direction: say them only when the card does.
    parts.push(
      rate.ready && (rate.clear || rate.steady)
        ? `The direction line runs from ${formatKg(w.line.from.kg)} to ${formatKg(w.line.to.kg)}.`
        : 'A straight line is drawn through the weigh-ins.',
    );
  }
  if (rate.ready) parts.push(`${rate.rateText}. ${rate.changeText}.`);
  const goal = w.chart.goalKg;
  if (goal !== null) {
    parts.push(
      w.chart.goalOffChart ? `Your ${formatKg(goal)} target is ${w.chart.goalOffChart} the chart.` : `The dashed line is your ${formatKg(goal)} target.`,
    );
  }
  return parts.join(' ');
}

/** The daily calories chart in words. */
export function describeCalorieChart(c: CaloriesInfo, today: string): string {
  const now = dateKeyToDate(today);
  const parts = [`Calories by day. ${c.loggedDays} of ${plural(c.countedDays, 'day')} logged.`];
  parts.push(
    c.average.ready
      ? `Average ${formatKcal(c.average.kcal)} calories a day on ${plural(c.average.days, 'full day')}, against a goal of ${formatKcal(c.goal)}.`
      : `Goal ${formatKcal(c.goal)} calories.`,
  );
  // The chart marks the part of a bar that is over that day's budget, so say how far the furthest went.
  let furthest: CalorieBar | null = null;
  for (const b of c.bars) {
    if (b.status !== 'over' || b.calories === null) continue;
    if (furthest === null || b.calories - b.budget > (furthest.calories ?? 0) - furthest.budget) furthest = b;
  }
  const reached =
    furthest && furthest.calories !== null
      ? `${formatKcal(furthest.calories)} against a budget of ${formatKcal(furthest.budget)} on ${formatShortDate(furthest.date, now)}`
      : null;
  const over = reached ? (c.overBudgetDays === 1 ? `: ${reached}` : `, the furthest ${reached}`) : '';
  parts.push(`${plural(c.withinBudgetDays, 'full day')} within budget, ${plural(c.overBudgetDays, 'day')} over${over}.`);
  let highest: CalorieBar | null = null;
  for (const b of c.bars) if (b.calories !== null && (highest === null || b.calories > (highest.calories ?? 0))) highest = b;
  if (highest && highest.calories !== null && c.loggedDays > 1) {
    parts.push(`Highest day ${formatKcal(highest.calories)} on ${formatShortDate(highest.date, now)}.`);
  }
  return parts.join(' ');
}

/** The minutes-per-day exercise chart in words. */
export function describeExerciseChart(e: ExerciseInfo, today: string): string {
  const now = dateKeyToDate(today);
  const parts = [`Exercise by day. ${plural(e.workouts, 'workout')} on ${plural(e.activeDays, 'day')}, ${formatMinutes(e.minutes)} in total.`];
  let longest: ExerciseInfo['daily'][number] | null = null;
  for (const d of e.daily) if (d.minutes > 0 && (longest === null || d.minutes > longest.minutes)) longest = d;
  if (longest && e.activeDays > 1) parts.push(`Longest day ${formatMinutes(longest.minutes)} on ${formatShortDate(longest.date, now)}.`);
  return parts.join(' ');
}

/** The consistency calendar in words: the card's own sentence, which adds up, and the days with nothing. */
export function describeCalendar(c: ConsistencyInfo): string {
  const notLogged = c.calendar.filter((d) => d.status === 'none').length;
  return `Calendar of the last ${plural(c.calendar.length, 'day')}. ${c.text} ${plural(notLogged, 'day')} not logged.`;
}

/** The day-of-the-week chart in words. A weekday too thin to draw as a bar is not given a figure here either. */
export function describeWeekdayChart(byWeekday: PatternsInfo['byWeekday']): string {
  const days = byWeekday.map((w) => {
    const name = WEEKDAY_NAMES[w.weekday] ?? w.label;
    if (w.average === null || w.days <= 0) return `${name} no full days`;
    return w.days < WEEKDAY_MIN_DAYS ? `${name} too few days` : `${name} ${formatKcal(w.average)}`;
  });
  return `Average calories by day of the week. ${days.join(', ')}.`;
}

// ---------------------------------------------------------------- sentences beside the figures

/** "130 under your 2,000 kcal goal", for the line under the average. */
export function averageVsGoalText(vsGoal: number, goal: number): string {
  const diff = finite(vsGoal) ? Math.round(vsGoal) : 0;
  const target = `your ${formatKcal(goal)} kcal goal`;
  if (diff === 0) return `Right on ${target}`;
  return `${formatKcal(Math.abs(diff))} ${diff < 0 ? 'under' : 'over'} ${target}`;
}

/**
 * What the maintenance estimate is worked out from, so the number does not look like magic. The
 * rate is quoted only when it is clear enough to state, the way the Weight card states it; a
 * steady weight is called steady; otherwise no rate is named at all.
 */
export function maintenanceBasisText(m: Pick<MaintenanceInfo, 'averageIntake' | 'kgPerWeek' | 'rateClear' | 'rateSteady'>): string {
  const eating = `Worked out from eating ${formatKcal(m.averageIntake)} kcal a day`;
  const rate = finite(m.kgPerWeek) ? m.kgPerWeek : 0;
  const size = Math.abs(rate).toFixed(1);
  if (m.rateClear && size !== '0.0') return `${eating} while you ${rate < 0 ? 'lost' : 'gained'} ${size} kg a week.`;
  if (m.rateSteady) return `${eating} while your weight held steady.`;
  return `${eating} and how your weigh-ins moved over the same days.`;
}

/**
 * The line under the latest weigh-in on a Weight card that has no rate yet. With too few weigh-ins
 * for a rate it adds the plain change since the first one: a difference between two readings, not
 * a rate. It is left out when a week is simply too short (the card then compares two weekly
 * averages or sends the owner to 30 days), because first against last inside one week is noise.
 */
export function latestWeighInText(w: Pick<WeightInfo, 'latest' | 'first' | 'rawChangeKg' | 'rate' | 'weekAverages'>, today: string): string {
  const now = dateKeyToDate(today);
  const base = `Your latest weigh-in, ${w.latest.date === today ? 'today' : formatShortDate(w.latest.date, now)}.`;
  const tooShort = !w.rate.ready && w.rate.action === 'longer-period';
  if (w.rate.ready || tooShort || w.weekAverages !== null || w.rawChangeKg === null || !finite(w.rawChangeKg)) return base;
  return `${base} ${formatKgChange(w.rawChangeKg)} since ${formatShortDate(w.first.date, now)} (${formatKg(w.first.kg)}).`;
}

/** The targets a recalculation would set, and how the calories compare with now. */
export function recalcSummary(r: Pick<TargetsSuggestion, 'targets' | 'calorieChange'>): string {
  const t = r.targets;
  const change = finite(r.calorieChange) ? Math.round(r.calorieChange) : 0;
  const versus = change === 0 ? 'The same calories as now.' : `That is ${formatKcal(Math.abs(change))} kcal ${change < 0 ? 'less' : 'more'} a day than now.`;
  return (
    `New targets: ${formatKcal(t.calories)} kcal, ${Math.round(t.protein)} g protein, ${Math.round(t.carbs)} g carbs ` +
    `and ${Math.round(t.fat)} g fat. ${versus}`
  );
}

/** Which meal carries the most calories, or null when no meal has any. */
export function biggestMealText(meals: PatternsInfo['meals']): string | null {
  let top: PatternsInfo['meals'][number] | null = null;
  for (const m of meals) if (finite(m.share) && m.share > 0 && (top === null || m.share > top.share)) top = m;
  if (!top) return null;
  return `The most calories come from ${top.label.toLowerCase()}, ${percentText(top.share)} of the total.`;
}

/**
 * A card's sentence as its answer and the rest, so the answer can be set large and what it adds up
 * from stays a quiet line under it. "Logged 14 of 30 days: 8 full days within budget, 1 over." is
 * cut at the colon; a text without one is cut after its first sentence. No word is added or left
 * out: only the colon, or the full stop that ends the answer, goes.
 */
export function splitAnswer(text: string): { lead: string; rest: string | null } {
  const whole = text.trim();
  const colon = whole.indexOf(': ');
  if (colon > 0) return { lead: whole.slice(0, colon), rest: whole.slice(colon + 2).trim() || null };
  const stop = whole.indexOf('. ');
  if (stop > 0) return { lead: whole.slice(0, stop), rest: whole.slice(stop + 2).trim() || null };
  return { lead: whole.replace(/\.$/, ''), rest: null };
}

// ---------------------------------------------------------------- week by week

export interface WeekRowText {
  /** "5 to 11 Nov" */
  title: string;
  /** "1,935 kcal", or a dash when the week has too few full days for an average. */
  kcal: string;
  /** What the average stands on: "6 full days", or "too few full days". */
  kcalBasis: string;
  /** "80.4 kg average, 3 weigh-ins", "80.6 kg, one weigh-in" or "No weigh-ins". */
  weight: string;
  /** "3 workouts, 2 h 5 min" or "No workouts". */
  exercise: string;
  /** Set for the week the app was first used in, which covers fewer than 7 days. */
  note: string | null;
  /** The week's weight as a bare figure ("80.4 kg"), its only weigh-in's when it had one, or null with none. */
  weightFigure: string | null;
  /** True when `weightFigure` is a single weigh-in, not an average. */
  weightOnce: boolean;
  spoken: string;
}

/** The words on one row of "Week by week". Every figure is the data layer's; a missing one is said, not drawn as zero. */
export function weekRowText(block: WeekBlock, today: string): WeekRowText {
  const title = dateSpanText(block.from, block.to, today);
  const hasAverage = block.averageKcal !== null && finite(block.averageKcal);
  const kcal = hasAverage ? `${formatKcal(block.averageKcal ?? 0)} kcal` : '–';
  const kcalBasis = hasAverage ? plural(block.completeDays, 'full day') : 'too few full days';
  const weight =
    block.averageKg !== null && finite(block.averageKg)
      ? `${formatKg(block.averageKg)} average, ${plural(block.weighIns, 'weigh-in')}`
      : block.singleKg !== null && finite(block.singleKg)
        ? `${formatKg(block.singleKg)}, one weigh-in`
        : 'No weigh-ins';
  const exercise = block.workouts > 0 ? `${plural(block.workouts, 'workout')}, ${formatMinutes(block.minutes)}` : 'No workouts';
  const note = block.daysInUse < 7 ? `Covers ${plural(block.daysInUse, 'day')}: your first log was part-way through.` : null;
  const meals = hasAverage
    ? `Average ${formatKcal(block.averageKcal ?? 0)} calories a day on ${plural(block.completeDays, 'full day')}`
    : 'Too few full days for an average';
  const hasAverageKg = block.averageKg !== null && finite(block.averageKg);
  const hasSingleKg = !hasAverageKg && block.singleKg !== null && finite(block.singleKg);
  return {
    title,
    kcal,
    kcalBasis,
    weight,
    exercise,
    note,
    weightFigure: hasAverageKg ? formatKg(block.averageKg ?? 0) : hasSingleKg ? formatKg(block.singleKg ?? 0) : null,
    weightOnce: hasSingleKg,
    spoken: [title, meals, weight, exercise, ...(note ? [note.replace(/\.$/, '')] : [])].join('. ') + '.',
  };
}

// ---------------------------------------------------------------- the glance grid

export type GlanceKey = 'weight' | 'calories' | 'exercise' | 'streak';

export interface GlanceText {
  /** The tile's answer, first. */
  title: string;
  /** What the answer stands on, or what logging would show. */
  detail: string;
  /** Nothing to show yet: the tile is unlit, with a ring avatar and a plus, like an unlogged meal on Today. */
  waiting: boolean;
  /** What a waiting tile logs when tapped; null when the tile only leads to its card. */
  action: InsightAction | null;
  spoken: string;
}

const GLANCE_NAMES: Record<GlanceKey, string> = { weight: 'Weight', calories: 'Calories', exercise: 'Exercise', streak: 'Streak' };

/**
 * The four small tiles under the headline, in words. Each repeats one answer its card gives
 * further down; nothing is worked out here. A tile with nothing behind it says what to log.
 *
 * None repeats the headline tile right above it: once there is an average, the headline already
 * shows it, so the calories tile gives the Calories card's other answer, how many full days stayed
 * within budget, which its small bars (over-budget caps and all) show.
 */
export function glanceText(insights: Pick<Insights, 'weight' | 'calories' | 'exercise' | 'consistency' | 'period'>): Record<GlanceKey, GlanceText> {
  const today = insights.period.to;
  const now = dateKeyToDate(today);
  const make = (key: GlanceKey, title: string, detail: string, action?: InsightAction | null): GlanceText => ({
    title,
    detail,
    waiting: action !== undefined,
    action: action ?? null,
    spoken: `${GLANCE_NAMES[key]}. ${title}. ${detail}.`,
  });

  const w = insights.weight;
  const c = insights.calories;
  const e = insights.exercise;
  const streak = insights.consistency.ready ? insights.consistency.streak : null;
  const weighed = w.ready ? (w.latest.date === today ? 'today' : formatShortDate(w.latest.date, now)) : '';

  return {
    weight: !w.ready
      ? make('weight', 'Log your weight', 'To see where it is heading', w.action ?? null)
      : w.rate.ready
        ? make('weight', w.rate.rateText, `Latest ${formatKg(w.latest.kg)}, ${weighed}`)
        : make('weight', formatKg(w.latest.kg), `Weighed ${weighed}`),
    calories: !c.ready
      ? make('calories', 'Log your meals', 'To see your average against your goal', c.action ?? null)
      : c.average.ready
        ? make('calories', `${c.withinBudgetDays} of ${c.completeDays}`, c.completeDays === 1 ? 'Full day within budget' : 'Full days within budget')
        : make('calories', `${plural(c.loggedDays, 'day')} logged`, 'No average yet'),
    exercise: !e.ready
      ? make('exercise', 'Log a workout', 'To see your minutes and top activities', e.action ?? null)
      : make('exercise', plural(e.workouts, 'workout'), `${formatMinutes(e.minutes)} on ${plural(e.activeDays, 'day')}`),
    streak:
      streak && streak.current > 0
        ? make('streak', `${plural(streak.current, 'day')} in a row`, streak.loggedToday ? 'Today is logged' : 'Log a meal today to keep it going')
        : make('streak', 'Start a streak', 'Log a meal today', 'log-food'),
  };
}

// ---------------------------------------------------------------- the list of days

export interface DayRowText {
  /** "Today", "Yesterday" or "Mon, 9 Nov". */
  title: string;
  /** Protein, carbs and fat, or null for a day without food. */
  macros: string | null;
  /** Workout, weigh-in, and anything that sets the day apart; null when there is nothing to add. */
  extras: string | null;
  /** The same as small figures, for drawing: protein, carbs and fat ("112 g"), null for a day without food. */
  grams: { protein: string; carbs: string; fat: string } | null;
  /** What sets the day apart, in words, so it is never only a colour: "Over budget", "Not a full day", "No food logged". */
  flag: string | null;
  /** The day's exercise: "45 min", or "1 workout" without minutes; null with none. */
  exercise: string | null;
  /** The day's weigh-in: "78.4 kg"; null with none. */
  weight: string | null;
  /** The whole row, for a screen reader. */
  spoken: string;
}

/** The words on one row of "Every day". */
export function dayRowText(day: DaySummary, today: string): DayRowText {
  const title = formatDayLabel(day.date, dateKeyToDate(today));
  // Lower case throughout, so the pieces read as one line once they are joined.
  const pieces: string[] = [];
  if (!day.logged) pieces.push('no food logged');
  else if (day.over) pieces.push('over budget');
  else if (!day.complete && day.date !== today) pieces.push('too little logged for the averages');
  if (day.workouts > 0) pieces.push(day.exerciseMinutes > 0 ? `${formatMinutes(day.exerciseMinutes)} of exercise` : plural(day.workouts, 'workout'));
  if (day.weightKg !== null && finite(day.weightKg)) pieces.push(`weighed ${formatKg(day.weightKg)}`);

  const macros = day.logged ? `${Math.round(day.protein)} g protein, ${Math.round(day.carbs)} g carbs, ${Math.round(day.fat)} g fat` : null;
  const joined = pieces.join(', ');
  const spoken = [title, ...(day.logged ? [`${formatKcal(day.calories)} calories of a ${formatKcal(day.budget)} budget`, macros ?? ''] : []), ...pieces]
    .filter((part) => part !== '')
    .join(', ');
  const grams = (n: number) => `${Math.round(finite(n) ? n : 0)} g`;
  return {
    title,
    macros,
    extras: joined ? joined.charAt(0).toUpperCase() + joined.slice(1) : null,
    grams: day.logged ? { protein: grams(day.protein), carbs: grams(day.carbs), fat: grams(day.fat) } : null,
    flag: !day.logged ? 'No food logged' : day.over ? 'Over budget' : !day.complete && day.date !== today ? 'Not a full day' : null,
    exercise: day.workouts > 0 ? (day.exerciseMinutes > 0 ? formatMinutes(day.exerciseMinutes) : plural(day.workouts, 'workout')) : null,
    weight: day.weightKg !== null && finite(day.weightKg) ? formatKg(day.weightKg) : null,
    spoken: `${spoken}. Opens the day.`,
  };
}

// ---------------------------------------------------------------- pictures (docs/DESIGN.md, "Show, don't tell")

/**
 * A change, ready to draw as a delta chip: which way, how much, whether it takes the owner toward
 * their goal (only then is the chip filled), and the whole of it in words for a screen reader.
 */
export interface DeltaView {
  direction: 'up' | 'down' | 'flat';
  /** "61 under", "0.5 kg a week". */
  amount: string;
  towardGoal: boolean;
  spoken: string;
}

/**
 * An average against the calorie goal as a change: "61 under", "61 over", or "On goal" when level
 * with it. At or under the goal is within budget, which the app counts as a good day everywhere
 * else (the cookie on the calendar), so that is the filled chip.
 */
export function calorieDelta(vsGoal: number, goal: number): DeltaView {
  const diff = finite(vsGoal) ? Math.round(vsGoal) : 0;
  const target = `your ${formatKcal(finite(goal) ? goal : 0)} kcal goal`;
  if (diff === 0) return { direction: 'flat', amount: 'On goal', towardGoal: true, spoken: `Right on ${target}` };
  const size = formatKcal(Math.abs(diff));
  const side = diff < 0 ? 'under' : 'over';
  return { direction: diff < 0 ? 'down' : 'up', amount: `${size} ${side}`, towardGoal: diff < 0, spoken: `${size} ${side} ${target}` };
}

/**
 * The weight rate as a delta chip, only when the weigh-ins support one: a clear rate gets its arrow
 * and its figure, a steady weight a level chip, and anything less no chip at all (PRODUCT.md: no
 * rate, no change and no arrow while the rate is not clear).
 */
export function weightRateDelta(rate: Card<WeightRate>): DeltaView | null {
  if (!rate.ready) return null;
  const said = `${rate.rateText}. ${rate.changeText}.`;
  if (rate.clear && rate.direction !== 'flat' && rate.direction !== null) {
    const toward = rate.towardGoal === true;
    return {
      direction: rate.direction,
      amount: `${Math.abs(finite(rate.kgPerWeek) ? rate.kgPerWeek : 0).toFixed(1)} kg a week`,
      towardGoal: toward,
      spoken: toward ? `${said} Toward your target.` : said,
    };
  }
  if (rate.steady) return { direction: 'flat', amount: 'Steady', towardGoal: false, spoken: said };
  return null;
}

/** "79% of the way from 82.4 kg to 72.0 kg, with 2.2 kg to go.", or how far is left without a starting weight. */
export function goalProgressText(goal: Pick<WeightGoalProgress, 'kg' | 'startKg' | 'toGoKg' | 'progress' | 'reached'>): string {
  if (goal.progress !== null && goal.startKg !== null && !goal.reached) {
    return `${percentText(goal.progress)} of the way from ${formatKg(goal.startKg)} to ${formatKg(goal.kg)}, with ${formatKg(goal.toGoKg)} to go.`;
  }
  return `${formatKg(goal.toGoKg)} to go to your ${formatKg(goal.kg)} target.`;
}

/**
 * The 7-day view's two weekly averages in one short line: "74.4 kg average this week, 0.4 kg lower
 * than the week before". The weigh-in counts stay in the full sentence (`WeekAverages.text`).
 */
export function weekAveragesLine(wa: Pick<WeekAverages, 'thisWeek' | 'changeKg'>): string {
  const change = finite(wa.changeKg) ? roundKg(wa.changeKg) : 0;
  const head = `${formatKg(wa.thisWeek.average)} average this week`;
  if (change === 0) return `${head}, the same as the week before`;
  return `${head}, ${Math.abs(change).toFixed(1)} kg ${change < 0 ? 'lower' : 'higher'} than the week before`;
}

/** Why new targets are offered, in a line: "5.8 kg from the 80.0 kg they were set at". */
export function recalcLine(r: Pick<TargetsSuggestion, 'fromKg' | 'changeKg'>): string {
  const moved = finite(r.changeKg) ? Math.abs(roundKg(r.changeKg)) : 0;
  return `${moved.toFixed(1)} kg from the ${formatKg(r.fromKg)} they were set at`;
}

/** A figure of the headline tile: the number, what it is, and the change beside it. */
export interface HeadlineFigure {
  value: string;
  unit: string;
  delta: DeltaView | null;
}

/**
 * The headline tile as figures instead of a sentence. It leads with what the sentence leads with
 * (`buildInsights` makes the same choice, in the same order): the weight change when the weigh-ins
 * support one, else how few days the average stands on, else the average, else the full days so far
 * as a meter, else the latest weigh-in, else the exercise. `headline.text` still says all of it.
 */
export interface HeadlineView {
  figure: HeadlineFigure | null;
  /** A smaller figure under the first: the average intake under a weight change. */
  second: HeadlineFigure | null;
  /** At most one line of words, for what a figure cannot say. */
  line: string | null;
  /** Set while the average waits for full days. */
  meter: NotReadyProgress | null;
}

export function headlineView(insights: Pick<Insights, 'weight' | 'calories' | 'exercise'>): HeadlineView {
  const { weight, calories, exercise } = insights;
  const average = calories.ready && calories.average.ready ? calories.average : null;
  const low = calories.ready && calories.lowCoverage;
  const none: HeadlineView = { figure: null, second: null, line: null, meter: null };
  const intakeFigure = (a: { kcal: number; vsGoal: number }, goal: number): HeadlineFigure => ({
    value: formatKcal(a.kcal),
    unit: 'kcal a day',
    delta: calorieDelta(a.vsGoal, goal),
  });

  if (weight.ready && weight.rate.ready && (weight.rate.clear || weight.rate.steady)) {
    const rate = weight.rate;
    const kg = Math.abs(roundKg(finite(rate.changeKg) ? rate.changeKg : 0)).toFixed(1);
    const figure: HeadlineFigure = rate.clear
      ? { value: `${rate.direction === 'down' ? '−' : '+'}${kg} kg`, unit: `in ${rate.days} days`, delta: null }
      : { value: 'Steady', unit: `over ${rate.days} days`, delta: null };
    if (!average || !calories.ready) return { ...none, figure };
    if (low) return { ...none, figure, line: `Eating ${formatKcal(average.kcal)} kcal a day on the ${average.days} days logged in full` };
    return { ...none, figure, second: intakeFigure(average, calories.goal) };
  }
  if (calories.ready && average && low) {
    return {
      ...none,
      figure: { value: `${calories.completeDays} of ${calories.countedDays}`, unit: 'days logged in full', delta: null },
      line: `${formatKcal(average.kcal)} kcal a day on those days`,
    };
  }
  if (calories.ready && average) return { ...none, figure: intakeFigure(average, calories.goal) };
  if (calories.ready && !calories.average.ready) {
    const p = calories.average.progress;
    return { ...none, meter: p ? { ...p, label: 'Full days for an average' } : null };
  }
  if (weight.ready) return { ...none, figure: { value: roundKg(weight.latest.kg).toFixed(1), unit: 'kg', delta: null }, line: 'Your latest weigh-in' };
  if (exercise.ready) return { ...none, figure: { value: formatMinutes(exercise.minutes), unit: 'of exercise', delta: null } };
  return none;
}

/**
 * The scale of "What you actually burn": wide enough for the range, the intake, the goal and the
 * calculator's figure, with some air either side, in round hundreds.
 */
export function burnScale(m: Pick<MaintenanceInfo, 'low' | 'high' | 'averageIntake' | 'goal' | 'formulaKcal'>): { min: number; max: number } {
  return kcalScale([m.low, m.high, m.averageIntake, m.goal.kcal, m.formulaKcal]);
}

/**
 * A scale in kcal for a range bar that holds every one of `values`, with air either side (a fifth
 * of their spread, and never under 100), in round hundreds. Missing or non-positive values are
 * skipped; with none left it is 0 to 1.
 */
export function kcalScale(values: readonly (number | null | undefined)[]): { min: number; max: number } {
  const usable = values.filter((v): v is number => finite(v) && v > 0);
  if (usable.length === 0) return { min: 0, max: 1 };
  const lo = Math.min(...usable);
  const hi = Math.max(...usable);
  const pad = Math.max(100, (hi - lo) * 0.2);
  return { min: Math.max(0, Math.floor((lo - pad) / 100) * 100), max: Math.ceil((hi + pad) / 100) * 100 };
}

/**
 * What the goal means against the burn range, in one line that repeats no number the range bar
 * draws: the weekly change it works out to, or that it is close to what you burn. The full
 * sentence, with the gap in kcal, is `goal.text`.
 */
export function burnLine(m: Pick<MaintenanceInfo, 'goal'>): string {
  const { kind, gapKcal, gapKgPerWeek } = m.goal;
  if (kind === 'maintenance' || !gapKcal || !gapKgPerWeek) return 'Your goal is close to what you burn';
  const verb = kind === 'deficit' ? 'lost' : 'gained';
  const { min, max } = gapKgPerWeek;
  if (!(max >= 0.1)) {
    const gap = gapKcal.min === gapKcal.max ? formatKcal(gapKcal.max) : `${formatKcal(gapKcal.min)} to ${formatKcal(gapKcal.max)}`;
    return `Your goal is ${gap} kcal ${kind === 'deficit' ? 'less' : 'more'} than you burn`;
  }
  if (min === max) return `About ${max.toFixed(1)} kg ${verb} a week at your goal`;
  if (min < 0.1) return `Up to ${max.toFixed(1)} kg ${verb} a week at your goal`;
  return `About ${min.toFixed(1)} to ${max.toFixed(1)} kg ${verb} a week at your goal`;
}

/** One day on the protein dots: reached, a full day short of it, today (still open), or a day that is not a full day. */
export type ProteinDayMark = 'hit' | 'miss' | 'today' | 'empty';

/**
 * Each day the charts cover, as a protein dot: a full day that reached 90% of the protein goal is a
 * hit, a full day short of it a miss, today is still open, and any other day does not count. The
 * hits are the Macros card's `proteinDays`. Labels (the weekday's initial) are given for a week.
 */
export function proteinDayMarks(
  days: readonly Pick<DaySummary, 'date' | 'complete' | 'protein'>[],
  period: Pick<Period, 'chartFrom' | 'chartDays' | 'to'>,
  proteinGoal: number,
): { marks: ProteinDayMark[]; labels: string[] | null; hits: number; full: number } {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const count = finite(period.chartDays) && period.chartDays > 0 ? Math.round(period.chartDays) : 0;
  const dates = Array.from({ length: count }, (_, i) => addDays(period.chartFrom, i));
  const needed = PROTEIN_HIT_SHARE * (finite(proteinGoal) ? proteinGoal : 0);
  let hits = 0;
  let full = 0;
  const marks = dates.map((date): ProteinDayMark => {
    const day = byDate.get(date);
    if (day?.complete) {
      full += 1;
      if (proteinGoal > 0 && day.protein >= needed) {
        hits += 1;
        return 'hit';
      }
      return 'miss';
    }
    return date === period.to ? 'today' : 'empty';
  });
  return { marks, labels: count <= 7 ? dates.map((d) => WEEKDAY_INITIALS[weekdayIndex(d)]) : null, hits, full };
}

/** The meals' calories a day, for the words behind the split bar: "Breakfast 453 kcal a day, 23%; ...". */
export function mealsSpoken(meals: readonly Pick<PatternsInfo['meals'][number], 'label' | 'average' | 'share'>[]): string {
  return `Calories by meal: ${meals.map((m) => `${m.label}, ${percentText(m.share)}, ${formatKcal(m.average)} kcal a day`).join('; ')}.`;
}

/**
 * The one line under the Weight card's figure: the 7-day view's two weekly averages; a rate that is
 * there but not clear, in its own words ("No clear direction yet"); or, before there is a rate, the
 * plain change between the first and latest weigh-in, as `latestWeighInText` gives it. Null when
 * the figure and its chip say it all.
 */
export function weightLine(w: Pick<WeightInfo, 'latest' | 'first' | 'rawChangeKg' | 'rate' | 'weekAverages'>, today: string): string | null {
  if (w.weekAverages) return weekAveragesLine(w.weekAverages);
  if (w.rate.ready) return w.rate.clear || w.rate.steady ? null : w.rate.rateText;
  if (w.rate.action === 'longer-period' || w.rawChangeKg === null || !finite(w.rawChangeKg)) return null;
  return `${formatKgChange(w.rawChangeKg)} since ${formatShortDate(w.first.date, dateKeyToDate(today))} (${formatKg(w.first.kg)})`;
}

/**
 * Weekdays against weekends in a line that repeats neither average (the range bar draws both): the
 * difference when it is clear, "about the same" under 100 kcal apart, and otherwise that it is too
 * early, exactly as `WeekSplit.text` decides.
 */
export function weekSplitLine(split: Pick<WeekSplit, 'difference' | 'clear'>): string {
  const diff = finite(split.difference) ? Math.round(split.difference) : 0;
  if (split.clear) return `${formatKcal(Math.abs(diff))} kcal ${diff > 0 ? 'more' : 'less'} a day at weekends`;
  if (Math.abs(diff) < WEEK_SPLIT_MIN_KCAL) return 'About the same so far';
  return 'Too few days to tell them apart yet';
}

/** How the recalculated calories compare with the current goal, as a quiet chip; null when they are the same. */
export function targetsDelta(r: Pick<TargetsSuggestion, 'calorieChange'>): DeltaView | null {
  const change = finite(r.calorieChange) ? Math.round(r.calorieChange) : 0;
  if (change === 0) return null;
  const size = formatKcal(Math.abs(change));
  const side = change < 0 ? 'less' : 'more';
  return { direction: change < 0 ? 'down' : 'up', amount: `${size} ${side}`, towardGoal: false, spoken: `${size} kcal ${side} a day than now` };
}
