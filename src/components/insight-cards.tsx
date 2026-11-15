/**
 * The Progress tab's cards, in Today's language (docs/DESIGN.md, "Progress"), speaking in pictures
 * (DESIGN.md, "Show, don't tell (version 3)").
 *
 * Every card answers with one figure, one picture that shows where the figure sits, and at most one
 * line of words. What a card used to say in paragraphs (how a figure is worked out, what it leaves
 * out, what a word means) is one tap away under "How it's worked out" at its foot, and every picture
 * carries the sentence it replaced as its spoken label, so nothing honest is lost (PRODUCT.md).
 *
 * The pictures are the shared vocabulary in `glance.tsx`, each used for one kind of fact: a delta
 * chip for a change, a range bar for a value against a range, a split bar for a share of a whole,
 * day dots for days hit or missed, a small ring for progress to a target, a stat row for a few
 * counts, an unlock meter for data still to come, and bar rows for ranked items. The weight line
 * chart stays the screen's one memorable picture.
 *
 * The headline is the screen's one focal tile, in `primaryContainer`; everything else is quiet.
 * Colour tells the subject: food and weight in the primary, movement in the tertiary, the streak in
 * the secondary, protein, carbs and fat in their category colours.
 *
 * Every figure comes from `lib/insights.ts`; the wording and the shape of each picture's data from
 * `lib/progress-view.ts`. Nothing is worked out here.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { categoryColors, type Category } from '@/constants/category-colors';
import { Alpha, AVATAR_SIZE, Shape, Spacing, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatShortDate } from '@/lib/dates';
import { formatMinutes } from '@/lib/exercise';
import {
  PROTEIN_HIT_SHARE,
  whatShowsUpHere,
  type CaloriesInfo,
  type ConsistencyInfo,
  type DaySummary,
  type ExerciseInfo,
  type InsightAction,
  type Insights,
  type MacroAverage,
  type MacrosInfo,
  type MaintenanceInfo,
  type NotReady,
  type PatternsInfo,
  type TargetsSuggestion,
  type TopFood,
  type Unlock,
  type WeekBlock,
  type WeightInfo,
} from '@/lib/insights';
import { formatKcal } from '@/lib/nutrition';
import {
  averageVsGoalText,
  burnLine,
  burnScale,
  calorieChartBars,
  calorieDelta,
  chartRows,
  describeCalendar,
  describeCalorieChart,
  describeExerciseChart,
  describeWeekdayChart,
  describeWeightChart,
  exerciseChartBars,
  glanceText,
  goalProgressText,
  headlineView,
  kcalScale,
  maintenanceBasisText,
  mealsSpoken,
  percentText,
  periodAxis,
  plural,
  proteinDayMarks,
  recalcLine,
  recalcSummary,
  relativeToLargest,
  targetsDelta,
  weekdayChartBars,
  weekRowText,
  weekSplitLine,
  weightChartMarks,
  weightLine,
  weightRateDelta,
  WEEKDAY_AXIS,
  type DeltaView,
  type GlanceKey,
  type HeadlineFigure,
} from '@/lib/progress-view';
import { formatKg, roundKg } from '@/lib/weight';
import { BarChart, CalendarGrid, DOT_ALPHA, FADED_ALPHA, Legend, LineChart, MiniBars, MiniLineChart, ProportionBar, TENTATIVE_ALPHA, type LegendEntry } from './charts';
import { ShapeAvatar } from './expressive';
import {
  BarRows,
  DayDots,
  Disclosure,
  GlanceFigure,
  RangeBar,
  shadesOf,
  SmallRing,
  SplitBar,
  StatRow,
  UnlockMeter,
  type DeltaChipProps,
  type GlanceTone,
  type RangeMark,
  type StatCell,
} from './glance';
import { keepUnits } from './screen-text';
import { foodIcon } from './today-tiles';
import { AppText, Avatar, Button, Group, GroupItem, GroupRow, Icon, SectionHeader, Tappable, type AvatarTone, type GroupCorners, type IconName } from './ui';

export type InsightActionHandler = (action: InsightAction) => void;

/** A part of the page the glance tiles and the header's jump button can scroll to. */
export type SectionKey = 'weight' | 'calories' | 'exercise' | 'consistency' | 'everyDay';

type Period = Insights['period'];

const ACTION_LABEL: Record<InsightAction, string> = {
  'log-weight': 'Log weight',
  'log-food': 'Log food',
  'log-exercise': 'Log exercise',
  'set-goal': 'Set a target weight',
  // A figure that needs more than a week: the button switches the period, it does not say "switch".
  'longer-period': 'Show 30 days',
};

const ACTION_ICON: Record<InsightAction, IconName> = {
  'log-weight': 'scale-bathroom',
  'log-food': 'plus',
  'log-exercise': 'run',
  'set-goal': 'target',
  'longer-period': 'calendar-range',
};

/** What sits at the end of an unlit row: a plus for something to log, otherwise where the tap leads. */
const ACTION_CUE: Record<InsightAction, IconName> = {
  'log-weight': 'plus',
  'log-food': 'plus',
  'log-exercise': 'plus',
  'set-goal': 'chevron-right',
  'longer-period': 'calendar-range',
};

const DELTA_ICON: Record<DeltaView['direction'], IconName> = { up: 'arrow-up', down: 'arrow-down', flat: 'trending-neutral' };

/** A change from `progress-view` as the kit's delta chip, in the subject's tone. */
const toChip = (d: DeltaView | null, tone: 'primary' | 'tertiary' = 'primary'): DeltaChipProps | undefined =>
  d ? { direction: d.direction, amount: d.amount, towardGoal: d.towardGoal, tone, accessibilityLabel: d.spoken } : undefined;

/**
 * The last two words held together, so a line in a half-width tile never ends on one word alone at
 * a large font size ("Losing 0.5 kg a / week" becomes "Losing 0.5 kg / a week").
 */
const noOrphan = (text: string): string => text.replace(/ (\S+)$/, ' $1');

/** Lines for a card's foot, without the empty ones. */
const lines = (...all: (string | null | undefined | false)[]): string[] => all.filter((l): l is string => typeof l === 'string' && l.length > 0);

// ---------------------------------------------------------------- building blocks

/** The icon at the end of an unlit row or tile. Only a cue: the whole surface is the button. */
function Cue({ icon = 'plus', color }: { icon?: IconName; color?: string }) {
  return (
    <View importantForAccessibility="no-hide-descendants">
      <Icon name={icon} size={24} color={color} />
    </View>
  );
}

/** A chart card: 28dp corners, its figure first, its picture, at most one line, then its foot. */
function ChartCard({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.surfaceContainerHigh }]}>{children}</View>;
}

/** The foot of a card: the words it used to carry, one tap away. Nothing when there is nothing to say. */
function HowItsWorkedOut({ paragraphs, title }: { paragraphs: string[]; title?: string }) {
  if (paragraphs.length === 0) return null;
  return <Disclosure title={title}>{paragraphs}</Disclosure>;
}

/** The one line a card may have: what its picture means, in the owner's words. */
function Line({ children, strong }: { children: string; strong?: boolean }) {
  const { colors } = useTheme();
  return (
    <AppText variant={strong ? 'bodyLarge' : 'bodyMedium'} color={strong ? colors.onSurface : colors.onSurfaceVariant}>
      {keepUnits(children)}
    </AppText>
  );
}

/** The small name over one picture of a card that has more than one. */
function SubLabel({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <AppText variant="labelLarge" color={colors.onSurfaceVariant}>
      {children}
    </AppText>
  );
}

/** The one next step of a card: a quiet tonal pill, 40dp with a 48dp target. */
function ActionButton({ action, onAction, spoken }: { action: InsightAction; onAction: InsightActionHandler; spoken?: string }) {
  return (
    <Button
      variant="tonal"
      title={ACTION_LABEL[action]}
      icon={ACTION_ICON[action]}
      onPress={() => onAction(action)}
      hitSlop={4}
      accessibilityLabel={spoken}
      style={styles.start}
    />
  );
}

