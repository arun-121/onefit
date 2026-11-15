/**
 * The picture vocabulary of docs/DESIGN.md, "Show, don't tell (version 3)": one picture for each
 * kind of fact, drawn the same way on every card, so the owner learns to read each one once.
 *
 *  - `GlanceFigure`  a card's one number, with its delta chip
 *  - `DeltaChip`     a change: an arrow and the amount, filled when it is toward the goal, never red
 *  - `RangeBar`      a value against a range: a track, a band for the range, labelled marks
 *  - `SplitBar`      a share of a whole: one stacked bar with the labels under its segments
 *  - `DayDots`       days hit or missed: a row of dots
 *  - `SmallRing`     progress to a target: a small ring with the figure inside, a sunny shape once reached
 *  - `StatRow`       a few counts: an icon, a figure and one or two words each
 *  - `UnlockMeter`   not enough data yet: a segmented meter of what is there against what is needed
 *  - `BarRows`       ranked items: a name, a figure and a thin bar for its share
 *  - `Disclosure`    "How it's worked out": the words a card used to carry, one tap away
 *
 * They are quiet on purpose. None has a box of its own: each sits on the card it is put in, and
 * only the data marks take colour (the subject's colour, see `GlanceTone`; references such as a
 * goal are `outline`, like the dashed goal lines on the charts). Labels sit on the marks they
 * label; a legend appears only where a mark is too small to carry its own.
 *
 * Every picture is one element to a screen reader, and its label is the whole sentence the picture
 * replaced, so nothing the words used to say is lost (docs/PRODUCT.md: honesty over polish).
 *
 * Nothing here moves on its own: pictures are drawn in place. The one animation is the
 * disclosure, which answers a tap (Emil Kowalski's rules, in DESIGN.md "Motion").
 */
