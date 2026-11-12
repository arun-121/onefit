/**
 * The Progress tab's charts, drawn with react-native-svg.
 *
 * They are quiet on purpose: no axes, hairline gridlines, the system primary for food and weight
 * and the tertiary for movement, the goal as a dashed line, and the real numbers in the text
 * beside the chart rather than crowded onto it. They are drawn in place: nothing here animates.
 * Each chart measures its own width, and each is one image to a screen reader, with a description
 * that states the same facts in words. Where the marks go is worked out in `lib/progress-view.ts`,
 * which is tested; this file only draws them.
 *
 * The proportion bars at the bottom are plain views: flex does the proportion, so there is
 * nothing to measure.
 */
import { useState } from 'react';
import { PixelRatio, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { Alpha, Shape, Spacing, Type, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { DayStatus } from '@/lib/insights';
import {
  barsPath,
  calendarHeight,
  calendarMarkSize,
  calendarMonthLabels,
  calendarWeeks,
  cappedCirclesPath,
  clamp01,
  dotsPath,
  layoutBars,
  layoutCalendar,
  layoutLineChart,
  splitBarsPath,
  WEEKDAY_AXIS,
  type AxisLabels,
  type BarChartLayout,
  type BarTone,
  type ChartBar,
  type LinePoint,
  type LineSegment,
} from '@/lib/progress-view';
import { shapePath } from './expressive';
import { AppText, Tappable } from './ui';

/** Chart labels follow the system font size, up to here; past it they would push the chart out of its tile. */
const MAX_LABEL_SCALE = 1.5;
const LABEL_GAP = 6;
const GOAL_DASH = [5, 5];
/** A weigh-in dot: lighter than the line through them, and still 3:1 against the tile in both themes. */
export const DOT_ALPHA = 0.75;
/** A mark that is on the chart but not in the figures beside it: a day that is not a full day. */
export const FADED_ALPHA = 0.38;
/** A line through weigh-ins that do not show a clear direction yet: there, but behind the dots. */
export const TENTATIVE_ALPHA = 0.45;
/** The calendar's row pitch when its days can be tapped: an honest target for a finger. */
const CALENDAR_TAP_PITCH = 40;
/** How much of an over-budget day's circle its cap takes: enough to find at 16dp, and clear of the day number at 36dp. */
const OVER_CAP_SHARE = 0.3;
/**
 * A plain circle beside a cookie of the same width looks larger, because the cookie only reaches
 * that width at the tips of its scallops. This brings the circle down to the cookie's mean radius.
 */
const CIRCLE_TO_COOKIE = 0.94;
/** Points round a cookie: ten to a scallop where it is large enough to see them, six on the small ones. */
const cookieSteps = (size: number): number => (size >= 24 ? 90 : 54);

function useMeasuredWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (e) => setWidth(Math.floor(e.nativeEvent.layout.width))];
}

function useLabelScale(): number {
  return Math.min(useWindowDimensions().fontScale, MAX_LABEL_SCALE);
}