/**
 * A step that only switches to the month: the card's own picture and its "From the last 30 days"
 * line already point there, so the sentence saying a week is too short is in the card's foot.
 */
const onlyNeedsMonth = (card: NotReady): boolean => card.action === 'longer-period' && !card.progress;

/**
 * A figure that is not ready yet. When what it waits for is a count, it is a meter of what there is
 * against what it needs, with the step that adds to it; its reason is the meter's spoken label (and
 * goes in the card's foot). When the step is only "Show 30 days", the button alone, its reason
 * spoken with it and written in the foot. Otherwise the reason in one line, and the step.
 */
function Pending({ card, onAction, tone, quiet }: { card: NotReady; onAction: InsightActionHandler; tone?: GlanceTone; quiet?: boolean }) {
  // `quiet`: the card already offers this step once, so this one only says why.
  const action = quiet ? undefined : card.action;
  if (action && onlyNeedsMonth(card)) return <ActionButton action={action} onAction={onAction} spoken={`${card.reason} ${ACTION_LABEL[action]}`} />;
  if (card.progress) {
    return (
      <UnlockMeter
        have={card.progress.have}
        need={card.progress.need}
        label={card.progress.label}
        tone={tone}
        action={action ? { label: ACTION_LABEL[action], icon: ACTION_ICON[action], onPress: () => onAction(action) } : undefined}
        accessibilityLabel={card.reason}
      />
    );
  }
  return (
    <View style={styles.block}>
      <Line>{card.reason}</Line>
      {action ? <ActionButton action={action} onAction={onAction} /> : null}
    </View>
  );
}

/**
 * A card that cannot be shown yet. Waiting on a count, it is a small card with the meter and its one
 * step, and the reason under "What it takes". Otherwise one unlit row: a ring avatar, what to do in
 * the headline, the reason under it and a cue at the end; the whole row is the button. With nothing
 * to do but wait, it is the reason alone.
 */
function NotReadyTile({ icon, card, onAction, tone }: { icon: IconName; card: NotReady; onAction: InsightActionHandler; tone?: GlanceTone }) {
  const action = card.action;
  if (card.progress) {
    return (
      <ChartCard>
        <Pending card={card} onAction={onAction} tone={tone} />
        <HowItsWorkedOut title="What it takes" paragraphs={[card.reason]} />
      </ChartCard>
    );
  }
  if (!action) {
    return (
      <Group>
        <GroupItem style={styles.waitingRow}>
          <Avatar icon={icon} tone="ring" />
          <AppText variant="bodyLarge" style={styles.fill}>
            {keepUnits(card.reason)}
          </AppText>
        </GroupItem>
      </Group>
    );
  }
  return (
    <Group>
      <GroupRow
        icon={icon}
        tone="ring"
        headline={ACTION_LABEL[action]}
        supporting={keepUnits(card.reason)}
        trailing={<Cue icon={ACTION_CUE[action]} />}
        onPress={() => onAction(action)}
        accessibilityLabel={`${card.reason} ${ACTION_LABEL[action]}`}
      />
    </Group>
  );
}

/**
 * One row of a segmented group, with `GroupRow`'s measures: a round avatar, a `titleMedium`
 * headline, quiet lines under it and a figure at the right. It differs from `GroupRow` in three
 * ways this tab needs: several supporting lines, a figure with what it is under it, and a spoken
 * label on a row that is not a button. Inside a `Group` it takes its corners from its place; a row
 * of a FlatList passes `corners`.
 */