import { Children, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { categoryColors, type Category } from '@/constants/category-colors';
import { Alpha, Shape, Spacing, withAlpha, type ColorScheme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ProportionBar, StackedBar } from './charts';
import { MiniRing, ShapeAvatar } from './expressive';
import { keepUnits } from './screen-text';
import { AppText, Avatar, Button, Icon, Tappable, type AvatarTone, type IconName } from './ui';

// ---------------------------------------------------------------- colour

/**
 * Whose colour a mark takes. Food and weight are `primary`, movement is `tertiary`, the streak is
 * `secondary`, and protein, carbs and fat are their category colours.
 */
export type GlanceTone = 'primary' | 'secondary' | 'tertiary' | Category;

/** The four roles of a tone: a mark, what sits on a filled mark, a soft fill, and what sits on that. */
export interface ToneColors {
  color: string;
  on: string;
  container: string;
  onContainer: string;
}

/** The roles of `tone` in this scheme. The hook `useToneColors` is the same for one tone. */
export function toneColors(tone: GlanceTone, colors: ColorScheme, dark: boolean): ToneColors {
  switch (tone) {
    case 'primary':
      return { color: colors.primary, on: colors.onPrimary, container: colors.primaryContainer, onContainer: colors.onPrimaryContainer };
    case 'secondary':
      return { color: colors.secondary, on: colors.onSecondary, container: colors.secondaryContainer, onContainer: colors.onSecondaryContainer };
    case 'tertiary':
      return { color: colors.tertiary, on: colors.onTertiary, container: colors.tertiaryContainer, onContainer: colors.onTertiaryContainer };
    default: {
      // A category's strong colour is tone 40 (light) or 80 (dark), and its container tone 90 or 30:
      // the container's colour reads on the strong one in both themes.
      const c = categoryColors(colors.primary, dark)[tone];
      return { color: c.color, on: c.container, container: c.container, onContainer: c.onContainer };
    }
  }
}

export function useToneColors(tone: GlanceTone): ToneColors {
  const { colors, dark } = useTheme();
  return toneColors(tone, colors, dark);
}

/** The unfilled part of every bar, ring and meter here: the same faint track as the charts. */
function useTrack(): string {
  const { colors } = useTheme();
  return withAlpha(colors.onSurface, Alpha.track);
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const percent = (share: number) => `${Math.round(clamp01(share) * 10000) / 100}%` as const;

// ---------------------------------------------------------------- the one number

/**
 * A card's one number: the figure in `headlineSmall` emphasised and tabular, its unit beside it in
 * a quiet voice, and the delta chip after them when there is a change to show. It wraps under a
 * large font size rather than shrinking.
 */
export function GlanceFigure({
  value,
  unit,
  delta,
  accessibilityLabel,
}: {
  value: string;
  unit?: string;
  delta?: DeltaChipProps;
  /** Left out, the figure, its unit and the delta chip's own words. */
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const spoken = accessibilityLabel ?? [unit ? `${value} ${unit}` : value, delta ? deltaWords(delta) : null].filter(Boolean).join(', ');
  return (
    <View style={styles.figureRow} accessible accessibilityLabel={spoken}>
      <AppText variant="headlineSmall" emphasized tabular>
        {keepUnits(value)}
        {unit ? <AppText variant="bodyLarge" color={colors.onSurfaceVariant}>{` ${unit}`}</AppText> : null}
      </AppText>
      {delta ? <DeltaChip {...delta} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- a change

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface DeltaChipProps {
  /** Which way the figure moved. */
  direction: DeltaDirection;
  /** How far, with its unit: "0.4 kg a week", "450 under". */
  amount: string;
  /** Whether this change takes the owner toward their goal. Only then is the chip filled. */
  towardGoal?: boolean;
  /** The subject's colour for a change toward the goal: `primary` (food, weight) or `tertiary` (movement). */
  tone?: 'primary' | 'tertiary';
  /** Left out, "Down 0.4 kg a week, toward your goal". */
  accessibilityLabel?: string;
}

const DELTA_ICON: Record<DeltaDirection, IconName> = { up: 'arrow-up', down: 'arrow-down', flat: 'trending-neutral' };
const DELTA_WORD: Record<DeltaDirection, string> = { up: 'Up', down: 'Down', flat: 'Steady' };

function deltaWords({ direction, amount, towardGoal, accessibilityLabel }: DeltaChipProps): string {
  return accessibilityLabel ?? `${DELTA_WORD[direction]} ${amount}${towardGoal ? ', toward your goal' : ''}`;
}

/**
 * A change, as a small pill: an arrow and the amount. Toward the goal it is filled in the
 * subject's container colour; any other change is a quiet neutral pill. It is never red: a change
 * is information, and only the part of a day over budget is `error`. Not pressable.
 */
export function DeltaChip(props: DeltaChipProps) {
  const { colors } = useTheme();
  const t = useToneColors(props.tone ?? 'primary');
  const toward = !!props.towardGoal;
  const fg = toward ? t.onContainer : colors.onSurfaceVariant;
  return (
    <View
      style={[styles.delta, { backgroundColor: toward ? t.container : colors.surfaceContainerHighest }]}
      accessible
      accessibilityLabel={deltaWords(props)}>
      <Icon name={DELTA_ICON[props.direction]} size={16} color={fg} />
      <AppText variant="labelLarge" emphasized tabular color={fg} numberOfLines={1} maxFontSizeMultiplier={1.5}>
        {keepUnits(props.amount)}
      </AppText>
    </View>
  );
}

// ---------------------------------------------------------------- a value against a range

export interface RangeMark {
  value: number;
  /** One or two words, set before the figure: "Goal", "You eat". */
  label: string;
  /** The number, emphasised after the label: "2,000". */
  figure?: string;
  /**
   * `tick`, a short upright line across the track, for a reference such as a goal (in `outline`);
   * `dot`, a round mark on the track, for one of the owner's own values (in its tone).
   */
  kind?: 'tick' | 'dot';
  /** The colour of a `dot`. Left out, the bar's tone. */
  tone?: GlanceTone;
}

/** The drawing's height: the tallest mark, a tick. */
const RANGE_HEIGHT = 20;
const RANGE_TRACK = 4;
const RANGE_BAND = 8;
const RANGE_DOT = 12;
/** Between the drawing and a row of labels, and between two labels side by side. */
const LABEL_GAP = 6;
const LABEL_SPACING = 12;

/**
 * Where each label of a range bar goes, so none overlaps another: centred under its mark, kept
 * inside the bar's width, and moved to another lane when its neighbour is in the way. Lanes are
 * taken in this order: under the bar, over it, a second row under, a second row over, and so on,
 * so a label stays as close to its mark as it can. `anchors` and `widths` are in dp.
 */
export function placeLabels(anchors: readonly number[], widths: readonly number[], total: number, gap = LABEL_SPACING): { left: number; lane: number }[] {
  const order = anchors.map((_, i) => i).sort((a, b) => anchors[a] - anchors[b]);
  const laneEnds: number[] = [];
  const placed: { left: number; lane: number }[] = new Array(anchors.length);
  for (const i of order) {
    const w = Math.max(0, Math.min(widths[i], total));
    const left = Math.max(0, Math.min(total - w, anchors[i] - w / 2));
    let lane = 0;
    while (lane < laneEnds.length && left < laneEnds[lane] + gap) lane += 1;
    laneEnds[lane] = left + w;
    placed[i] = { left, lane };
  }
  return placed;
}

interface RangeLabel {
  key: string;
  /** Where the mark is, from 0 to 1 along the bar. */
  at: number;
  label: string;
  figure?: string;
  /** The figure's colour: the band's own figure takes the tone, so it reads as the band's. */
  figureColor?: string;
}

/**
 * A value against a range: a faint track for the scale (`min` to `max`), a band in the tone for a
 * range (`low` to `high`, such as an estimate known to within two ends), and marks along it: ticks
 * for references, dots for the owner's own values. Each mark's label sits beside it, under or
 * over the bar, never in a legend. `bandLabel` labels the band the same way.
 */
export function RangeBar({
  min,
  max,
  low,
  high,
  bandLabel,
  marks = [],
  tone = 'primary',
  surface,
  accessibilityLabel,
}: {
  min: number;
  max: number;
  low?: number;
  high?: number;
  /** The band's own label, under or over its middle: { label: "You burn", figure: "2,350–2,550" }. */
  bandLabel?: { label: string; figure?: string };
  marks?: readonly RangeMark[];
  tone?: GlanceTone;
  /** The colour of the card behind, which rings each dot so it stands clear of the band. Left out, `surfaceContainerHigh`. */
  surface?: string;
  /** The full sentence the bar replaces. */
  accessibilityLabel: string;
}) {
  const { colors, dark } = useTheme();
  const track = useTrack();
  const t = useToneColors(tone);
  const [width, setWidth] = useState(0);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const span = max > min ? max - min : 1;
  const at = (v: number) => clamp01((v - min) / span);
  const hasBand = low !== undefined && high !== undefined && Number.isFinite(low) && Number.isFinite(high);
  const bandFrom = hasBand ? at(Math.min(low, high)) : 0;
  const bandTo = hasBand ? at(Math.max(low, high)) : 0;

  const labels: RangeLabel[] = [];
  if (hasBand && bandLabel) labels.push({ key: `band:${bandLabel.label}`, at: (bandFrom + bandTo) / 2, ...bandLabel, figureColor: t.color });
  marks.forEach((m, i) => labels.push({ key: `${i}:${m.label}`, at: at(m.value), label: m.label, figure: m.figure }));

  const ready = width > 0 && labels.every((l) => sizes[l.key]);
  const placed = ready
    ? placeLabels(
        labels.map((l) => l.at * width),
        labels.map((l) => sizes[l.key].w),
        width,
      )
    : [];
  const rowHeight = ready ? Math.max(0, ...labels.map((l) => sizes[l.key].h)) : 0;
  const lanes = placed.reduce((n, p) => Math.max(n, p.lane + 1), 0);
  const rowsUnder = Math.ceil(lanes / 2);
  const rowsOver = Math.floor(lanes / 2);
  const barTop = rowsOver ? rowsOver * rowHeight + LABEL_GAP : 0;
  const height = barTop + RANGE_HEIGHT + (rowsUnder ? LABEL_GAP + rowsUnder * rowHeight : 0);
  const labelTop = (lane: number) => {
    const row = Math.floor(lane / 2);
    return lane % 2 === 0 ? barTop + RANGE_HEIGHT + LABEL_GAP + row * rowHeight : barTop - LABEL_GAP - (row + 1) * rowHeight;
  };
  const measure = (key: string) => (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSizes((old) => (old[key]?.w === w && old[key]?.h === h ? old : { ...old, [key]: { w, h } }));
  };

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}
      // Until the labels are measured, room for one row of them, so the card does not jump.
      style={{ height: ready ? height : labels.length ? RANGE_HEIGHT + LABEL_GAP + 16 : RANGE_HEIGHT }}>
      <View style={[styles.rangeDrawing, { top: barTop }]}>
        <View style={[styles.rangeTrack, { backgroundColor: track }]} />
        {hasBand ? (
          <View style={[styles.rangeBand, { left: percent(bandFrom), width: percent(bandTo - bandFrom), backgroundColor: t.color }]} />
        ) : null}
        {marks.map((m, i) =>
          m.kind === 'dot' ? (
            <View
              key={`${i}:${m.label}`}
              style={[
                styles.rangeDot,
                {
                  left: percent(at(m.value)),
                  backgroundColor: m.tone ? toneColors(m.tone, colors, dark).color : t.color,
                  borderColor: surface ?? colors.surfaceContainerHigh,
                },
              ]}
            />
          ) : (
            <View key={`${i}:${m.label}`} style={[styles.rangeTick, { left: percent(at(m.value)), backgroundColor: colors.outline }]} />
          ),
        )}
      </View>
      {labels.map((l, i) => (
        <View
          key={l.key}
          onLayout={measure(l.key)}
          style={[styles.rangeLabel, ready ? { left: placed[i].left, top: labelTop(placed[i].lane) } : styles.unmeasured]}>
          <AppText variant="labelMedium" color={colors.onSurfaceVariant} numberOfLines={1}>
            {l.label}
            {l.figure ? (
              <AppText variant="labelMedium" emphasized tabular color={l.figureColor ?? colors.onSurface}>
                {` ${keepUnits(l.figure)}`}
              </AppText>
            ) : null}
          </AppText>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- a share of a whole

export interface SplitSegment {
  /** One or two words: "Protein", "Weekends". */
  label: string;
  /** In any unit: the shares are worked out from the total. */
  value: number;
  /** What is written under the segment. Left out, its share as a whole per cent. */
  figure?: string;
  /**
   * Its colour: a tone, `neutral` (`outline`, for the part that is not the subject), or `error`,
   * which is only ever the part of a day over budget.
   */
  tone?: GlanceTone | 'neutral' | 'error';
  /** A colour of its own, such as one of `shadesOf()`. Wins over `tone`. */
  color?: string;
}

/** Below this share a segment is too narrow to carry its own label, and the labels become a key. */
const SPLIT_LABEL_SHARE = 0.18;

/**
 * Up to five steps of one colour, strongest first, for the parts of one subject (a day's meals, all
 * food): the colour at full strength, then lighter on the card behind it.
 */
export function shadesOf(color: string, count: number): string[] {
  const steps = [1, 0.72, 0.5, 0.34, 0.22];
  return Array.from({ length: count }, (_, i) => withAlpha(color, steps[Math.min(i, steps.length - 1)]));
}

/**
 * A share of a whole as one stacked bar, each part in its colour with a 2dp gap between them, and
 * under each part its figure and its name. When a part is too narrow for its words, the words go in
 * a key under the bar instead, each with a dot of its colour.
 */
export function SplitBar({
  segments,
  height = 12,
  accessibilityLabel,
}: {
  segments: readonly SplitSegment[];
  height?: number;
  /** The full sentence the bar replaces: "Calories: 24% from protein, 46% from carbs, 30% from fat." */
  accessibilityLabel: string;
}) {
  const { colors, dark } = useTheme();
  const shown = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = shown.reduce((sum, s) => sum + s.value, 0);
  if (shown.length === 0 || total <= 0) return null;
  const colourOf = (s: SplitSegment): string =>
    s.color ??
    (s.tone === 'neutral' ? colors.outline : s.tone === 'error' ? colors.error : toneColors(s.tone ?? 'primary', colors, dark).color);
  const parts = shown.map((s) => ({ ...s, share: s.value / total, colour: colourOf(s) }));
  const underSegments = parts.length <= 4 && parts.every((p) => p.share >= SPLIT_LABEL_SHARE);
  const figureOf = (p: (typeof parts)[number]) => p.figure ?? `${Math.round(p.share * 100)}%`;
  return (
    <View style={styles.split} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <StackedBar segments={parts.map((p) => ({ value: p.share, color: p.colour }))} height={height} />
      {underSegments ? (
        <View style={styles.splitLabels}>
          {parts.map((p, i) => (
            // The same flex share as the segment above, so each label starts where its part does.
            <View key={`${i}-${p.label}`} style={[styles.splitCell, { flexGrow: Math.max(1, Math.round(p.share * 1000)), minWidth: height }]}>
              <AppText variant="labelLarge" emphasized tabular numberOfLines={1}>
                {keepUnits(figureOf(p))}
              </AppText>
              <AppText variant="labelMedium" color={colors.onSurfaceVariant} numberOfLines={1}>
                {p.label}
              </AppText>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.key}>
          {parts.map((p, i) => (
            <View key={`${i}-${p.label}`} style={styles.keyItem}>
              <View style={[styles.keyDot, { backgroundColor: p.colour }]} />
              <AppText variant="labelMedium" color={colors.onSurfaceVariant} numberOfLines={1}>
                {p.label}
                <AppText variant="labelMedium" emphasized tabular color={colors.onSurface}>
                  {` ${keepUnits(figureOf(p))}`}
                </AppText>
              </AppText>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- days hit or missed

/**
 * One day: `hit` (the day reached it), `miss` (a counted day that did not), `today` (still open),
 * or `empty` (a day that does not count: nothing logged, or not a full day).
 */
export type DayMark = 'hit' | 'miss' | 'today' | 'empty';

/** Up to this many days are spread across the width with a label under each; more wrap in rows. */
const DAY_SPREAD = 10;

/**
 * Days hit or missed, as a row of dots: filled in the tone for a hit, a neutral ring for a miss, a
 * ring in the tone for today, which is still open, and a speck for a day that does not count. A
 * week is spread across the width with the day's initial under each dot; a month wraps in rows.
 */
export function DayDots({
  days,
  labels,
  tone = 'primary',
  accessibilityLabel,
}: {
  days: readonly DayMark[];
  /** One short label per day ("M", "T"), for a week. Today's is emphasised. */
  labels?: readonly string[];
  tone?: GlanceTone;
  /** The full sentence the dots replace: "Protein goal met on 5 of 7 days." */
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  const t = useToneColors(tone);
  const spread = days.length <= DAY_SPREAD;
  const size = spread ? 16 : 10;
  return (
    <View style={spread ? styles.daysSpread : styles.daysWrap} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {days.map((mark, i) => {
        const dot = <DayDot key={i} mark={mark} size={size} color={t.color} />;
        if (!spread) return dot;
        const label = labels?.[i];
        return (
          <View key={i} style={styles.dayColumn}>
            {dot}
            {label ? (
              <AppText
                variant="labelSmall"
                emphasized={mark === 'today'}
                color={mark === 'today' ? colors.onSurface : colors.onSurfaceVariant}
                numberOfLines={1}
                maxFontSizeMultiplier={1.5}>
                {label}
              </AppText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function DayDot({ mark, size, color }: { mark: DayMark; size: number; color: string }) {
  const { colors } = useTheme();
  const round = { width: size, height: size, borderRadius: size / 2 };
  switch (mark) {
    case 'hit':
      return <View style={[round, { backgroundColor: color }]} />;
    case 'miss':
      return <View style={[round, { borderWidth: 1.5, borderColor: colors.outline }]} />;
    case 'today':
      return <View style={[round, { borderWidth: 2, borderColor: color }]} />;
    case 'empty': {
      const speck = Math.max(3, Math.round(size * 0.3));
      return (
        <View style={[round, styles.centre]}>
          <View style={{ width: speck, height: speck, borderRadius: speck / 2, backgroundColor: colors.outlineVariant }} />
        </View>
      );
    }
  }
}

// ---------------------------------------------------------------- progress to a target

/**
 * Progress to a target as a small ring in the tone, with a short figure inside ("79%"). Once the
 * target is reached the ring becomes the sunny shape, filled, which is how the app marks a goal
 * reached (DESIGN.md, Shape).
 */
export function SmallRing({
  progress,
  label,
  size = 56,
  tone = 'primary',
  accessibilityLabel,
}: {
  /** From 0 to 1; 1 or more is reached. */
  progress: number;
  /** A few characters inside the ring. Left out, the per cent (or a tick once reached). */
  label?: string;
  size?: number;
  tone?: GlanceTone;
  /** The full sentence the ring replaces: "79% of the way from 77 kg to 72 kg." */
  accessibilityLabel: string;
}) {
  const t = useToneColors(tone);
  const track = useTrack();
  const { colors } = useTheme();
  const value = Number.isFinite(progress) ? progress : 0;
  const reached = value >= 1;
  const text = label ?? (reached ? undefined : `${Math.round(clamp01(value) * 100)}%`);
  // The ring does not grow with the font size, so its words grow only a little and step down on a small ring.
  const figure = text ? (
    <AppText
      variant={size >= 56 ? 'labelLarge' : 'labelMedium'}
      emphasized
      tabular
      color={reached ? t.on : colors.onSurface}
      numberOfLines={1}
      maxFontSizeMultiplier={1.15}>
      {text}
    </AppText>
  ) : null;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamp01(value) * 100) }}>
      {reached ? (
        <ShapeAvatar shape="sunny" size={size} color={t.color} icon={text ? undefined : 'check'} iconColor={t.on}>
          {figure}
        </ShapeAvatar>
      ) : (
        <MiniRing progress={clamp01(value)} size={size} stroke={Math.max(4, Math.round(size / 11))} color={t.color} trackColor={track}>
          {figure}
        </MiniRing>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- a few counts

export interface StatCell {
  icon: IconName;
  /** The number, with its unit when it has one: "24", "5 h 10 min". */
  figure: string;
  /** One or two words: "weigh-ins", "days logged". */
  label: string;
  /** The icon's colour: the subject the count is about. */
  tone?: GlanceTone;
  /** Left out, "24 weigh-ins". */
  spoken?: string;
}

/**
 * Two or three counts side by side, each an icon in its subject's colour, the figure, and one or
 * two words under it. No boxes and no dividers: the columns are enough.
 */
export function StatRow({ cells }: { cells: readonly StatCell[] }) {
  return (
    <View style={styles.stats}>
      {cells.map((cell, i) => (
        <Stat key={`${i}-${cell.label}`} {...cell} />
      ))}
    </View>
  );
}

function Stat({ icon, figure, label, tone = 'primary', spoken }: StatCell) {
  const { colors } = useTheme();
  const t = useToneColors(tone);
  return (
    <View style={styles.stat} accessible accessibilityLabel={spoken ?? `${figure} ${label}`}>
      <View style={styles.statHead}>
        <Icon name={icon} size={18} color={t.color} />
        <AppText variant="titleMedium" emphasized tabular numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.shrink}>
          {keepUnits(figure)}
        </AppText>
      </View>
      <AppText variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}

// ---------------------------------------------------------------- not enough data yet

/** Up to this many needed, the meter has one segment for each; more, and it is one bar. */
const UNLOCK_SEGMENTS = 14;
const UNLOCK_HEIGHT = 8;

/**
 * A figure that needs more data before it can be shown honestly: what it needs in a word or two,
 * how many there are of how many it needs, a segmented meter of the same (one segment for each,
 * 2dp apart, round at the ends, like a segmented group), and the one action that adds to it.
 * No icon of its own: the card's avatar and the button's icon already say what it is about.
 */
export function UnlockMeter({
  have,
  need,
  label,
  tone = 'primary',
  action,
  accessibilityLabel,
}: {
  have: number;
  need: number;
  /** What is being counted: "Weigh-ins", "Full days". */
  label: string;
  tone?: GlanceTone;
  /** The one step that adds to it, as a quiet tonal button. */
  action?: { label: string; icon?: IconName; onPress: () => void };
  /** The full reason the figure is not shown yet. Left out, "Weigh-ins: 3 of 7". */
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const t = useToneColors(tone);
  const track = useTrack();
  const total = Math.max(1, Math.round(Number.isFinite(need) ? need : 1));
  const count = Math.max(0, Math.min(total, Math.round(Number.isFinite(have) ? have : 0)));
  const segmented = total <= UNLOCK_SEGMENTS;
  const end = UNLOCK_HEIGHT / 2;
  const inner = Shape.extraSmall / 2;
  return (
    <View style={styles.unlock}>
      <View
        style={styles.unlockBody}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={accessibilityLabel ?? `${label}: ${count} of ${total}`}
        accessibilityValue={{ min: 0, max: total, now: count }}>
        <View style={styles.unlockHead}>
          <AppText variant="titleSmall" numberOfLines={2} style={styles.fill}>
            {label}
          </AppText>
          <AppText variant="labelLarge" tabular color={colors.onSurfaceVariant} numberOfLines={1}>
            <AppText variant="labelLarge" emphasized tabular color={colors.onSurface}>
              {String(count)}
            </AppText>
            {` of ${total}`}
          </AppText>
        </View>
        {segmented ? (
          <View style={styles.unlockSegments}>
            {Array.from({ length: total }, (_, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: UNLOCK_HEIGHT,
                  backgroundColor: i < count ? t.color : track,
                  borderTopLeftRadius: i === 0 ? end : inner,
                  borderBottomLeftRadius: i === 0 ? end : inner,
                  borderTopRightRadius: i === total - 1 ? end : inner,
                  borderBottomRightRadius: i === total - 1 ? end : inner,
                }}
              />
            ))}
          </View>
        ) : (
          <ProportionBar value={count / total} color={t.color} trackColor={track} height={UNLOCK_HEIGHT} />
        )}
      </View>
      {action ? <Button variant="tonal" title={action.label} icon={action.icon} onPress={action.onPress} hitSlop={4} style={styles.start} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- ranked items

export interface BarRowItem {
  name: string;
  /** The real number, right aligned: "4,320 kcal", "5 h 10 min". */
  figure: string;
  /** The bar's length from 0 to 1. Scale it to the largest item (`relativeToLargest`), not the total. */
  share: number;
  /** For a figure known only to within two ends: the bar stops at `share` and a thin line runs on to here. */
  upTo?: number;
  icon?: IconName;
  /** Left out, "Oats with banana, 4,320 kcal". */
  spoken?: string;
}

/**
 * Ranked items, one row each: an optional avatar, the name, the figure at the right, and a thin
 * bar under the name for its size against the others. The bar does the comparing, so no row needs
 * a "11% of your calories" line.
 */
export function BarRows({
  items,
  tone = 'primary',
  avatarTone,
}: {
  items: readonly BarRowItem[];
  tone?: GlanceTone;
  /** The avatars' tone. Left out, the container colour of `tone` (neutral for a macro). */
  avatarTone?: AvatarTone;
}) {
  const { colors } = useTheme();
  const t = useToneColors(tone);
  const track = useTrack();
  const avatar: AvatarTone = avatarTone ?? (tone === 'primary' || tone === 'secondary' || tone === 'tertiary' ? tone : 'neutral');
  return (
    <View style={styles.barRows}>
      {items.map((item, i) => (
        <View key={`${i}-${item.name}`} style={styles.barRow} accessible accessibilityLabel={item.spoken ?? `${item.name}, ${item.figure}`}>
          {item.icon ? <Avatar icon={item.icon} tone={avatar} size={32} /> : null}
          <View style={styles.barRowBody}>
            <View style={styles.barRowHead}>
              <AppText variant="titleSmall" numberOfLines={1} style={styles.fill}>
                {item.name}
              </AppText>
              <AppText variant="labelLarge" tabular color={colors.onSurfaceVariant} numberOfLines={1}>
                {keepUnits(item.figure)}
              </AppText>
            </View>
            <ProportionBar value={item.share} upTo={item.upTo} color={t.color} trackColor={track} height={6} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- how it's worked out

/** Emil Kowalski's strong ease-out: the movement starts at once, so the tap feels answered. */
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const OPEN_MS = 200;
const CLOSE_MS = 150;

/**
 * The foot of a card: "How it's worked out", and under it, one tap away, the words the card used
 * to carry (how the figure is built, what it leaves out, what to log). Strings among the children
 * are set as quiet paragraphs; anything else is shown as it is.
 *
 * It opens by growing to the height of what it holds while that fades in, 200ms on a strong
 * ease-out, and the chevron turns with it; it closes the same way in 150ms. Both are timings,
 * so a second tap mid-way turns the movement round from where it is. With the phone's "Remove
 * animations" on, nothing moves: the words only fade. While closed, what it holds is hidden from
 * a screen reader too.
 */
export function Disclosure({
  title = "How it's worked out",
  children,
  defaultOpen = false,
  onToggle,
  style,
}: {
  title?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(defaultOpen);
  const [contentHeight, setContentHeight] = useState(0);
  // How open it is, for the height and the chevron; and how visible the words are.
  const openness = useSharedValue(defaultOpen ? 1 : 0);
  const fade = useSharedValue(defaultOpen ? 1 : 0);

  useEffect(() => {
    const target = open ? 1 : 0;
    // Reduced motion is handled here, not by the system default, which would also skip the fade.
    const timing = { duration: open ? OPEN_MS : CLOSE_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.Never };
    fade.set(withTiming(target, timing));
    if (!reduceMotion) openness.set(withTiming(target, timing));
    // Only a fade: the room opens at once, and closes once the words have faded out.
    else openness.set(open ? 1 : withDelay(CLOSE_MS, withTiming(0, { duration: 0, reduceMotion: ReduceMotion.Never })));
  }, [open, reduceMotion, openness, fade]);

  const body = useAnimatedStyle(() => ({ height: openness.get() * contentHeight, opacity: fade.get() }));
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${openness.get() * 180}deg` }] }));

  const toggle = () => {
    setOpen(!open);
    onToggle?.(!open);
  };

  return (
    <View style={style}>
      <Tappable
        onPress={toggle}
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        rippleColor={withAlpha(colors.onSurfaceVariant, Alpha.pressed)}
        style={styles.disclosureHead}>
        <AppText variant="labelLarge" color={colors.onSurfaceVariant} numberOfLines={2} style={styles.fill}>
          {title}
        </AppText>
        <Animated.View style={chevron}>
          <Icon name="chevron-down" size={20} color={colors.onSurfaceVariant} />
        </Animated.View>
      </Tappable>
      <Animated.View
        style={[styles.disclosureBody, body]}
        pointerEvents={open ? 'auto' : 'none'}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        accessibilityElementsHidden={!open}>
        {/* Laid out at its own height whatever the room around it, so that height can be measured. */}
        <View style={styles.disclosureContent} onLayout={(e) => setContentHeight(Math.ceil(e.nativeEvent.layout.height))}>
          {Children.map(children, (child) =>
            typeof child === 'string' || typeof child === 'number' ? (
              <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
                {keepUnits(String(child))}
              </AppText>
            ) : (
              child
            ),
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  start: { alignSelf: 'flex-start' },
  centre: { alignItems: 'center', justifyContent: 'center' },

  figureRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.md, rowGap: Spacing.xs },
  delta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    minHeight: 28,
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.md,
    borderRadius: Shape.full,
  },

  rangeDrawing: { position: 'absolute', left: 0, right: 0, height: RANGE_HEIGHT },
  rangeTrack: { position: 'absolute', left: 0, right: 0, top: (RANGE_HEIGHT - RANGE_TRACK) / 2, height: RANGE_TRACK, borderRadius: RANGE_TRACK / 2 },
  rangeBand: { position: 'absolute', top: (RANGE_HEIGHT - RANGE_BAND) / 2, height: RANGE_BAND, minWidth: RANGE_BAND, borderRadius: RANGE_BAND / 2 },
  rangeTick: { position: 'absolute', top: 0, width: 2, height: RANGE_HEIGHT, marginLeft: -1, borderRadius: 1 },
  rangeDot: {
    position: 'absolute',
    top: (RANGE_HEIGHT - RANGE_DOT) / 2 - 2,
    width: RANGE_DOT + 4,
    height: RANGE_DOT + 4,
    marginLeft: -(RANGE_DOT + 4) / 2,
    borderRadius: (RANGE_DOT + 4) / 2,
    borderWidth: 2,
  },
  rangeLabel: { position: 'absolute' },
  unmeasured: { left: 0, top: RANGE_HEIGHT + LABEL_GAP, opacity: 0 },

  split: { gap: Spacing.sm },
  splitLabels: { flexDirection: 'row', gap: 2 },
  splitCell: { flexBasis: 0, paddingRight: Spacing.xs },
  key: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.lg, rowGap: Spacing.xs },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keyDot: { width: 8, height: 8, borderRadius: 4 },

  daysSpread: { flexDirection: 'row', justifyContent: 'space-between' },
  daysWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dayColumn: { alignItems: 'center', gap: Spacing.xs, minWidth: 16 },

  stats: { flexDirection: 'row', gap: Spacing.md },
  stat: { flex: 1, minWidth: 0, gap: 2 },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  unlock: { gap: Spacing.md },
  unlockBody: { gap: Spacing.sm },
  unlockHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  unlockSegments: { flexDirection: 'row', gap: 2 },

  barRows: { gap: Spacing.md },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  barRowBody: { flex: 1, minWidth: 0, gap: 6 },
  barRowHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },

  // A text-button-like row: its words line up with the card's content, its ripple is a pill around
  // them, and the 48dp target reaches into the space around it instead of adding to it.
  disclosureHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 48,
    marginVertical: -Spacing.sm,
    marginHorizontal: -Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Shape.full,
  },
  disclosureBody: { overflow: 'hidden' },
  disclosureContent: { position: 'absolute', left: 0, right: 0, top: 0, gap: Spacing.sm, paddingTop: Spacing.xs, paddingBottom: Spacing.xs },
});