const tickText = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** The labels under a chart: one per bar for a week, or the start, middle and end of a longer period. */
function XLabels({ axis, gutter }: { axis: AxisLabels; gutter: number }) {
  const { colors } = useTheme();
  if (axis.labels.length === 0) return null;
  return (
    <View style={[styles.xLabels, axis.mode === 'ends' ? styles.xEnds : null, { marginRight: gutter }]}>
      {axis.labels.map((label, i) => (
        <AppText
          key={`${i}-${label}`}
          variant="labelSmall"
          emphasized={i === axis.todayIndex}
          color={i === axis.todayIndex ? colors.onSurface : colors.onSurfaceVariant}
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_LABEL_SCALE}
          style={axis.mode === 'slots' ? styles.xSlot : null}>
          {label}
        </AppText>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- line chart

/**
 * Values over the period: a dot for each one as logged, one straight line through them when there
 * is one to draw, and a dashed line for the goal. The dots are never joined, and days without a
 * value stay empty, so a gap in the dots is a real gap. The latest value is ringed.
 */
export function LineChart({
  points,
  line,
  tentative = false,
  days,
  yMin,
  yMax,
  goal,
  axis,
  height = 168,
  accessibilityLabel,
}: {
  points: readonly LinePoint[];
  /** The direction through the points, in the same units; null draws dots alone. */
  line: LineSegment | null;
  /** The line is a fit and no more: no direction is being claimed, so it is drawn thinner and fainter. */
  tentative?: boolean;
  /** How many days the chart spans. A point's x is its day, counted from 0. */
  days: number;
  yMin: number;
  yMax: number;
  /** Drawn as a dashed line when it is inside the range. */
  goal: number | null;
  axis: AxisLabels;
  height?: number;
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  const scale = useLabelScale();
  const [width, onLayout] = useMeasuredWidth();
  const gutter = Math.round(34 * scale);
  const plotWidth = Math.max(0, width - gutter);
  const xMax = Math.max(0, days - 1);
  // With a letter under every day, each point sits over its letter.
  const insetX = axis.mode === 'slots' && days > 1 ? plotWidth / (2 * days) : undefined;
  const layout = plotWidth > 0 ? layoutLineChart({ points, line, xMax, yMin, yMax, goal, width: plotWidth, height, insetX }) : null;
  const labelHeight = Type.labelSmall.lineHeight * scale;
  // The goal's value sits beside its line. A gridline that close to it gives way, line and label both.
  const goalY = layout ? layout.goalY : null;
  const ticks = layout ? layout.ticks.filter((t) => goalY === null || Math.abs(t.y - goalY) >= labelHeight) : [];
  const labels = goal !== null && goalY !== null ? [...ticks, { value: goal, y: goalY }] : ticks;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <View style={{ height }} onLayout={onLayout}>
        {layout ? (
          <>
            <Svg width={plotWidth} height={height}>
              {ticks.map((t) => (
                <Line key={t.value} x1={0} x2={plotWidth} y1={t.y} y2={t.y} stroke={colors.outlineVariant} strokeWidth={1} />
              ))}
              {goalY !== null ? (
                <Line x1={0} x2={plotWidth} y1={goalY} y2={goalY} stroke={colors.outline} strokeWidth={1.5} strokeDasharray={GOAL_DASH} />
              ) : null}
              {layout.line ? (
                <Line
                  x1={layout.line.from.x}
                  y1={layout.line.from.y}
                  x2={layout.line.to.x}
                  y2={layout.line.to.y}
                  stroke={tentative ? withAlpha(colors.primary, TENTATIVE_ALPHA) : colors.primary}
                  strokeWidth={tentative ? 2 : 2.5}
                  strokeLinecap="round"
                />
              ) : null}
              {/* The weigh-ins are the measured data, so they sit on top of the line. */}
              {layout.dots.length ? <Path d={dotsPath(layout.dots, layout.dotRadius)} fill={withAlpha(colors.primary, DOT_ALPHA)} /> : null}
              {layout.latest ? (
                // The latest weigh-in, ringed in the tile's own colour so it stands clear of the line and its neighbours.
                <Circle cx={layout.latest.x} cy={layout.latest.y} r={5} fill={colors.primary} stroke={colors.surfaceContainerHigh} strokeWidth={2} />
              ) : null}
            </Svg>
            {labels.map((t) => (
              <AppText
                key={t.value}
                variant="labelSmall"
                color={colors.onSurfaceVariant}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_LABEL_SCALE}
                style={[styles.yLabel, { left: plotWidth + LABEL_GAP, top: t.y - labelHeight / 2 }]}>
                {tickText(t.value)}
              </AppText>
            ))}
          </>
        ) : null}
      </View>
      <XLabels axis={axis} gutter={gutter} />
    </View>
  );
}

/**
 * The line chart at the size of a tile: the same dots, the same direction line when there is one,
 * and the latest value picked out. No axes, no numbers, and like the chart it never joins the dots.
 */
export function MiniLineChart({
  points,
  line,
  tentative = false,
  days,
  yMin,
  yMax,
  width = 72,
  height = 28,
}: {
  points: readonly LinePoint[];
  line: LineSegment | null;
  tentative?: boolean;
  days: number;
  yMin: number;
  yMax: number;
  width?: number;
  height?: number;
}) {
  const { colors } = useTheme();
  const layout = layoutLineChart({ points, line, xMax: Math.max(0, days - 1), yMin, yMax, goal: null, width, height, inset: 4 });
  return (
    <Svg width={width} height={height}>
      {layout.line ? (
        <Line
          x1={layout.line.from.x}
          y1={layout.line.from.y}
          x2={layout.line.to.x}
          y2={layout.line.to.y}
          stroke={tentative ? withAlpha(colors.primary, TENTATIVE_ALPHA) : colors.primary}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ) : null}
      {layout.dots.length ? <Path d={dotsPath(layout.dots, 1.5)} fill={withAlpha(colors.primary, DOT_ALPHA)} /> : null}
      {layout.latest ? <Circle cx={layout.latest.x} cy={layout.latest.y} r={3} fill={colors.primary} /> : null}
    </Svg>
  );
}

// ---------------------------------------------------------------- bar chart

/** The bars of a layout, a path per tone. The part of a bar over its limit is the one place the error colour appears. */
function BarMarks({ layout, bars }: { layout: BarChartLayout; bars: readonly ChartBar[] }) {
  const { colors } = useTheme();
  const fills: Record<BarTone, string> = {
    data: colors.primary,
    faded: withAlpha(colors.primary, FADED_ALPHA),
    exercise: colors.tertiary,
  };
  const stubs = barsPath(layout.bars.filter((b) => b.kind === 'stub'), 1.5);
  const tones = (Object.keys(fills) as BarTone[]).map((tone) => ({
    tone,
    ...splitBarsPath(layout.bars.filter((b, i) => b.kind === 'bar' && bars[i].tone === tone), layout.radius),
  }));
  const over = tones.map((t) => t.over).join('');
  return (
    <>
      {stubs ? <Path d={stubs} fill={withAlpha(colors.onSurfaceVariant, 0.38)} /> : null}
      {tones.map((t) => (t.within ? <Path key={t.tone} d={t.within} fill={fills[t.tone]} /> : null))}
      {over ? <Path d={over} fill={colors.error} /> : null}
    </>
  );
}

/**
 * One bar per day, all standing on one baseline. A day with nothing is a short stub, the goal is
 * a dashed line, and the bars thin out rather than disappear when there are ninety of them. A bar
 * that passes its day's limit is marked only above the limit.
 */
export function BarChart({
  bars,
  max,
  goal,
  goalLabel,
  axis,
  height = 120,
  accessibilityLabel,
}: {
  bars: readonly ChartBar[];
  /** The top of the scale. Left out, the tallest bar fills the height. */
  max?: number;
  goal?: number | null;
  /** The goal's value, written beside its line. */
  goalLabel?: string;
  axis: AxisLabels;
  height?: number;
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  const scale = useLabelScale();
  const [width, onLayout] = useMeasuredWidth();
  const gutter = goalLabel ? Math.round(40 * scale) : 0;
  const plotWidth = Math.max(0, width - gutter);
  const layout = plotWidth > 0 ? layoutBars({ bars, max, goal, width: plotWidth, height, pixelRatio: PixelRatio.get() }) : null;
  const labelHeight = Type.labelSmall.lineHeight * scale;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <View style={{ height }} onLayout={onLayout}>
        {layout ? (
          <>
            <Svg width={plotWidth} height={height}>
              <Line x1={0} x2={plotWidth} y1={height - 0.5} y2={height - 0.5} stroke={colors.outlineVariant} strokeWidth={1} />
              <BarMarks layout={layout} bars={bars} />
              {/* Over the bars, so the line reads as one line where a day passes it. */}
              {layout.goalY !== null ? (
                <Line x1={0} x2={plotWidth} y1={layout.goalY} y2={layout.goalY} stroke={colors.outline} strokeWidth={1.5} strokeDasharray={GOAL_DASH} />
              ) : null}
            </Svg>
            {goalLabel && layout.goalY !== null ? (
              <AppText
                variant="labelSmall"
                color={colors.onSurfaceVariant}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_LABEL_SCALE}
                style={[styles.yLabel, { left: plotWidth + LABEL_GAP, top: Math.max(0, layout.goalY - labelHeight / 2) }]}>
                {goalLabel}
              </AppText>
            ) : null}
          </>
        ) : null}
      </View>
      <XLabels axis={axis} gutter={gutter} />
    </View>
  );
}

/**
 * A tile-sized run of bars, for a glance: the same marks as the chart, with nothing written on them.
 * On a lit tile, pass the tile's on-container colour at `Alpha.track` as `axisColor`.
 */
export function MiniBars({
  bars,
  max,
  width = 72,
  height = 28,
  axisColor,
}: {
  bars: readonly ChartBar[];
  max?: number;
  width?: number;
  height?: number;
  /** The baseline. Left out, `outlineVariant`, for a neutral tile. */
  axisColor?: string;
}) {
  const { colors } = useTheme();
  const layout = layoutBars({ bars, max, width, height: height - 1, pixelRatio: PixelRatio.get() });
  return (
    <Svg width={width} height={height}>
      <Line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke={axisColor ?? colors.outlineVariant} strokeWidth={1} />
      <BarMarks layout={layout} bars={bars} />
    </Svg>
  );
}

// ---------------------------------------------------------------- calendar

export interface CalendarGridDay {
  date: string;
  dayOfMonth: number;
  status: DayStatus;
  /** A full day. A day logged within budget that is not one gets the faded look. */
  complete: boolean;
  isToday: boolean;
}

/**
 * The period as a calendar: weeks as rows, Monday first. A day is marked one of three ways, or not
 * at all:
 *
 *  - a full day within budget is a filled cookie, the shape that means "a good day" across the app;
 *  - a day over budget is a plain filled circle with a cap in the error colour, the way its bar on
 *    the Calories chart is marked only above the budget;
 *  - a day that was logged but is not a full day (too little on it, or today, which is still open)
 *    is a small dot;
 *  - a day with nothing logged has no mark. With day numbers showing, a day before the first log is
 *    a fainter number: not a miss.
 *
 * Today is ringed. To a screen reader the calendar is one image with one description. With
 * `onDayPress`, a day that could have been logged also opens when tapped: a shortcut for the eye,
 * on rows a finger can hit.
 */
export function CalendarGrid({
  days,
  leadingBlanks,
  showNumbers,
  onDayPress,
  accessibilityLabel,
}: {
  days: readonly CalendarGridDay[];
  /** Empty cells before the first day, so it lands under its weekday. */
  leadingBlanks: number;
  /** Day numbers fit a week or a month; ninety days use shorter cells without them. */
  showNumbers: boolean;
  onDayPress?: (date: string) => void;
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  const scale = useLabelScale();
  const [width, onLayout] = useMeasuredWidth();
  const weeks = calendarWeeks(days, leadingBlanks);
  const months = calendarMonthLabels(weeks);
  const gutter = Math.round(30 * scale);
  const gap = Spacing.xs;
  const tall = Math.round(28 * Math.max(1, scale));
  const cellHeight = !showNumbers ? 16 : onDayPress ? Math.max(CALENDAR_TAP_PITCH - gap, tall) : tall;
  const height = calendarHeight(weeks.length, cellHeight, gap);
  const layout = width > gutter ? layoutCalendar(weeks, { width, gutter, gap, cellHeight }) : null;
  const size = layout ? calendarMarkSize(layout.cellWidth, cellHeight) : 0;
  const fontSize = Type.labelSmall.fontSize * Math.min(scale, 1.3);
  const labelHeight = Type.labelSmall.lineHeight * scale;
  const faint = withAlpha(colors.onSurfaceVariant, Alpha.disabledContent);

  type Look = 'before' | 'none' | 'full' | 'partial' | 'over';
  type Cell = NonNullable<typeof layout>['cells'][number];
  const lookOf = (d: CalendarGridDay): Look => (d.status === 'within' ? (d.complete ? 'full' : 'partial') : d.status);
  const centre = (c: Cell) => ({ x: c.x + c.width / 2, y: c.y + c.height / 2 });
  // Today's ring goes round its mark, so a solid mark on today is drawn that much smaller.
  const RING = 1.5;
  const ringRadius = Math.max(0, size / 2 - RING / 2);
  const inset = (c: Cell) => (c.day.isToday ? RING + 2 : 0);
  const cells = layout ? layout.cells : [];

  const cookies = cells.filter((c) => lookOf(c.day) === 'full');
  const cookie = size > 0 && cookies.some((c) => !c.day.isToday) ? shapePath('cookie9', size, cookieSteps(size)) : '';
  const overs = cells.filter((c) => lookOf(c.day) === 'over');
  const circle = (size / 2) * CIRCLE_TO_COOKIE;
  const over = cappedCirclesPath(overs.filter((c) => !c.day.isToday).map(centre), circle, OVER_CAP_SHARE);
  const todayCell = cells.find((c) => c.day.isToday) ?? null;
  const todayLook = todayCell ? lookOf(todayCell.day) : null;
  const todaySize = todayCell ? Math.max(0, size - 2 * inset(todayCell)) : 0;
  const todayOver = todayCell && todayLook === 'over' ? cappedCirclesPath([centre(todayCell)], (todaySize / 2) * CIRCLE_TO_COOKIE, OVER_CAP_SHARE) : null;
  // A day that is not a full day: a dot under its number, or in the middle of a cell without one.
  const speck = showNumbers ? 2.5 : 3;
  const speckDrop = showNumbers ? fontSize / 2 + speck + 3 : 0;
  const specks = dotsPath(
    cells.filter((c) => lookOf(c.day) === 'partial').map((c) => ({ x: centre(c).x, y: centre(c).y + speckDrop })),
    speck,
  );
  const numberColor: Record<Look, string> = {
    before: faint,
    none: colors.onSurfaceVariant,
    full: colors.onPrimary,
    partial: colors.onSurface,
    over: colors.onPrimary,
  };
  const tappable = onDayPress ? cells.filter((c) => c.day.status !== 'before') : [];

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={styles.calendar}>
      <View style={[styles.weekdays, { paddingLeft: gutter, gap }]}>
        {WEEKDAY_AXIS.labels.map((label, i) => (
          <AppText
            key={`${i}-${label}`}
            variant="labelSmall"
            color={colors.onSurfaceVariant}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_LABEL_SCALE}
            style={styles.xSlot}>
            {label}
          </AppText>
        ))}
      </View>
      <View style={{ height }} onLayout={onLayout}>
        {layout ? (
          <>
            <Svg width={width} height={height}>
              {cookie
                ? cookies
                    .filter((c) => !c.day.isToday)
                    .map((c) => (
                      <Path
                        key={c.day.date}
                        d={cookie}
                        fill={colors.primary}
                        transform={`translate(${centre(c).x - size / 2} ${centre(c).y - size / 2})`}
                      />
                    ))
                : null}
              {over.body ? <Path d={over.body} fill={colors.primary} /> : null}
              {over.cap ? <Path d={over.cap} fill={colors.error} /> : null}
              {specks ? <Path d={specks} fill={colors.primary} /> : null}
              {todayCell ? (
                <>
                  {todayLook === 'full' && todaySize > 0 ? (
                    <Path
                      d={shapePath('cookie9', todaySize, cookieSteps(todaySize))}
                      fill={colors.primary}
                      transform={`translate(${centre(todayCell).x - todaySize / 2} ${centre(todayCell).y - todaySize / 2})`}
                    />
                  ) : null}
                  {todayOver ? (
                    <>
                      <Path d={todayOver.body} fill={colors.primary} />
                      <Path d={todayOver.cap} fill={colors.error} />
                    </>
                  ) : null}
                  <Circle cx={centre(todayCell).x} cy={centre(todayCell).y} r={ringRadius} stroke={colors.onSurface} strokeWidth={RING} fill="none" />
                </>
              ) : null}
              {showNumbers
                ? cells.map((c) => (
                    <SvgText
                      key={c.day.date}
                      x={centre(c).x}
                      y={centre(c).y + fontSize * 0.36}
                      fontSize={fontSize}
                      fontWeight={c.day.isToday ? '700' : '500'}
                      textAnchor="middle"
                      fill={numberColor[lookOf(c.day)]}>
                      {c.day.dayOfMonth}
                    </SvgText>
                  ))
                : null}
            </Svg>
            {months.map((month, row) =>
              month ? (
                <AppText
                  key={`${row}-${month}`}
                  variant="labelSmall"
                  color={colors.onSurfaceVariant}
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_LABEL_SCALE}
                  style={[styles.yLabel, { left: 0, top: layout.rowTops[row] + (cellHeight - labelHeight) / 2 }]}>
                  {month}
                </AppText>
              ) : null,
            )}
            {tappable.length && onDayPress ? (
              // Hidden from the screen reader: the calendar stays one image, and "Every day" is the route by voice.
              <View style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                {tappable.map((c) => (
                  <Tappable
                    key={c.day.date}
                    accessible={false}
                    scale={0.95}
                    onPress={() => onDayPress(c.day.date)}
                    hitSlop={gap / 2}
                    style={[styles.dayTarget, { left: c.x, top: c.y, width: c.width, height: c.height }]}
                  />
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- proportion bars

/**
 * A share from 0 to 1 as a rounded bar on a faint track. The row it sits in says the number.
 * With `upTo`, the figure is known only to within two ends: the bar stops at the lower one
 * (`value`) and a thin line of the same colour runs on to the upper one, like the whisker on an
 * error bar, so both ends are as easy to find as the end of any other bar.
 */
export function ProportionBar({
  value,
  upTo,
  color,
  trackColor,
  height = 8,
}: {
  value: number;
  upTo?: number;
  color?: string;
  trackColor?: string;
  height?: number;
}) {
  const { colors } = useTheme();
  const v = clamp01(value);
  const reach = upTo === undefined ? 0 : Math.max(v, clamp01(upTo));
  const fill = color ?? colors.primary;
  const whisker = Math.max(2, Math.round(height / 3));
  const percent = (share: number) => `${Math.round(share * 1000) / 10}%` as const;
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: trackColor ?? withAlpha(colors.onSurface, Alpha.track), overflow: 'hidden' }}>
      {reach > v ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: (height - whisker) / 2,
            width: percent(reach),
            height: whisker,
            borderRadius: whisker / 2,
            backgroundColor: fill,
          }}
        />
      ) : null}
      {v > 0 ? <View style={{ width: percent(v), minWidth: height, height, borderRadius: height / 2, backgroundColor: fill }} /> : null}
    </View>
  );
}

/** One whole split into parts, with a 2dp gap of the tile's colour between them. */
export function StackedBar({ segments, height = 12 }: { segments: readonly { value: number; color: string }[]; height?: number }) {
  const shown = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  if (shown.length === 0) return null;
  const end = height / 2;
  const inner = 2;
  return (
    <View style={{ flexDirection: 'row', height, gap: 2 }}>
      {shown.map((s, i) => {
        const first = i === 0;
        const last = i === shown.length - 1;
        return (
          <View
            key={`${i}-${s.color}`}
            style={{
              // Whole numbers: flex shares that add up to less than 1 would not fill the row.
              flexGrow: Math.max(1, Math.round(s.value * 1000)),
              flexBasis: 0,
              minWidth: height,
              backgroundColor: s.color,
              borderTopLeftRadius: first ? end : inner,
              borderBottomLeftRadius: first ? end : inner,
              borderTopRightRadius: last ? end : inner,
              borderBottomRightRadius: last ? end : inner,
            }}
          />
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- legend

export interface LegendEntry {
  /**
   * What is drawn: a round dot, a line, a dashed line or a bar's box on the charts; on the calendar
   * a cookie (a full day within budget), a capped circle (a day over budget) or a speck (a day
   * that is not a full day).
   */
  mark: 'dot' | 'line' | 'dash' | 'box' | 'cookie' | 'capped' | 'speck';
  color: string;
  /** The cap of a capped circle. */
  accent?: string;
  label: string;
}

/** What each mark means, in words, so nothing depends on telling two colours apart. */
export function Legend({ items }: { items: readonly LegendEntry[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <LegendMark mark={item.mark} color={item.color} accent={item.accent} />
          <AppText variant="labelMedium" color={colors.onSurfaceVariant}>
            {item.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** The calendar's marks in the legend, at this size. */
const LEGEND_SHAPE = 14;

function LegendMark({ mark, color, accent }: Pick<LegendEntry, 'mark' | 'color' | 'accent'>) {
  switch (mark) {
    case 'dot':
      return <View style={[styles.markDot, { backgroundColor: color }]} />;
    case 'line':
      return <View style={[styles.markLine, { backgroundColor: color }]} />;
    case 'dash':
      return (
        <Svg width={16} height={8}>
          <Line x1={0} x2={16} y1={4} y2={4} stroke={color} strokeWidth={1.5} strokeDasharray={[4, 3]} />
        </Svg>
      );
    case 'box':
      return <View style={[styles.markBox, { backgroundColor: color }]} />;
    case 'cookie':
      return (
        <Svg width={LEGEND_SHAPE} height={LEGEND_SHAPE}>
          <Path d={shapePath('cookie9', LEGEND_SHAPE, cookieSteps(LEGEND_SHAPE))} fill={color} />
        </Svg>
      );
    case 'capped': {
      const half = LEGEND_SHAPE / 2;
      const paths = cappedCirclesPath([{ x: half, y: half }], half * CIRCLE_TO_COOKIE, OVER_CAP_SHARE);
      return (
        <Svg width={LEGEND_SHAPE} height={LEGEND_SHAPE}>
          <Path d={paths.body} fill={color} />
          <Path d={paths.cap} fill={accent ?? color} />
        </Svg>
      );
    }
    case 'speck':
      return (
        <View style={styles.markSlot}>
          <View style={[styles.markSpeck, { backgroundColor: color }]} />
        </View>
      );
  }
}

const styles = StyleSheet.create({
  yLabel: { position: 'absolute' },
  xLabels: { flexDirection: 'row', marginTop: Spacing.xs },
  xEnds: { justifyContent: 'space-between' },
  xSlot: { flex: 1, textAlign: 'center' },
  calendar: { gap: Spacing.xs },
  // An unseen target over each day: it carries the press and its ripple, clipped to a pill.
  dayTarget: { position: 'absolute', borderRadius: Shape.full, backgroundColor: 'transparent' },
  weekdays: { flexDirection: 'row' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.lg, rowGap: Spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  markDot: { width: 8, height: 8, borderRadius: 4 },
  markLine: { width: 14, height: 3, borderRadius: 1.5 },
  markBox: { width: 10, height: 10, borderRadius: 3 },
  markSlot: { width: LEGEND_SHAPE, height: LEGEND_SHAPE, alignItems: 'center', justifyContent: 'center' },
  markSpeck: { width: 6, height: 6, borderRadius: 3 },
});