export function ListRow({
  icon,
  tone,
  leading,
  headline,
  lines: rowLines = [],
  below,
  figure,
  onPress,
  corners,
  spoken,
}: {
  /** The icon of a leading `Avatar` in `tone`. */
  icon?: IconName;
  tone?: AvatarTone;
  /** Anything else in the leading slot, such as a day's ring. */
  leading?: ReactNode;
  headline: string;
  lines?: (string | null)[];
  /** Drawn under the lines, such as a row of small figures. */
  below?: ReactNode;
  /** The row's number, right aligned, with what it is under it. */
  figure?: { value: string; label?: string };
  onPress?: () => void;
  /** From `groupCorners()`, for a row outside a `Group`. */
  corners?: GroupCorners;
  spoken: string;
}) {
  const { colors } = useTheme();
  const shown = rowLines.filter((line): line is string => !!line);
  const layout = [styles.row, { minHeight: shown.length || below ? 72 : 56 }];
  const content = (
    <>
      {leading ?? (icon ? <Avatar icon={icon} tone={tone} /> : null)}
      <View style={[styles.fill, styles.rowBody]}>
        <AppText variant="titleMedium" numberOfLines={2}>
          {headline}
        </AppText>
        {shown.map((line) => (
          <AppText key={line} variant="bodyMedium" color={colors.onSurfaceVariant} textBreakStrategy="balanced">
            {keepUnits(line)}
          </AppText>
        ))}
        {below}
      </View>
      {figure ? (
        <View style={styles.rowFigure}>
          <AppText variant="titleMedium" numberOfLines={1} tabular>
            {keepUnits(figure.value)}
          </AppText>
          {figure.label ? (
            <AppText variant="labelMedium" color={colors.onSurfaceVariant} numberOfLines={2} style={styles.rowFigureLabel}>
              {figure.label}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </>
  );
  if (onPress) {
    return (
      <GroupItem onPress={onPress} corners={corners} accessibilityLabel={spoken} style={layout}>
        {content}
      </GroupItem>
    );
  }
  return (
    <GroupItem corners={corners}>
      <View style={layout} accessible accessibilityLabel={spoken}>
        {content}
      </View>
    </GroupItem>
  );
}

// ---------------------------------------------------------------- 1. headline

const TONE_ICON: Record<'down' | 'up' | 'steady' | 'neutral', IconName> = {
  down: 'trending-down',
  up: 'trending-up',
  steady: 'trending-neutral',
  neutral: 'chart-timeline-variant',
};

/** A quiet button on the focal tile: a tint of the tile's own content colour, so it shows on any container. */
function FocalButton({ label, icon, onPress, style }: { label: string; icon: IconName; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const on = colors.onPrimaryContainer;
  return (
    <Tappable
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={{ top: 4, bottom: 4 }}
      rippleColor={withAlpha(on, Alpha.pressed)}
      style={[styles.focalButton, { backgroundColor: withAlpha(on, Alpha.track) }, style]}>
      <Icon name={icon} size={18} color={on} />
      <AppText variant="labelLarge" color={on} numberOfLines={1} style={styles.shrink}>
        {label}
      </AppText>
    </Tappable>
  );
}

/**
 * A change on the focal tile: the kit's delta chip in the tile's own colours. On `primaryContainer`
 * a chip filled with that same container would vanish, so it is a tint of the tile's content colour,
 * like the tile's buttons, whichever way the change goes.
 */
function FocalChip({ delta }: { delta: DeltaView }) {
  const { colors } = useTheme();
  const on = colors.onPrimaryContainer;
  return (
    <View style={[styles.focalChip, { backgroundColor: withAlpha(on, Alpha.track) }]}>
      <Icon name={DELTA_ICON[delta.direction]} size={16} color={on} />
      <AppText variant="labelLarge" emphasized tabular color={on} numberOfLines={1} maxFontSizeMultiplier={1.5}>
        {keepUnits(delta.amount)}
      </AppText>
    </View>
  );
}

/** A figure on the focal tile: the number, what it is in a quieter voice beside it, and its change. */
function FocalFigure({ figure, hero }: { figure: HeadlineFigure; hero?: boolean }) {
  const { colors } = useTheme();
  const on = colors.onPrimaryContainer;
  return (
    <View style={styles.figureRow}>
      <AppText variant={hero ? 'headlineLarge' : 'titleLarge'} emphasized tabular color={on}>
        {keepUnits(figure.value)}
        <AppText variant="bodyLarge" color={on}>{` ${figure.unit}`}</AppText>
      </AppText>
      {figure.delta ? <FocalChip delta={figure.delta} /> : null}
    </View>
  );
}

/**
 * The one focal tile, and the screen's hero moment: the most important fact of the period as a
 * figure, the average intake under a weight change, and what it all stands on as a row of counts.
 * Its sentence is its spoken label. With nothing to say yet it asks for the first log, and logging
 * food is the one strong fill on the screen.
 */
export function HeadlineTile({ insights, onAction }: { insights: Insights; onAction: InsightActionHandler }) {
  const { colors } = useTheme();
  const on = colors.onPrimaryContainer;
  const headline = insights.headline;
  const period = `Last ${insights.period.days} days`;

  if (!headline.ready) {
    return (
      <View style={[styles.focal, { backgroundColor: colors.primaryContainer }]}>
        <View style={styles.focalHeader}>
          <Icon name="chart-timeline-variant" size={24} color={on} />
          <AppText variant="titleMedium" color={on}>
            {period}
          </AppText>
        </View>
        <AppText variant="headlineSmall" emphasized color={on}>
          {keepUnits(headline.reason)}
        </AppText>
        {/* Food on its own row, then the other two side by side: the split is meant, not where the text happened to wrap. */}
        <View style={styles.focalActions}>
          <Button variant="filled" size="large" title="Log food" icon="plus" onPress={() => onAction('log-food')} />
          <View style={styles.actions}>
            <FocalButton label="Log weight" icon="scale-bathroom" onPress={() => onAction('log-weight')} style={styles.share} />
            <FocalButton label="Log exercise" icon="run" onPress={() => onAction('log-exercise')} style={styles.share} />
          </View>
        </View>
      </View>
    );
  }

  const view = headlineView(insights);
  // What the figures are built on, so a headline from four days does not read like one from thirty.
  // Meals are counted in full days, because those are the days the average is over. The workouts
  // are said but not drawn: no figure here stands on them, and the exercise tile right under this
  // one draws the same count.
  const basis: { icon: IconName; count: number; label: string }[] = [];
  const fullDays = insights.calories.ready ? insights.calories.completeDays : 0;
  if (fullDays > 0) basis.push({ icon: 'silverware-fork-knife', count: fullDays, label: fullDays === 1 ? 'full day' : 'full days' });
  if (insights.weight.ready) basis.push({ icon: 'scale-bathroom', count: insights.weight.weighIns, label: insights.weight.weighIns === 1 ? 'weigh-in' : 'weigh-ins' });
  const said = insights.exercise.ready
    ? [...basis, { count: insights.exercise.workouts, label: insights.exercise.workouts === 1 ? 'workout' : 'workouts' }]
    : basis;
  const basisSpoken = said.length ? ` From ${said.map((b) => `${b.count} ${b.label}`).join(', ')}.` : '';

  return (
    <View style={[styles.focal, { backgroundColor: colors.primaryContainer }]} accessible accessibilityLabel={`${period}. ${headline.text}${basisSpoken}`}>
      <View style={styles.focalHeader}>
        <Icon name={TONE_ICON[headline.tone]} size={24} color={on} />
        <AppText variant="titleMedium" color={on}>
          {period}
        </AppText>
      </View>
      <View style={styles.focalFigures}>
        {view.figure ? <FocalFigure figure={view.figure} hero /> : null}
        {view.second ? <FocalFigure figure={view.second} /> : null}
        {view.meter ? <UnlockMeter have={view.meter.have} need={view.meter.need} label={view.meter.label} /> : null}
        {view.line ? (
          <AppText variant="bodyLarge" color={on}>
            {keepUnits(view.line)}
          </AppText>
        ) : null}
        {/* Nothing to draw: the sentence itself. */}
        {!view.figure && !view.meter ? (
          <AppText variant="headlineSmall" emphasized color={on}>
            {keepUnits(headline.text)}
          </AppText>
        ) : null}
      </View>
      {basis.length ? (
        // The same counts as a stat row, in the tile's own colour: an icon, the number, and what it counts.
        <View style={styles.basis}>
          {basis.map((b) => (
            <View key={b.label} style={styles.basisItem}>
              <View style={styles.basisHead}>
                <Icon name={b.icon} size={18} color={on} />
                <AppText variant="titleMedium" emphasized tabular color={on} numberOfLines={1}>
                  {b.count}
                </AppText>
              </View>
              <AppText variant="bodySmall" color={on} numberOfLines={2}>
                {b.label}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const UNLOCK_ICON: Record<Unlock['card'], IconName> = {
  weight: 'scale-bathroom',
  calories: 'silverware-fork-knife',
  maintenance: 'fire',
  patterns: 'lightbulb-on-outline',
};

/**
 * What an empty app shows under the headline, in place of a not-ready row for every card: one
 * group listing what will appear and what each takes, every row unlit. The lines, thresholds
 * included, are the data layer's.
 */
export function WhatShowsUpTile() {
  return (
    <View>
      <SectionHeader title="What shows up here" />
      <Group>
        {whatShowsUpHere().map((unlock) => (
          <ListRow
            key={unlock.card}
            icon={UNLOCK_ICON[unlock.card]}
            tone="ring"
            headline={unlock.title}
            lines={[unlock.needs]}
            spoken={`${unlock.title}. ${unlock.needs}.`}
          />
        ))}
      </Group>
    </View>
  );
}

// ---------------------------------------------------------------- the glance grid

const GLANCE_ORDER: GlanceKey[] = ['weight', 'calories', 'exercise', 'streak'];
const GLANCE_ICON: Record<GlanceKey, IconName> = {
  weight: 'scale-bathroom',
  calories: 'silverware-fork-knife',
  exercise: 'run',
  streak: 'calendar-check',
};
const GLANCE_SECTION: Record<GlanceKey, SectionKey> = { weight: 'weight', calories: 'calories', exercise: 'exercise', streak: 'consistency' };
/** How many of the latest days a tile's bars show: what its width has room for. The answer beside them is for the whole period. */
const GLANCE_DAYS: Record<'calories' | 'exercise', number> = { calories: 7, exercise: 30 };
const GLANCE_AVATAR = 36;

/**
 * Four small tiles under the headline, so the first screen answers "how am I doing" without
 * scrolling. Each carries one answer from its card and a small picture of its own data, and
 * scrolls to that card when tapped. Weight and calories stay neutral, with their avatar in the
 * primary; exercise is lit in the tertiary once the period has a workout, and the streak in the
 * secondary with its cookie badge. A tile with nothing behind it is unlit: a ring avatar, what to
 * log, and a plus, and it logs it.
 */
export function GlanceGrid({
  insights,
  onAction,
  onJump,
}: {
  insights: Insights;
  onAction: InsightActionHandler;
  onJump: (section: SectionKey) => void;
}) {
  const { colors } = useTheme();
  const text = glanceText(insights);
  const { weight, calories, exercise, consistency, period } = insights;
  const streak = consistency.ready ? consistency.streak : null;

  const marks = weight.ready ? weightChartMarks(weight, period) : null;
  const pictures: Record<GlanceKey, ReactNode> = {
    // The Weight card's chart in small: on the same scale, so two weigh-ins 0.3 kg apart do not look like a climb.
    weight:
      weight.ready && marks ? (
        <MiniLineChart
          points={marks.points}
          line={marks.line}
          tentative={marks.tentative}
          days={period.chartDays}
          yMin={weight.chart.yMin}
          yMax={weight.chart.yMax}
        />
      ) : null,
    calories: calories.ready ? <MiniBars bars={calorieChartBars(calories.bars.slice(-GLANCE_DAYS.calories))} /> : null,
    // A week of workouts is two or three bars; a month shows the rhythm.
    exercise: exercise.ready ? (
      <MiniBars
        bars={exerciseChartBars(chartRows(exercise.daily, period).slice(-GLANCE_DAYS.exercise))}
        axisColor={withAlpha(colors.onTertiaryContainer, Alpha.track)}
      />
    ) : null,
    // The same badge as in Today's header: lit in the primary once today is logged, a tint of the tile before.
    streak:
      streak && streak.current > 0 ? (
        <ShapeAvatar shape="cookie9" size={AVATAR_SIZE} color={streak.loggedToday ? colors.primary : withAlpha(colors.onSecondaryContainer, Alpha.track)}>
          <AppText
            variant="titleSmall"
            emphasized
            color={streak.loggedToday ? colors.onPrimary : colors.onSecondaryContainer}
            numberOfLines={1}
            maxFontSizeMultiplier={1.15}
            tabular>
            {streak.current}
          </AppText>
        </ShapeAvatar>
      ) : null,
  };
  // A lit tile takes its subject's container. Food and weight stay on the neutral surface here: the focal tile above is theirs.
  const lit: Record<GlanceKey, { container: string; on: string } | null> = {
    weight: null,
    calories: null,
    exercise: { container: colors.tertiaryContainer, on: colors.onTertiaryContainer },
    streak: { container: colors.secondaryContainer, on: colors.onSecondaryContainer },
  };

  return (
    <View style={styles.grid}>
      {GLANCE_ORDER.map((key) => {
        const t = text[key];
        const action = t.waiting ? t.action : null;
        const look = t.waiting ? null : lit[key];
        const fg = look ? look.on : colors.onSurface;
        const quiet = look ? look.on : colors.onSurfaceVariant;
        return (
          <Tappable
            key={key}
            onPress={() => (action ? onAction(action) : onJump(GLANCE_SECTION[key]))}
            accessibilityLabel={t.spoken}
            rippleColor={withAlpha(fg, Alpha.pressed)}
            style={[styles.glance, { backgroundColor: look ? look.container : colors.surfaceContainerHigh }]}>
            <View style={styles.glanceTop}>
              <Avatar icon={GLANCE_ICON[key]} tone={t.waiting ? 'ring' : 'primary'} tint={look ? look.on : undefined} size={GLANCE_AVATAR} />
              {t.waiting ? action ? <Cue /> : null : pictures[key]}
            </View>
            <View>
              <AppText variant="titleMedium" emphasized color={fg} numberOfLines={2}>
                {noOrphan(keepUnits(t.title))}
              </AppText>
              <AppText variant="bodyMedium" color={quiet} numberOfLines={3}>
                {noOrphan(keepUnits(t.detail))}
              </AppText>
            </View>
          </Tappable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- 2. weight

/** How to read the chart's line, in one sentence. Shown only when the line is drawn. */
const LINE_NOTE = 'The line is the steady direction through your weigh-ins, and single weigh-ins swing around it.';
/** The same, for a line that is the fit and no more: the card names no direction, so the note must not either. */
const TENTATIVE_LINE_NOTE = 'The line is the closest straight line through your weigh-ins, which still swing too much around it to call a direction.';

/**
 * Where the target stands: a small ring with how far along the owner is (the sunny shape once it is
 * reached), and the date the rate gives as the line beside it. With no target, the step to set one.
 */
function TargetRow({ w, onAction }: { w: WeightInfo; onAction: InsightActionHandler }) {
  const goal = w.goal;
  const text = w.projection.text;
  if (!goal) {
    return (
      <View style={styles.finding}>
        <Avatar icon="target" tone="ring" />
        <View style={styles.findingBody}>
          <Line strong>{text}</Line>
          <ActionButton action="set-goal" onAction={onAction} />
        </View>
      </View>
    );
  }
  const progress = goal.reached ? 1 : goal.progress;
  return (
    <View style={[styles.finding, styles.centred]}>
      {progress !== null ? (
        <SmallRing progress={progress} accessibilityLabel={goal.reached ? text : goalProgressText(goal)} />
      ) : (
        <Avatar icon="flag-checkered" tone="primary" />
      )}
      <View style={styles.findingBody}>
        <Line strong>{text}</Line>
      </View>
    </View>
  );
}

/** New targets for the current weight: the calories against now, the three macros, and why. */
function RecalcCard({
  recalc,
  onRecalculate,
  onKeepTargets,
}: {
  recalc: TargetsSuggestion;
  onRecalculate: (toKg: number) => void;
  onKeepTargets: (toKg: number) => void;
}) {
  const { colors } = useTheme();
  const t = recalc.targets;
  const macros: StatCell[] = [
    { icon: 'egg-outline', figure: `${Math.round(t.protein)} g`, label: 'protein', tone: 'protein' },
    { icon: 'bread-slice-outline', figure: `${Math.round(t.carbs)} g`, label: 'carbs', tone: 'carbs' },
    { icon: 'water-outline', figure: `${Math.round(t.fat)} g`, label: 'fat', tone: 'fat' },
  ];
  return (
    <View style={[styles.suggestion, { backgroundColor: colors.surfaceContainerHigh }]}>
      <View style={styles.cardHead}>
        <Avatar icon="calculator-variant-outline" tone="primary" />
        <AppText variant="titleMedium" emphasized style={styles.fill}>
          {`New targets for ${formatKg(recalc.toKg)}`}
        </AppText>
      </View>
      <GlanceFigure
        value={formatKcal(t.calories)}
        unit="kcal a day"
        delta={toChip(targetsDelta(recalc))}
        accessibilityLabel={`${recalc.text} ${recalcSummary(recalc)}`}
      />
      <StatRow cells={macros} />
      <Line>{recalcLine(recalc)}</Line>
      {/* A suggestion can be declined: it then stays away until the weight has moved as far again. */}
      <View style={styles.actions}>
        <Button variant="tonal" title="Use new targets" icon="check" onPress={() => onRecalculate(recalc.toKg)} hitSlop={4} />
        <Button variant="text" title="Keep my targets" onPress={() => onKeepTargets(recalc.toKg)} hitSlop={4} />
      </View>
    </View>
  );
}

/**
 * Weight: the latest weigh-in with the rate as a chip, the chart (the screen's one memorable
 * picture), and the target as a small ring. Under it, when the weight has moved far enough from the
 * one the targets were set at, a card that offers new ones.
 */
function WeightGroup({
  w,
  period,
  onAction,
  onRecalculate,
  onKeepTargets,
}: {
  w: WeightInfo;
  period: Period;
  onAction: InsightActionHandler;
  onRecalculate: (toKg: number) => void;
  onKeepTargets: (toKg: number) => void;
}) {
  const { colors } = useTheme();
  const rate = w.rate;
  const goal = w.goal;
  const goalKg = w.chart.goalKg;
  const today = w.latest.date === period.to;
  // The chart opens on the first day anything was logged; the line is the one the card's figures come from.
  const marks = weightChartMarks(w, period);
  const delta = weightRateDelta(rate);
  const line = weightLine(w, period.to);
  // A week sends the owner to the month as the card's last step; anything else to log comes first.
  const pendingFirst = !rate.ready && rate.action !== 'longer-period';

  const legend: LegendEntry[] = [{ mark: 'dot', color: withAlpha(colors.primary, DOT_ALPHA), label: 'Weigh-in' }];
  if (marks.line) {
    legend.push(
      marks.tentative
        ? { mark: 'line', color: withAlpha(colors.primary, TENTATIVE_ALPHA), label: 'Direction, not clear yet' }
        : { mark: 'line', color: colors.primary, label: 'Direction' },
    );
  }
  if (goalKg !== null && !w.chart.goalOffChart) legend.push({ mark: 'dash', color: colors.outline, label: `Target ${formatKg(goalKg)}` });

  // The figure already says when the latest weigh-in was.
  const foot = lines(
    rate.ready ? `${rate.rateText}. ${rate.changeText}.` : rate.reason,
    rate.ready ? `Smoothed: ${formatKg(rate.nowKg)}, your weight on the day of your latest weigh-in with the day-to-day swings taken out.` : null,
    w.weekAverages?.text,
    marks.line ? (marks.tentative ? TENTATIVE_LINE_NOTE : LINE_NOTE) : null,
    goalKg !== null && w.chart.goalOffChart ? `Your ${formatKg(goalKg)} target is ${w.chart.goalOffChart} this chart.` : null,
    goal && !goal.reached ? goalProgressText(goal) : null,
  );

  return (
    <View style={styles.group}>
      <ChartCard>
        <GlanceFigure
          value={roundKg(w.latest.kg).toFixed(1)}
          unit={today ? 'kg today' : `kg on ${formatShortDate(w.latest.date)}`}
          delta={toChip(delta)}
          accessibilityLabel={`Latest weigh-in ${formatKg(w.latest.kg)}, ${today ? 'today' : formatShortDate(w.latest.date)}.${delta ? ` ${delta.spoken}` : ''}`}
        />
        {line ? <Line>{line}</Line> : null}
        {pendingFirst && !rate.ready ? <Pending card={rate} onAction={onAction} /> : null}
        <View style={styles.block}>
          <LineChart
            points={marks.points}
            line={marks.line}
            tentative={marks.tentative}
            days={period.chartDays}
            yMin={w.chart.yMin}
            yMax={w.chart.yMax}
            goal={w.chart.goalOffChart ? null : goalKg}
            axis={periodAxis(period.chartFrom, period.chartDays, period.to)}
            accessibilityLabel={describeWeightChart(w, period.to)}
          />
          <Legend items={legend} />
        </View>
        <TargetRow w={w} onAction={onAction} />
        {!pendingFirst && !rate.ready ? <Pending card={rate} onAction={onAction} /> : null}
        <HowItsWorkedOut paragraphs={foot} />
      </ChartCard>

      {w.recalc ? <RecalcCard recalc={w.recalc} onRecalculate={onRecalculate} onKeepTargets={onKeepTargets} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- 3. calories

/** The average and its chip, the days as bars against the goal, and three counts. The words are in the foot. */
function CaloriesCard({ c, period, onAction }: { c: CaloriesInfo; period: Period; onAction: InsightActionHandler }) {
  const { colors } = useTheme();
  const average = c.average;
  const bars = calorieChartBars(chartRows(c.bars, period));

  // A bar is the primary up to that day's budget; only what is above it is marked.
  const legend: LegendEntry[] = [{ mark: 'box', color: colors.primary, label: 'Within budget' }];
  if (bars.some((b) => b.limit !== undefined)) legend.push({ mark: 'box', color: colors.error, label: 'Over budget' });
  if (bars.some((b) => b.value !== null && b.tone === 'faded')) {
    legend.push({ mark: 'box', color: withAlpha(colors.primary, FADED_ALPHA), label: 'Not in the average' });
  }

  const averageWords = average.ready ? `Across ${plural(average.days, 'full day')}. ${averageVsGoalText(average.vsGoal, c.goal)}.` : average.reason;
  const foot = lines(
    averageWords,
    c.budgetText,
    c.note,
    `A full day has at least ${formatKcal(period.completeDayKcal)} kcal logged.`,
    period.firstLoggedDate && period.firstLoggedDate > period.from ? `Days are counted from your first log on ${formatShortDate(period.firstLoggedDate)}.` : null,
    c.bars.some((b) => b.status === 'within' && b.calories !== null && b.calories > c.goal)
      ? 'A day can pass the goal line and stay within budget: a workout raises that day’s budget.'
      : null,
  );
  // One meaning per icon across the tab: a month calendar counts days, the event check is a streak,
  // the tick is within budget, and bars over a line are days over it, like this card's red caps.
  const stats: StatCell[] = [
    { icon: 'calendar-month-outline', figure: `${c.loggedDays} of ${c.countedDays}`, label: 'days logged', spoken: `${c.loggedDays} of ${plural(c.countedDays, 'day')} logged` },
  ];
  if (c.completeDays > 0) {
    stats.push({
      icon: 'check-circle-outline',
      figure: `${c.withinBudgetDays} of ${c.completeDays}`,
      label: 'within budget',
      spoken: `${c.withinBudgetDays} of ${plural(c.completeDays, 'full day')} within budget`,
    });
  }
  // Not an arrow: an arrow is a change everywhere else on the tab (the delta chips).
  stats.push({ icon: 'chart-bar-stacked', figure: String(c.overBudgetDays), label: 'over budget', spoken: `${plural(c.overBudgetDays, 'day')} over budget` });

  return (
    <ChartCard>
      {average.ready ? (
        <GlanceFigure
          value={formatKcal(average.kcal)}
          unit="kcal a day"
          delta={toChip(calorieDelta(average.vsGoal, c.goal))}
          accessibilityLabel={`${formatKcal(average.kcal)} kcal a day on average. ${averageWords}`}
        />
      ) : (
        <Pending card={average} onAction={onAction} />
      )}
      <View style={styles.block}>
        <BarChart
          bars={bars}
          max={c.chartMax}
          goal={c.goal}
          goalLabel={formatKcal(c.goal)}
          axis={periodAxis(period.chartFrom, period.chartDays, period.to)}
          accessibilityLabel={describeCalorieChart(c, period.to)}
        />
        <Legend items={legend} />
      </View>
      <StatRow cells={stats} />
      <HowItsWorkedOut paragraphs={foot} />
    </ChartCard>
  );
}

// ---------------------------------------------------------------- 4. week by week

/** A small figure on a week's row: an icon in its subject's colour and the figure. */
function WeekFact({ icon, color, text }: { icon: IconName; color: string; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.weekFact}>
      <Icon name={icon} size={16} color={color} />
      <AppText variant="bodyMedium" tabular color={colors.onSurfaceVariant} numberOfLines={1}>
        {keepUnits(text)}
      </AppText>
    </View>
  );
}

/**
 * The period as whole weeks, newest first: one row each, so one week can be read against the next.
 * Each row has its dates, the average intake at the right with how many full days it stands on, and
 * under the dates the week's weight and workouts as small figures. The figures sit in tabular
 * columns, so the eye compares one week with the next; no arrow is drawn between them, because a
 * difference between two weeks is not a direction (PRODUCT.md: an arrow only for a clear rate).
 */
function WeekRows({ weeks, today }: { weeks: WeekBlock[]; today: string }) {
  const { colors } = useTheme();
  return (
    <Group>
      {weeks.map((block) => {
        const text = weekRowText(block, today);
        return (
          <ListRow
            key={block.from}
            headline={text.title}
            lines={[text.note]}
            below={
              <View style={styles.weekFacts}>
                <WeekFact
                  icon="scale-bathroom"
                  color={colors.primary}
                  text={text.weightFigure ? (text.weightOnce ? `${text.weightFigure} once` : text.weightFigure) : 'No weigh-ins'}
                />
                {/* The runner says what is counted; the words are in the row's spoken label. */}
                <WeekFact icon="run" color={colors.tertiary} text={String(block.workouts)} />
              </View>
            }
            figure={{ value: text.kcal, label: text.kcalBasis }}
            spoken={text.spoken}
          />
        );
      })}
    </Group>
  );
}

// ---------------------------------------------------------------- 5. what you actually burn

const CONFIDENCE_LABEL: Record<MaintenanceInfo['confidence'], string> = {
  rough: 'Rough estimate',
  fair: 'Fair estimate',
  good: 'Good estimate',
};
const CONFIDENCE_BARS: Record<MaintenanceInfo['confidence'], number> = { rough: 1, fair: 2, good: 3 };

/**
 * How sure the estimate is, as a quiet chip: three rising bars, as many filled as it is sure
 * (rough one, fair two, good three), and the word. The bars are movement's tertiary, like the band.
 */
function ConfidenceChip({ level }: { level: MaintenanceInfo['confidence'] }) {
  const { colors } = useTheme();
  const filled = CONFIDENCE_BARS[level];
  return (
    <View style={[styles.statusChip, { backgroundColor: colors.surfaceContainerHighest }]}>
      <View style={styles.signal}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.signalBar, { height: 6 + i * 3, backgroundColor: i < filled ? colors.tertiary : withAlpha(colors.onSurface, Alpha.track) }]} />
        ))}
      </View>
      <AppText variant="labelLarge" color={colors.onSurfaceVariant} numberOfLines={1} maxFontSizeMultiplier={1.5}>
        {CONFIDENCE_LABEL[level]}
      </AppText>
    </View>
  );
}

/**
 * What you actually burn: about how much, how sure, and one range bar with the burn band (the
 * tertiary, calories burned being movement) against what you eat (a dot in the primary) and the goal
 * and the calculator's figure (ticks, as references). Its sentences are in the foot.
 */
function MaintenanceCard({ m }: { m: MaintenanceInfo }) {
  const { colors } = useTheme();
  const scale = burnScale(m);
  const band = m.low === m.high ? formatKcal(m.low) : `${formatKcal(m.low)}–${formatKcal(m.high)}`;
  const marks: RangeMark[] = [
    { value: m.averageIntake, label: 'You eat', figure: formatKcal(m.averageIntake), kind: 'dot', tone: 'primary' },
    { value: m.goal.kcal, label: 'Goal', figure: formatKcal(m.goal.kcal), kind: 'tick' },
  ];
  if (m.formulaKcal !== null) marks.push({ value: m.formulaKcal, label: 'Calculator', figure: formatKcal(m.formulaKcal), kind: 'tick' });
  const spokenBar = lines(
    `You burn between ${formatKcal(m.low)} and ${formatKcal(m.high)} kcal a day.`,
    `You eat ${formatKcal(m.averageIntake)}.`,
    m.goal.text,
    m.formulaText,
  ).join(' ');

  return (
    <ChartCard>
      <View style={styles.figureRow} accessible accessibilityLabel={`About ${formatKcal(m.kcal)} kcal a day. ${m.rangeText}. ${CONFIDENCE_LABEL[m.confidence]}.`}>
        <AppText variant="headlineSmall" emphasized tabular>
          <AppText variant="bodyLarge" color={colors.onSurfaceVariant}>
            {'About '}
          </AppText>
          {keepUnits(formatKcal(m.kcal))}
          <AppText variant="bodyLarge" color={colors.onSurfaceVariant}>
            {' kcal a day'}
          </AppText>
        </AppText>
        <ConfidenceChip level={m.confidence} />
      </View>
      <RangeBar
        min={scale.min}
        max={scale.max}
        low={m.low}
        high={m.high}
        bandLabel={{ label: 'You burn', figure: band }}
        marks={marks}
        tone="tertiary"
        accessibilityLabel={spokenBar}
      />
      <Line>{burnLine(m)}</Line>
      <HowItsWorkedOut paragraphs={lines(`${m.rangeText}.`, maintenanceBasisText(m), m.goal.text, m.formulaText, m.note)} />
    </ChartCard>
  );
}

// ---------------------------------------------------------------- 6. macros

const MACROS: { key: Category; label: string }[] = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
];

const macroValue = (a: MacroAverage): string => (a.goal > 0 ? `${Math.round(a.average)} of ${Math.round(a.goal)} g` : `${Math.round(a.average)} g`);

/**
 * One line of a proportion list: a name, its figure, and a bar to compare it with its neighbours.
 * The bar is scaled to its goal; the figure beside it is the real number. A coloured dot before the
 * name when the bar's colour is the row's identity.
 */
function MacroBar({ label, value, share, color, spoken }: { label: string; value: string; share: number; color: string; spoken: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.macroBar} accessible accessibilityLabel={spoken}>
      <View style={styles.macroHead}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <AppText variant="titleSmall" numberOfLines={1} style={styles.fill}>
          {label}
        </AppText>
        <AppText variant="labelLarge" color={colors.onSurfaceVariant} numberOfLines={1} tabular>
          {keepUnits(value)}
        </AppText>
      </View>
      <ProportionBar value={share} color={color} />
    </View>
  );
}

/**
 * Macros: the days protein reached its goal as a figure and a row of dots, the three daily averages
 * against their goals as bars, and where the calories come from as one split bar. What counts as a
 * protein day, and what was left out, are in the foot.
 */
function MacrosCard({ m, days, period }: { m: MacrosInfo; days: readonly DaySummary[]; period: Period }) {
  const { colors, dark } = useTheme();
  const palette = categoryColors(colors.primary, dark);
  const split = m.split;
  const hasProteinGoal = m.protein.goal > 0;
  const hitRule = `A day counts when you reach at least ${percentText(PROTEIN_HIT_SHARE)} of your protein goal.`;
  const proteinSentence = `Protein goal met on ${m.proteinDays} of ${plural(m.days, 'full day')}.`;
  // A dot a day reads for a week or a month; ninety are a texture, and the figure says it.
  const dots = hasProteinGoal && period.chartDays <= 31 ? proteinDayMarks(days, period, m.protein.goal) : null;

  return (
    <ChartCard>
      {hasProteinGoal ? (
        <View style={styles.block}>
          <GlanceFigure value={`${m.proteinDays} of ${m.days}`} unit="days on protein goal" accessibilityLabel={`${proteinSentence} ${hitRule}`} />
          {dots ? (
            <DayDots days={dots.marks} labels={dots.labels ?? undefined} tone="protein" accessibilityLabel={`${proteinSentence} Each dot is a day; filled is a day that reached it.`} />
          ) : null}
        </View>
      ) : null}
      <View style={styles.rows}>
        {MACROS.map(({ key, label }) => {
          const a = m[key];
          return (
            <MacroBar
              key={key}
              label={label}
              value={macroValue(a)}
              share={a.ratio ?? 0}
              color={palette[key].color}
              spoken={`${label}, ${Math.round(a.average)} grams a day${a.goal > 0 ? `, goal ${Math.round(a.goal)}` : ''}`}
            />
          );
        })}
      </View>
      {split ? (
        <View style={styles.block}>
          <SubLabel>Share of calories</SubLabel>
          <SplitBar
            segments={MACROS.map(({ key, label }) => ({ label, value: split[key], tone: key }))}
            accessibilityLabel={`Calories: ${percentText(split.protein)} from protein, ${percentText(split.carbs)} from carbs, ${percentText(split.fat)} from fat`}
          />
        </View>
      ) : null}
      <HowItsWorkedOut paragraphs={lines(`Daily averages over ${plural(m.days, 'full day')}.`, hasProteinGoal ? hitRule : null, m.note)} />
    </ChartCard>
  );
}

// ---------------------------------------------------------------- 7. exercise

/**
 * Movement, in the tertiary throughout: the time as the figure, the minutes of each day as bars,
 * what it burned and how often as counts, and the top activities as bar rows.
 */
function ExerciseCard({ e, period }: { e: ExerciseInfo; period: Period }) {
  const weekly = e.perWeek
    ? `${e.perWeek.workouts} ${e.perWeek.workouts === 1 ? 'workout' : 'workouts'} and ${formatMinutes(e.perWeek.minutes)} a week on average.`
    : null;
  const stats: StatCell[] = [
    { icon: 'fire', figure: formatKcal(e.calories), label: 'kcal burned', tone: 'tertiary', spoken: `${formatKcal(e.calories)} kcal burned in workouts` },
    { icon: 'calendar-month-outline', figure: String(e.activeDays), label: e.activeDays === 1 ? 'active day' : 'active days', tone: 'tertiary' },
  ];
  // A weekly average needs a week of use; before that it is left out.
  if (e.perWeek) stats.push({ icon: 'run', figure: String(e.perWeek.workouts), label: 'workouts a week', tone: 'tertiary', spoken: weekly ?? undefined });
  const shares = relativeToLargest(e.top.map((a) => a.minutes));

  return (
    <ChartCard>
      <GlanceFigure
        value={formatMinutes(e.minutes)}
        unit={`in ${plural(e.workouts, 'workout')}`}
        accessibilityLabel={`${formatMinutes(e.minutes)} of exercise in ${plural(e.workouts, 'workout')} on ${plural(e.activeDays, 'day')}.`}
      />
      <BarChart
        bars={exerciseChartBars(chartRows(e.daily, period))}
        axis={periodAxis(period.chartFrom, period.chartDays, period.to)}
        height={64}
        accessibilityLabel={describeExerciseChart(e, period.to)}
      />
      <StatRow cells={stats} />
      {/* The top activities need no label over them: an activity's avatar, its name and its time say what they are. */}
      {e.top.length ? (
        <BarRows
          tone="tertiary"
          items={e.top.map((a, i) => ({
            name: a.label,
            figure: formatMinutes(a.minutes),
            share: shares[i],
            icon: a.icon as IconName,
            spoken: `${a.label}, ${formatMinutes(a.minutes)} in ${plural(a.workouts, 'workout')}, ${formatKcal(a.calories)} kcal, ${percentText(a.share)} of your exercise time`,
          }))}
        />
      ) : null}
      <HowItsWorkedOut
        paragraphs={lines(
          weekly,
          ...e.top.map((a) => `${a.label}: ${plural(a.workouts, 'workout')}, ${formatKcal(a.calories)} kcal, ${percentText(a.share)} of your exercise time.`),
        )}
      />
    </ChartCard>
  );
}

// ---------------------------------------------------------------- 8. consistency

/**
 * Consistency: the two streaks as counts, the calendar, and a line only when there is something
 * worth saying in words (a weekday that keeps going unlogged, today's step, or a record run). The
 * days logged are the Calories card's count and the calendar's picture, so they are not counted
 * again here; the counts sentence that adds up is in the foot and in the calendar's spoken label.
 */
function ConsistencyCard({ c, period, onOpenDay }: { c: ConsistencyInfo; period: Period; onOpenDay: (date: string) => void }) {
  const { colors } = useTheme();
  const streak = c.streak;
  const longest = streak.current > 1 && streak.current === streak.best ? 'This is your longest run so far.' : null;
  // Today's ring on the calendar already shows a logged today, so that needs no words of its own.
  const nudge =
    streak.current === 0
      ? 'Log a meal today to start a new streak.'
      : streak.loggedToday
        ? longest
        : lines('Log a meal today to keep your streak going.', longest).join(' ');
  const line = c.skipped ? c.skipped.text : nudge;
  // One entry for each mark the calendar draws. A day with nothing logged has no mark, so it has no entry.
  const legend: LegendEntry[] = [
    { mark: 'cookie', color: colors.primary, label: 'Within budget' },
    { mark: 'capped', color: colors.primary, accent: colors.error, label: 'Over budget' },
    { mark: 'speck', color: colors.primary, label: 'Not a full day' },
  ];
  // A week or a month has rows tall enough to tap; ninety days keep their small cells and open nothing.
  const tappable = period.days <= 30;
  const stats: StatCell[] = [
    { icon: 'calendar-check', figure: String(streak.current), label: 'day streak', tone: 'secondary', spoken: `Current streak, ${plural(streak.current, 'day')}` },
    { icon: 'medal-outline', figure: String(streak.best), label: 'best streak', tone: 'secondary', spoken: `Best streak, ${plural(streak.best, 'day')}` },
  ];

  return (
    <ChartCard>
      <StatRow cells={stats} />
      <View style={styles.block}>
        <CalendarGrid
          days={c.calendar}
          leadingBlanks={c.leadingBlanks}
          showNumbers={tappable}
          onDayPress={tappable ? onOpenDay : undefined}
          accessibilityLabel={describeCalendar(c)}
        />
        <Legend items={legend} />
      </View>
      {line ? <Line strong={!!c.skipped}>{line}</Line> : null}
      <HowItsWorkedOut paragraphs={lines(c.text, c.skipped ? nudge : null, tappable ? 'Tap a day on the calendar to open it.' : null)} />
    </ChartCard>
  );
}

// ---------------------------------------------------------------- 9. patterns

/**
 * Patterns, as three pictures in one card: weekdays against weekends as two dots on a range with
 * the goal (how far apart they are is the finding), the meals as one split bar, and the day of the
 * week as bars with the highest picked out only when it really stands out.
 */
function PatternsCard({ p, goal, onAction }: { p: PatternsInfo; goal: number | null; onAction: InsightActionHandler }) {
  const { colors } = useTheme();
  const split = p.weekSplit;
  const highest = p.highestDay;
  const shades = shadesOf(colors.primary, p.meals.length);
  const scale = kcalScale(split.ready ? [split.weekday.average, split.weekend.average, goal] : []);
  const splitMarks: RangeMark[] = split.ready
    ? [
        { value: split.weekday.average, label: 'Weekdays', figure: formatKcal(split.weekday.average), kind: 'dot' },
        { value: split.weekend.average, label: 'Weekends', figure: formatKcal(split.weekend.average), kind: 'dot' },
        ...(goal !== null ? [{ value: goal, label: 'Goal', figure: formatKcal(goal), kind: 'tick' } as const] : []),
      ]
    : [];
  const splitWords = split.ready
    ? `${split.text} Weekdays ${formatKcal(split.weekday.average)} kcal over ${plural(split.weekday.days, 'full day')}, weekends ${formatKcal(split.weekend.average)} kcal over ${plural(split.weekend.days, 'full day')}.`
    : split.reason;

  // The day of the week waiting on the same step as weekdays and weekends: that block offers it once.
  const dayQuiet = !split.ready && !highest.ready && !!split.action && split.action === highest.action;

  const splitBlock = (
    <View key="split" style={styles.block}>
      <SubLabel>Weekdays and weekends</SubLabel>
      {split.ready ? (
        <>
          <RangeBar min={scale.min} max={scale.max} marks={splitMarks} accessibilityLabel={splitWords} />
          <Line>{weekSplitLine(split)}</Line>
        </>
      ) : (
        <Pending card={split} onAction={onAction} />
      )}
    </View>
  );
  const mealsBlock = (
    <View key="meals" style={styles.block}>
      <SubLabel>Calories by meal</SubLabel>
      <SplitBar segments={p.meals.map((m, i) => ({ label: m.label, value: m.share, color: shades[i] }))} accessibilityLabel={mealsSpoken(p.meals)} />
    </View>
  );
  // Waiting only for a longer period, with the step already offered above: nothing to draw, and its
  // reason is in the foot, so the block is left out rather than kept as a heading over a sentence.
  const dayBlock =
    dayQuiet && !highest.ready && onlyNeedsMonth(highest) ? null : (
      <View key="day" style={styles.block}>
        <SubLabel>Day of the week</SubLabel>
        {highest.ready ? (
          <>
            {/* Drawn only with enough days behind it. A bar is picked out only when its day really stands out. */}
            <BarChart
              bars={weekdayChartBars(p.byWeekday, highest.standsOut ? highest.weekday : null)}
              axis={WEEKDAY_AXIS}
              height={72}
              accessibilityLabel={`${describeWeekdayChart(p.byWeekday)} ${highest.text}`}
            />
            <Line>{highest.text}</Line>
          </>
        ) : (
          <Pending card={highest} onAction={onAction} quiet={dayQuiet} />
        )}
      </View>
    );

  return (
    <ChartCard>
      {/* The card opens with a picture: while weekdays and weekends wait, the meals come first. */}
      {split.ready ? [splitBlock, mealsBlock, dayBlock] : [mealsBlock, splitBlock, dayBlock]}
      <HowItsWorkedOut paragraphs={lines(splitWords, mealsSpoken(p.meals), highest.ready ? null : highest.reason)} />
    </ChartCard>
  );
}

// ---------------------------------------------------------------- 10. top foods

/**
 * The foods that added the most calories, as ranked bar rows: the food's avatar, its name, its
 * calories at the right, and a bar scaled to the top food's, with how many times it was logged at
 * the bar's end. The kit's `BarRows` has no place for that count, so the rows are drawn here.
 */
function TopFoodsCard({ foods }: { foods: TopFood[] }) {
  const { colors } = useTheme();
  const shares = relativeToLargest(foods.map((f) => f.calories));
  return (
    <ChartCard>
      <View style={styles.rows}>
        {foods.map((f, i) => (
          <View
            key={f.name}
            style={styles.foodRow}
            accessible
            accessibilityLabel={`${f.name}, ${formatKcal(f.calories)} calories from ${plural(f.count, 'time')}, ${percentText(f.share)} of your calories`}>
            <Avatar icon={foodIcon(f.name)} tone="secondary" size={32} />
            <View style={styles.foodBody}>
              <View style={styles.foodHead}>
                <AppText variant="titleSmall" numberOfLines={2} style={styles.fill}>
                  {f.name}
                </AppText>
                <AppText variant="labelLarge" tabular color={colors.onSurfaceVariant} numberOfLines={1}>
                  {keepUnits(`${formatKcal(f.calories)} kcal`)}
                </AppText>
              </View>
              <View style={styles.foodBar}>
                <View style={styles.fill}>
                  <ProportionBar value={shares[i]} color={colors.primary} height={6} />
                </View>
                <AppText variant="labelMedium" tabular color={colors.onSurfaceVariant} numberOfLines={1} style={styles.foodCount}>
                  {`${f.count}×`}
                </AppText>
              </View>
            </View>
          </View>
        ))}
      </View>
    </ChartCard>
  );
}

// ---------------------------------------------------------------- the cards, in order

/**
 * Cards 2 to 10, each under its section label. The headline and the glance grid sit above them
 * and the list of days below. They are returned as siblings, not wrapped, so each section's
 * `onLayout` is measured against the same parent as everything else in the list's header.
 */
export function InsightCards({
  insights,
  onAction,
  onRecalculate,
  onKeepTargets,
  onOpenDay,
  onSectionLayout,
}: {
  insights: Insights;
  onAction: InsightActionHandler;
  /** Use the targets worked out for this weight. */
  onRecalculate: (toKg: number) => void;
  /** Decline them: keep the current targets, and treat this weight as the one they were set at. */
  onKeepTargets: (toKg: number) => void;
  onOpenDay: (date: string) => void;
  /** Where a section starts, for the glance tiles to scroll to. */
  onSectionLayout: (section: SectionKey, y: number) => void;
}) {
  const { period, weight, calories, weeks, maintenance, macros, exercise, consistency, patterns, topFoods, everyDay } = insights;
  return (
    <>
      <View onLayout={(e) => onSectionLayout('weight', e.nativeEvent.layout.y)}>
        <SectionHeader title="Weight" hint={weight.ready ? plural(weight.weighIns, 'weigh-in') : undefined} />
        {weight.ready ? (
          <WeightGroup w={weight} period={period} onAction={onAction} onRecalculate={onRecalculate} onKeepTargets={onKeepTargets} />
        ) : (
          <NotReadyTile icon="scale-bathroom" card={weight} onAction={onAction} />
        )}
      </View>

      <View onLayout={(e) => onSectionLayout('calories', e.nativeEvent.layout.y)}>
        <SectionHeader title="Calories" hint={calories.ready ? `Goal ${formatKcal(calories.goal)} kcal` : undefined} />
        {calories.ready ? (
          <CaloriesCard c={calories} period={period} onAction={onAction} />
        ) : (
          <NotReadyTile icon="silverware-fork-knife" card={calories} onAction={onAction} />
        )}
      </View>

      {weeks.length > 0 ? (
        <View>
          <SectionHeader title="Week by week" hint="Average a day, newest first" />
          <WeekRows weeks={weeks} today={period.to} />
        </View>
      ) : null}

      <View>
        <SectionHeader title="What you actually burn" />
        {maintenance.ready ? <MaintenanceCard m={maintenance} /> : <NotReadyTile icon="fire" card={maintenance} onAction={onAction} />}
      </View>

      <View>
        <SectionHeader title="Macros" hint={macros.ready ? plural(macros.days, 'full day') : undefined} />
        {macros.ready ? (
          <MacrosCard m={macros} days={everyDay.ready ? everyDay.days : []} period={period} />
        ) : (
          <NotReadyTile icon="egg-outline" card={macros} onAction={onAction} />
        )}
      </View>

      <View onLayout={(e) => onSectionLayout('exercise', e.nativeEvent.layout.y)}>
        <SectionHeader title="Exercise" />
        {exercise.ready ? <ExerciseCard e={exercise} period={period} /> : <NotReadyTile icon="run" card={exercise} onAction={onAction} tone="tertiary" />}
      </View>

      <View onLayout={(e) => onSectionLayout('consistency', e.nativeEvent.layout.y)}>
        <SectionHeader title="Consistency" />
        {consistency.ready ? (
          <ConsistencyCard c={consistency} period={period} onOpenDay={onOpenDay} />
        ) : (
          <NotReadyTile icon="calendar-check" card={consistency} onAction={onAction} />
        )}
      </View>

      <View>
        <SectionHeader title="Patterns" hint={patterns.ready ? `From ${plural(patterns.days, 'full day')}` : undefined} />
        {patterns.ready ? (
          <PatternsCard p={patterns} goal={calories.ready ? calories.goal : null} onAction={onAction} />
        ) : (
          <NotReadyTile icon="lightbulb-on-outline" card={patterns} onAction={onAction} />
        )}
      </View>

      <View>
        <SectionHeader title="Top foods" hint={topFoods.ready ? 'Most calories first' : undefined} />
        {topFoods.ready ? <TopFoodsCard foods={topFoods.foods} /> : <NotReadyTile icon="food-outline" card={topFoods} onAction={onAction} />}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  start: { alignSelf: 'flex-start' },
  centred: { alignItems: 'center' },

  // The one focal tile: the same corners and the same inset as Today's hero.
  focal: { padding: Spacing.xl, borderRadius: Shape.extraLargeIncreased, gap: Spacing.lg },
  focalHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  focalFigures: { gap: Spacing.xs },
  focalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing.xs,
    minHeight: 28,
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.md,
    borderRadius: Shape.full,
  },
  basis: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  basisItem: { flex: 1, minWidth: 0, gap: 2 },
  basisHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  focalActions: { gap: Spacing.sm, paddingTop: Spacing.xs },
  focalButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Shape.full,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  // Half the row each. At a large font size a label needs more than half, and then each takes a row of its own
  // rather than being cut short: the width comes from the label, and only its least is set here.
  share: { flexGrow: 1, minWidth: '45%' },

  // The glance tiles.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  glance: {
    flexBasis: '45%',
    flexGrow: 1,
    minHeight: 112,
    justifyContent: 'space-between',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Shape.largeIncreased,
  },
  glanceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: AVATAR_SIZE },

  // A section's pieces: a card, a group.
  group: { gap: Spacing.sm },
  card: { padding: Spacing.xl, borderRadius: Shape.extraLarge, gap: Spacing.lg },
  // The same inset as the card above it, so the two avatars line up.
  suggestion: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xl, borderRadius: Shape.largeIncreased, gap: Spacing.lg },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, minHeight: 72, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },

  // A list row, with GroupRow's measures.
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  rowBody: { gap: 2 },
  rowFigure: { alignItems: 'flex-end', maxWidth: 156 },
  rowFigureLabel: { textAlign: 'right' },
  weekFacts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.lg, rowGap: Spacing.xs, paddingTop: 2 },
  weekFact: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  // Inside a card.
  figureRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.md, rowGap: Spacing.xs },
  block: { gap: Spacing.sm },
  rows: { gap: Spacing.md },
  finding: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.lg },
  findingBody: { flex: 1, minWidth: 0, gap: Spacing.sm },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 28,
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.md,
    borderRadius: Shape.full,
  },
  signal: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 12 },
  signalBar: { width: 3, borderRadius: 1.5 },
  macroBar: { gap: Spacing.xs },
  macroHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 8, height: 8, borderRadius: Shape.full },
  foodRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  foodBody: { flex: 1, minWidth: 0, gap: 6 },
  foodHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  foodBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  foodCount: { minWidth: 28, textAlign: 'right' },
});
