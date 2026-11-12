/**
 * The Progress tab's cards, in Today's language (docs/DESIGN.md, "Progress").
 *
 * Three kinds of container, so the page is not a column of identical boxes:
 *  - a chart card (28dp) opens with the answer to one question (where is my weight heading, what
 *    do I really eat, what do I really burn) in `titleLarge` emphasised, and only then shows the
 *    chart and the numbers behind it;
 *  - a ranked or repeated list (week by week, calories by meal, top activities, top foods, every
 *    day) is a segmented group of rows with round avatars and no card around it;
 *  - a pair of small facts is two 20dp tiles side by side.
 *
 * The headline is the screen's one focal tile, in `primaryContainer`; everything else is quiet.
 * Colour tells the subject: food and weight in the primary, movement in the tertiary, the streak in
 * the secondary. A tile or row with nothing behind it yet is unlit: a ring avatar, what to log, and
 * a plus.
 *
 * Every figure and every sentence with a number in it comes from `lib/insights.ts`; the wording
 * that joins them is in `lib/progress-view.ts`. Nothing is worked out here.
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
  type ExerciseInfo,
  type InsightAction,
  type Insights,
  type MacroAverage,
  type MacrosInfo,
  type MaintenanceInfo,
  type NotReady,
  type PatternsInfo,
  type TopFood,
  type Unlock,
  type WeekBlock,
  type WeightInfo,
} from '@/lib/insights';
import { formatKcal } from '@/lib/nutrition';
import {
  averageVsGoalText,
  biggestMealText,
  calorieChartBars,
  chartRows,
  describeCalendar,
  describeCalorieChart,
  describeExerciseChart,
  describeWeekdayChart,
  describeWeightChart,
  exerciseChartBars,
  glanceText,
  latestWeighInText,
  maintenanceBasisText,
  percentText,
  periodAxis,
  plural,
  recalcSummary,
  relativeToLargest,
  splitAnswer,
  weekdayChartBars,
  weekRowText,
  weightChartMarks,
  WEEKDAY_AXIS,
  type GlanceKey,
} from '@/lib/progress-view';
import { formatKg } from '@/lib/weight';
import {
  BarChart,
  CalendarGrid,
  DOT_ALPHA,
  FADED_ALPHA,
  Legend,
  LineChart,
  MiniBars,
  MiniLineChart,
  ProportionBar,
  StackedBar,
  TENTATIVE_ALPHA,
  type LegendEntry,
} from './charts';
import { ShapeAvatar } from './expressive';
import { keepUnits } from './screen-text';
import { foodIcon, MEAL_ICONS } from './today-tiles';
import {
  AppText,
  Avatar,
  Button,
  Group,
  GroupItem,
  GroupRow,
  Icon,
  SectionHeader,
  Tappable,
  type AvatarTone,
  type GroupCorners,
  type IconName,
} from './ui';

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

// ---------------------------------------------------------------- building blocks

/** The icon at the end of an unlit row or tile. Only a cue: the whole surface is the button. */
function Cue({ icon = 'plus', color }: { icon?: IconName; color?: string }) {
  return (
    <View importantForAccessibility="no-hide-descendants">
      <Icon name={icon} size={24} color={color} />
    </View>
  );
}

/** A chart card: 28dp corners, one question, its answer first. */
function ChartCard({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.surfaceContainerHigh }]}>{children}</View>;
}

/**
 * A card that cannot be shown yet, as one unlit row: a ring avatar, what to do in the headline, the
 * reason under it and a cue at the end. The whole row is the button. With nothing to do but wait,
 * it is the reason alone.
 */
function NotReadyTile({ icon, card, onAction }: { icon: IconName; card: NotReady; onAction: InsightActionHandler }) {
  const action = card.action;
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

/** A quiet line of small print: what a figure leaves out, or how it was worked out. */
function Note({ children, icon = 'information-outline' }: { children: string; icon?: IconName }) {
  const { colors } = useTheme();
  return (
    <View style={styles.note}>
      <Icon name={icon} size={16} color={colors.onSurfaceVariant} />
      <AppText variant="bodySmall" color={colors.onSurfaceVariant} style={styles.fill}>
        {keepUnits(children)}
      </AppText>
    </View>
  );
}

/** The one next step of a card: a quiet tonal pill, 40dp with a 48dp target. */
function ActionButton({ action, onAction }: { action: InsightAction; onAction: InsightActionHandler }) {
  return <Button variant="tonal" title={ACTION_LABEL[action]} icon={ACTION_ICON[action]} onPress={() => onAction(action)} hitSlop={4} style={styles.start} />;
}

/** One figure on a ready card that is not ready itself: the reason, and the step that unlocks it. */
function Pending({ card, onAction }: { card: NotReady; onAction?: InsightActionHandler }) {
  const action = card.action;
  return (
    <View style={styles.block}>
      <Note>{card.reason}</Note>
      {action && onAction ? <ActionButton action={action} onAction={onAction} /> : null}
    </View>
  );
}

/** A card's answer in words, with what it adds up from in a quiet line under it. */
function Answer({ title, detail }: { title: string; detail?: string | null }) {
  const { colors } = useTheme();
  return (
    <View style={styles.answer}>
      <AppText variant="titleLarge" emphasized>
        {keepUnits(title)}
      </AppText>
      {detail ? (
        <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
          {keepUnits(detail)}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * A card's answer as a number: the value, its unit on the same line, then what it stands on.
 * `range` is for a figure known only to within two ends, and is set as part of the answer.
 */
function Figure({ value, unit, range, lines = [] }: { value: string; unit?: string; range?: string; lines?: (string | null)[] }) {
  const { colors } = useTheme();
  const figure = unit ? `${value} ${unit}` : value;
  const shown = lines.filter((line): line is string => !!line);
  return (
    <View style={styles.answer} accessible accessibilityLabel={[figure, range, ...shown].filter(Boolean).join('. ')}>
      <AppText variant="titleLarge" emphasized tabular>
        {keepUnits(value)}
        {unit ? <AppText variant="bodyLarge" color={colors.onSurfaceVariant}>{` ${unit}`}</AppText> : null}
      </AppText>
      {range ? <AppText variant="bodyLarge">{keepUnits(range)}</AppText> : null}
      {shown.map((line) => (
        <AppText key={line} variant="bodyMedium" color={colors.onSurfaceVariant}>
          {keepUnits(line)}
        </AppText>
      ))}
    </View>
  );
}

function StatRow({ children }: { children: ReactNode }) {
  return <View style={styles.statRow}>{children}</View>;
}

function Stat({ value, label }: { value: string; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}, ${value}`}>
      <AppText variant="titleMedium" emphasized numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} tabular>
        {keepUnits(value)}
      </AppText>
      <AppText variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}

/** The small label over one part of a card. */
function SubLabel({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <AppText variant="labelLarge" color={colors.onSurfaceVariant}>
      {children}
    </AppText>
  );
}

/**
 * The label over a group that follows a card inside a section, a step under the section's own
 * header, with the group's answer in words under it when it has one.
 */
function ListHeader({ title, answer }: { title: string; answer?: string | null }) {
  const { colors } = useTheme();
  return (
    <View style={styles.listHeader}>
      <AppText variant="titleSmall" emphasized>
        {title}
      </AppText>
      {answer ? (
        <AppText variant="bodyMedium" color={colors.onSurfaceVariant} textBreakStrategy="balanced">
          {keepUnits(answer)}
        </AppText>
      ) : null}
    </View>
  );
}

/** A finding on a card with its own avatar: the round mark, then whatever says it. */
function Finding({ icon, tone, leading, children }: { icon?: IconName; tone?: AvatarTone; leading?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.finding}>
      {leading ?? <Avatar icon={icon} tone={tone} />}
      <View style={styles.findingBody}>{children}</View>
    </View>
  );
}

/**
 * One line of a proportion list: a name, its figure, and a bar to compare it with its neighbours.
 * The bar is scaled to the largest row; the figure beside it is the real number. With `upTo` the
 * figure is a range: the bar stops at its lower end and a thin line runs on to its upper end.
 */
function BarRow({
  label,
  value,
  share,
  upTo,
  color,
  dot,
  spoken,
}: {
  label: string;
  value: string;
  share: number;
  upTo?: number;
  color?: string;
  /** A coloured dot before the name, when the bar's colour is the row's identity. */
  dot?: string;
  spoken: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.barRow} accessible accessibilityLabel={spoken}>
      <View style={styles.barRowHead}>
        {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
        <AppText variant="titleSmall" numberOfLines={2} style={styles.fill}>
          {label}
        </AppText>
        <AppText variant="labelLarge" color={colors.onSurfaceVariant} numberOfLines={1} tabular>
          {keepUnits(value)}
        </AppText>
      </View>
      <ProportionBar value={share} upTo={upTo} color={color} />
    </View>
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
  lines = [],
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
  /** The row's number, right aligned, with what it is under it. */
  figure?: { value: string; label?: string };
  onPress?: () => void;
  /** From `groupCorners()`, for a row outside a `Group`. */
  corners?: GroupCorners;
  spoken: string;
}) {
  const { colors } = useTheme();
  const shown = lines.filter((line): line is string => !!line);
  const layout = [styles.row, { minHeight: shown.length ? 72 : 56 }];
  const content = (
    <>
      {leading ?? (icon ? <Avatar icon={icon} tone={tone} /> : null)}
      <View style={styles.fill}>
        <AppText variant="titleMedium" numberOfLines={2}>
          {headline}
        </AppText>
        {shown.map((line) => (
          <AppText key={line} variant="bodyMedium" color={colors.onSurfaceVariant} textBreakStrategy="balanced">
            {keepUnits(line)}
          </AppText>
        ))}
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

/** One of a pair of small facts: an avatar in its subject's colour, the figure, and what it is. */
function FactTile({ icon, tone, value, label }: { icon: IconName; tone: AvatarTone; value: string; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.fact, { backgroundColor: colors.surfaceContainerHigh }]} accessible accessibilityLabel={`${label}, ${value}`}>
      <Avatar icon={icon} tone={tone} />
      <View style={styles.fill}>
        <AppText variant="titleMedium" emphasized numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} tabular>
          {keepUnits(value)}
        </AppText>
        <AppText variant="bodyMedium" color={colors.onSurfaceVariant} numberOfLines={2}>
          {label}
        </AppText>
      </View>
    </View>
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
 * The one focal tile, and the screen's hero moment: the most important fact of the period as a
 * sentence, and how much data it stands on. With nothing to say yet it asks for the first log, and
 * logging food is the one strong fill on the screen.
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

  // What the sentence is built on, so a headline from four days does not read like one from thirty.
  // Meals are counted in full days, because those are the days the average is over.
  const basis: { count: number; label: string }[] = [];
  const fullDays = insights.calories.ready ? insights.calories.completeDays : 0;
  if (fullDays > 0) basis.push({ count: fullDays, label: fullDays === 1 ? 'full day of meals' : 'full days of meals' });
  if (insights.weight.ready) basis.push({ count: insights.weight.weighIns, label: insights.weight.weighIns === 1 ? 'weigh-in' : 'weigh-ins' });
  if (insights.exercise.ready) basis.push({ count: insights.exercise.workouts, label: insights.exercise.workouts === 1 ? 'workout' : 'workouts' });
  const basisSpoken = basis.length ? ` From ${basis.map((b) => `${b.count} ${b.label}`).join(', ')}.` : '';

  return (
    <View style={[styles.focal, { backgroundColor: colors.primaryContainer }]} accessible accessibilityLabel={`${period}. ${headline.text}${basisSpoken}`}>
      <View style={styles.focalHeader}>
        <Icon name={TONE_ICON[headline.tone]} size={24} color={on} />
        <AppText variant="titleMedium" color={on}>
          {period}
        </AppText>
      </View>
      <AppText variant="headlineSmall" emphasized color={on}>
        {keepUnits(headline.text)}
      </AppText>
      {basis.length ? (
        // The same three-figure line as under Today's ring: the number, and what it counts under it.
        <View style={styles.basis}>
          {basis.map((b) => (
            <View key={b.label} style={styles.basisItem}>
              <AppText variant="titleMedium" emphasized tabular color={on} numberOfLines={1}>
                {b.count}
              </AppText>
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
                {keepUnits(t.title)}
              </AppText>
              <AppText variant="bodyMedium" color={quiet} numberOfLines={3}>
                {keepUnits(t.detail)}
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
 * Weight: the chart card, ending with how far the target is, and under it, when the weight has
 * moved far enough from the one the targets were set at, a tile that offers new ones.
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
  const recalc = w.recalc;
  const goalKg = w.chart.goalKg;
  const latestWhen = w.latest.date === period.to ? 'today' : formatShortDate(w.latest.date);
  // The chart opens on the first day anything was logged; the line is the one the card's figures come from.
  const marks = weightChartMarks(w, period);

  const legend: LegendEntry[] = [{ mark: 'dot', color: withAlpha(colors.primary, DOT_ALPHA), label: 'Weigh-in' }];
  if (marks.line) {
    legend.push(
      marks.tentative
        ? { mark: 'line', color: withAlpha(colors.primary, TENTATIVE_ALPHA), label: 'Direction, not clear yet' }
        : { mark: 'line', color: colors.primary, label: 'Direction' },
    );
  }
  if (goalKg !== null && !w.chart.goalOffChart) legend.push({ mark: 'dash', color: colors.outline, label: `Target ${formatKg(goalKg)}` });

  const chartNotes: string[] = [];
  if (marks.line) chartNotes.push(marks.tentative ? TENTATIVE_LINE_NOTE : LINE_NOTE);
  if (goalKg !== null && w.chart.goalOffChart) chartNotes.push(`Your ${formatKg(goalKg)} target is ${w.chart.goalOffChart} this chart.`);

  const progress = goal && goal.progress !== null && goal.startKg !== null && !goal.reached ? { share: goal.progress, startKg: goal.startKg } : null;
  const progressText = goal
    ? progress
      ? `${percentText(progress.share)} of the way from ${formatKg(progress.startKg)} to ${formatKg(goal.kg)}, with ${formatKg(goal.toGoKg)} to go.`
      : `${formatKg(goal.toGoKg)} to go to your ${formatKg(goal.kg)} target.`
    : '';

  return (
    <View style={styles.group}>
      <ChartCard>
        {rate.ready ? (
          <>
            {/* `rateText` and `changeText` state a direction only when the rate is clear; no figure of the rate is printed here. */}
            <Answer title={rate.rateText} detail={`${rate.changeText}.`} />
            <StatRow>
              <Stat value={formatKg(w.latest.kg)} label={`Latest, ${latestWhen}`} />
              <Stat value={formatKg(rate.nowKg)} label="Smoothed" />
            </StatRow>
          </>
        ) : (
          <>
            <Figure value={formatKg(w.latest.kg)} lines={[latestWeighInText(w, period.to)]} />
            {w.weekAverages ? <AppText variant="bodyMedium">{keepUnits(w.weekAverages.text)}</AppText> : null}
            <Pending card={rate} onAction={onAction} />
          </>
        )}

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
        {chartNotes.length ? <Note>{chartNotes.join(' ')}</Note> : null}

        {goal ? (
          goal.reached ? (
            // One of the earned moments that get an expressive shape.
            <Finding
              leading={
                <ShapeAvatar shape="sunny" size={AVATAR_SIZE} color={colors.primary}>
                  <Icon name="check" size={24} color={colors.onPrimary} />
                </ShapeAvatar>
              }>
              <AppText variant="bodyLarge">{keepUnits(w.projection.text)}</AppText>
            </Finding>
          ) : (
            <Finding icon="flag-checkered" tone="primary">
              <AppText variant="bodyLarge">{keepUnits(w.projection.text)}</AppText>
              <View style={styles.block} accessible accessibilityLabel={progressText}>
                {progress ? <ProportionBar value={progress.share} /> : null}
                <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
                  {keepUnits(progressText)}
                </AppText>
              </View>
            </Finding>
          )
        ) : (
          <Finding icon="target" tone="ring">
            <AppText variant="bodyLarge">{keepUnits(w.projection.text)}</AppText>
            <ActionButton action="set-goal" onAction={onAction} />
          </Finding>
        )}
      </ChartCard>

      {recalc ? (
        <View style={[styles.suggestion, { backgroundColor: colors.surfaceContainerHigh }]}>
          <Finding icon="calculator-variant-outline" tone="primary">
            <AppText variant="bodyLarge">{keepUnits(recalc.text)}</AppText>
            <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
              {keepUnits(recalcSummary(recalc))}
            </AppText>
          </Finding>
          {/* A suggestion can be declined: it then stays away until the weight has moved as far again. */}
          <View style={styles.actions}>
            <Button variant="tonal" title="Use new targets" icon="check" onPress={() => onRecalculate(recalc.toKg)} hitSlop={4} />
            <Button variant="text" title="Keep my targets" onPress={() => onKeepTargets(recalc.toKg)} hitSlop={4} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- 3. calories

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

  // The small print: what was left out first, then what the words on this card mean.
  const notes: string[] = [];
  if (c.note) notes.push(c.note);
  notes.push(`A full day has at least ${formatKcal(period.completeDayKcal)} kcal logged.`);
  if (period.firstLoggedDate && period.firstLoggedDate > period.from) {
    notes.push(`Days are counted from your first log on ${formatShortDate(period.firstLoggedDate)}.`);
  }
  if (c.bars.some((b) => b.status === 'within' && b.calories !== null && b.calories > c.goal)) {
    notes.push('A day can pass the goal line and stay within budget: a workout raises that day’s budget.');
  }

  return (
    <ChartCard>
      {average.ready ? (
        <Figure
          value={formatKcal(average.kcal)}
          unit="kcal a day on average"
          // The average carries the days it is over, then how it compares; the budget line joins it to the bars below.
          lines={[`Across ${plural(average.days, 'full day')}. ${averageVsGoalText(average.vsGoal, c.goal)}.`, c.budgetText]}
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
      <StatRow>
        <Stat value={`${c.loggedDays} of ${c.countedDays}`} label="Days logged" />
        {c.completeDays > 0 ? <Stat value={`${c.withinBudgetDays} of ${c.completeDays}`} label="Full days within budget" /> : null}
        <Stat value={String(c.overBudgetDays)} label={c.overBudgetDays === 1 ? 'Day over budget' : 'Days over budget'} />
      </StatRow>
      <Note>{notes.join(' ')}</Note>
    </ChartCard>
  );
}

// ---------------------------------------------------------------- 4. week by week

/** The period as whole weeks, newest first: one row each, so one week can be read against the next. */
function WeekRows({ weeks, today }: { weeks: WeekBlock[]; today: string }) {
  return (
    <Group>
      {weeks.map((block) => {
        const text = weekRowText(block, today);
        return (
          <ListRow
            key={block.from}
            icon="calendar-week"
            tone="secondary"
            headline={text.title}
            lines={[text.weight, text.exercise, text.note]}
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

function MaintenanceCard({ m }: { m: MaintenanceInfo }) {
  const { colors } = useTheme();
  // The estimate is the data, and it is a range. What it is compared with is neutral, like the dashed goal lines.
  const reference = colors.outline;
  const rows = [
    { label: 'You eat', kcal: m.averageIntake },
    { label: 'Your goal', kcal: m.goal.kcal },
  ];
  if (m.formulaKcal !== null) rows.push({ label: 'Calculator estimate', kcal: m.formulaKcal });
  const [high, low, ...shares] = relativeToLargest([m.high, m.low, ...rows.map((r) => r.kcal)]);

  return (
    <ChartCard>
      <Figure value={`About ${formatKcal(m.kcal)}`} unit="kcal a day" range={m.rangeText} lines={[maintenanceBasisText(m)]} />
      <View style={styles.rows}>
        <BarRow
          label="You burn"
          value={`${formatKcal(m.low)} to ${formatKcal(m.high)} kcal`}
          share={low}
          upTo={high}
          color={colors.primary}
          spoken={`You burn, between ${formatKcal(m.low)} and ${formatKcal(m.high)} calories a day`}
        />
        {rows.map((r, i) => (
          <BarRow
            key={r.label}
            label={r.label}
            value={`${formatKcal(r.kcal)} kcal`}
            share={shares[i]}
            color={reference}
            spoken={`${r.label}, ${formatKcal(r.kcal)} calories a day`}
          />
        ))}
      </View>
      <View style={styles.block}>
        <AppText variant="bodyLarge">{keepUnits(m.goal.text)}</AppText>
        {m.formulaText ? (
          <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
            {keepUnits(m.formulaText)}
          </AppText>
        ) : null}
      </View>
      <Note>{m.note}</Note>
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

function MacrosCard({ m }: { m: MacrosInfo }) {
  const { colors, dark } = useTheme();
  const palette = categoryColors(colors.primary, dark);
  const split = m.split;
  const hasProteinGoal = m.protein.goal > 0;

  return (
    <ChartCard>
      <Answer
        title={hasProteinGoal ? `Protein goal met on ${m.proteinDays} of ${plural(m.days, 'full day')}` : `Daily averages over ${plural(m.days, 'full day')}`}
        detail={hasProteinGoal ? `A day counts when you reach at least ${percentText(PROTEIN_HIT_SHARE)} of your protein goal.` : undefined}
      />
      <View style={styles.block}>
        <SubLabel>Daily average against your goal</SubLabel>
        <View style={styles.rows}>
          {MACROS.map(({ key, label }) => {
            const a = m[key];
            return (
              <BarRow
                key={key}
                label={label}
                value={macroValue(a)}
                share={a.ratio ?? 0}
                color={palette[key].color}
                dot={palette[key].color}
                spoken={`${label}, ${Math.round(a.average)} grams a day${a.goal > 0 ? `, goal ${Math.round(a.goal)}` : ''}`}
              />
            );
          })}
        </View>
      </View>
      {split ? (
        <View style={styles.block}>
          <SubLabel>Where your calories come from</SubLabel>
          <View
            style={styles.block}
            accessible
            accessibilityLabel={`Calories: ${percentText(split.protein)} from protein, ${percentText(split.carbs)} from carbs, ${percentText(split.fat)} from fat`}>
            <StackedBar segments={MACROS.map(({ key }) => ({ value: split[key], color: palette[key].color }))} />
            <Legend items={MACROS.map(({ key, label }) => ({ mark: 'dot', color: palette[key].color, label: `${label} ${percentText(split[key])}` }))} />
          </View>
        </View>
      ) : null}
      {m.note ? <Note>{m.note}</Note> : null}
    </ChartCard>
  );
}

// ---------------------------------------------------------------- 7. exercise

/** Movement, in the tertiary throughout: the chart card, a pair of totals, then the top activities as a group. */
function ExerciseGroup({ e, period }: { e: ExerciseInfo; period: Period }) {
  // A weekly average needs a week of use; before that the line is left out and the answer stands alone.
  const weekly = e.perWeek
    ? `${e.perWeek.workouts} ${e.perWeek.workouts === 1 ? 'workout' : 'workouts'} and ${formatMinutes(e.perWeek.minutes)} a week on average`
    : undefined;

  return (
    <View style={styles.group}>
      <ChartCard>
        <Answer title={`${plural(e.workouts, 'workout')} on ${plural(e.activeDays, 'day')}`} detail={weekly} />
        <View style={styles.block}>
          <SubLabel>Minutes each day</SubLabel>
          <BarChart
            bars={exerciseChartBars(chartRows(e.daily, period))}
            axis={periodAxis(period.chartFrom, period.chartDays, period.to)}
            height={64}
            accessibilityLabel={describeExerciseChart(e, period.to)}
          />
        </View>
      </ChartCard>
      <View style={styles.grid}>
        <FactTile icon="timer-outline" tone="tertiary" value={formatMinutes(e.minutes)} label="Total time" />
        <FactTile icon="fire" tone="tertiary" value={`${formatKcal(e.calories)} kcal`} label="Burned in workouts" />
      </View>
      {e.top.length ? (
        <>
          <ListHeader title="Top activities by time" />
          <Group>
            {e.top.map((a) => (
              <ListRow
                key={a.activity}
                icon={a.icon as IconName}
                tone="tertiary"
                headline={a.label}
                lines={[`${plural(a.workouts, 'workout')}, ${formatKcal(a.calories)} kcal`, `${percentText(a.share)} of your exercise time`]}
                figure={{ value: formatMinutes(a.minutes) }}
                spoken={`${a.label}, ${formatMinutes(a.minutes)} in ${plural(a.workouts, 'workout')}, ${percentText(a.share)} of your exercise time`}
              />
            ))}
          </Group>
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- 8. consistency

function ConsistencyGroup({ c, period, onOpenDay }: { c: ConsistencyInfo; period: Period; onOpenDay: (date: string) => void }) {
  const { colors } = useTheme();
  const streak = c.streak;
  const nudge =
    streak.current === 0
      ? 'Log a meal today to start a new streak.'
      : `${streak.loggedToday ? 'Today is logged.' : 'Log a meal today to keep your streak going.'}${streak.current > 1 && streak.current === streak.best ? ' This is your longest run so far.' : ''}`;
  // One entry for each mark the calendar draws. A day with nothing logged has no mark, so it has no entry.
  const legend: LegendEntry[] = [
    { mark: 'cookie', color: colors.primary, label: 'Within budget' },
    { mark: 'capped', color: colors.primary, accent: colors.error, label: 'Over budget' },
    { mark: 'speck', color: colors.primary, label: 'Not a full day' },
  ];
  // A week or a month has rows tall enough to tap; ninety days keep their small cells and open nothing.
  const tappable = period.days <= 30;
  // The counts as one sentence that adds up, from the data layer: its opening is the answer, the rest what it adds up from.
  const answer = splitAnswer(c.text);

  return (
    <View style={styles.group}>
      <View style={styles.grid}>
        <FactTile icon="calendar-check" tone="secondary" value={plural(streak.current, 'day')} label="Current streak" />
        <FactTile icon="medal-outline" tone="secondary" value={plural(streak.best, 'day')} label="Best streak" />
      </View>
      <ChartCard>
        <Answer title={answer.lead} detail={answer.rest} />
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
        <View style={styles.block}>
          {c.skipped ? <AppText variant="bodyLarge">{c.skipped.text}</AppText> : null}
          <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
            {nudge}
          </AppText>
          {tappable ? (
            // For the eye only: to a screen reader the calendar is one image, and "Every day" is the way to a day.
            <AppText variant="bodySmall" color={colors.onSurfaceVariant} importantForAccessibility="no" accessibilityElementsHidden>
              Tap a day to open it.
            </AppText>
          ) : null}
        </View>
      </ChartCard>
    </View>
  );
}

// ---------------------------------------------------------------- 9. patterns

/**
 * Three findings, each in the container that suits it: weekdays against weekends is a card with two
 * figures, the meals are a group with the same avatars as Today's meals, and the day of the week
 * is a card with its chart.
 */
function PatternsGroup({ p, onAction }: { p: PatternsInfo; onAction: InsightActionHandler }) {
  const split = p.weekSplit;
  const highest = p.highestDay;
  const biggestMeal = biggestMealText(p.meals);

  return (
    <View style={styles.group}>
      <ChartCard>
        <SubLabel>Weekdays and weekends</SubLabel>
        {split.ready ? (
          <>
            <Answer title={split.text} />
            <StatRow>
              <Stat value={`${formatKcal(split.weekday.average)} kcal`} label={`Weekdays, ${plural(split.weekday.days, 'full day')}`} />
              <Stat value={`${formatKcal(split.weekend.average)} kcal`} label={`Weekends, ${plural(split.weekend.days, 'full day')}`} />
            </StatRow>
          </>
        ) : (
          <Pending card={split} onAction={onAction} />
        )}
      </ChartCard>

      <ListHeader title="Calories by meal" answer={biggestMeal} />
      <Group>
        {p.meals.map((m) => (
          <ListRow
            key={m.meal}
            icon={MEAL_ICONS[m.meal]}
            tone="secondary"
            headline={m.label}
            lines={[`${formatKcal(m.average)} kcal a day`]}
            figure={{ value: percentText(m.share) }}
            spoken={`${m.label}, ${percentText(m.share)} of your calories, ${formatKcal(m.average)} a day`}
          />
        ))}
      </Group>

      <ChartCard>
        <SubLabel>Day of the week</SubLabel>
        {highest.ready ? (
          <>
            <Answer title={highest.text} />
            {/* Drawn only with enough days behind it. A bar is picked out only when its day really stands out. */}
            <BarChart
              bars={weekdayChartBars(p.byWeekday, highest.standsOut ? highest.weekday : null)}
              axis={WEEKDAY_AXIS}
              height={72}
              accessibilityLabel={describeWeekdayChart(p.byWeekday)}
            />
          </>
        ) : (
          <Pending card={highest} onAction={onAction} />
        )}
      </ChartCard>
    </View>
  );
}

// ---------------------------------------------------------------- 10. top foods

function TopFoodRows({ foods }: { foods: TopFood[] }) {
  return (
    <Group>
      {foods.map((f) => (
        <ListRow
          key={f.name}
          icon={foodIcon(f.name)}
          tone="secondary"
          headline={f.name}
          // Two lines, each a whole phrase: as one line it is a few letters too long for the row and breaks before its last word.
          lines={[`Logged ${plural(f.count, 'time')}`, `${percentText(f.share)} of your calories`]}
          figure={{ value: formatKcal(f.calories), label: 'kcal' }}
          spoken={`${f.name}, ${formatKcal(f.calories)} calories from ${plural(f.count, 'time')}, ${percentText(f.share)} of your calories`}
        />
      ))}
    </Group>
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
  const { period, weight, calories, weeks, maintenance, macros, exercise, consistency, patterns, topFoods } = insights;
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
        <SectionHeader title="What you actually burn" hint={maintenance.ready ? CONFIDENCE_LABEL[maintenance.confidence] : undefined} />
        {maintenance.ready ? <MaintenanceCard m={maintenance} /> : <NotReadyTile icon="fire" card={maintenance} onAction={onAction} />}
      </View>

      <View>
        <SectionHeader title="Macros" hint={macros.ready ? plural(macros.days, 'full day') : undefined} />
        {macros.ready ? <MacrosCard m={macros} /> : <NotReadyTile icon="egg-outline" card={macros} onAction={onAction} />}
      </View>

      <View onLayout={(e) => onSectionLayout('exercise', e.nativeEvent.layout.y)}>
        <SectionHeader title="Exercise" hint={exercise.ready ? formatMinutes(exercise.minutes) : undefined} />
        {exercise.ready ? <ExerciseGroup e={exercise} period={period} /> : <NotReadyTile icon="run" card={exercise} onAction={onAction} />}
      </View>

      <View onLayout={(e) => onSectionLayout('consistency', e.nativeEvent.layout.y)}>
        <SectionHeader
          title="Consistency"
          hint={consistency.ready ? `${consistency.loggedDays} of ${plural(consistency.countedDays, 'day')} logged` : undefined}
        />
        {consistency.ready ? (
          <ConsistencyGroup c={consistency} period={period} onOpenDay={onOpenDay} />
        ) : (
          <NotReadyTile icon="calendar-check" card={consistency} onAction={onAction} />
        )}
      </View>

      <View>
        <SectionHeader title="Patterns" hint={patterns.ready ? `From ${plural(patterns.days, 'full day')}` : undefined} />
        {patterns.ready ? (
          <PatternsGroup p={patterns} onAction={onAction} />
        ) : (
          <NotReadyTile icon="lightbulb-on-outline" card={patterns} onAction={onAction} />
        )}
      </View>

      <View>
        <SectionHeader title="Top foods" hint={topFoods.ready ? 'Most calories first' : undefined} />
        {topFoods.ready ? <TopFoodRows foods={topFoods.foods} /> : <NotReadyTile icon="food-outline" card={topFoods} onAction={onAction} />}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  start: { alignSelf: 'flex-start' },

  // The one focal tile: the same corners and the same inset as Today's hero.
  focal: { padding: Spacing.xl, borderRadius: Shape.extraLargeIncreased, gap: Spacing.md },
  focalHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  basis: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, paddingTop: Spacing.xs },
  basisItem: { flex: 1, minWidth: 0 },
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

  // Tiles in a grid: the glance tiles and the pairs of small facts.
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
  fact: {
    flexBasis: '45%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 72,
    padding: Spacing.md,
    borderRadius: Shape.largeIncreased,
  },

  // A section's pieces: a card, a pair of tiles, a group.
  group: { gap: Spacing.sm },
  card: { padding: Spacing.xl, borderRadius: Shape.extraLarge, gap: Spacing.lg },
  // The same inset as the card above it, so the two avatars line up.
  suggestion: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg, borderRadius: Shape.largeIncreased, gap: Spacing.md },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, minHeight: 72, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },

  // A list row, with GroupRow's measures.
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  rowFigure: { alignItems: 'flex-end', maxWidth: 112 },
  rowFigureLabel: { textAlign: 'right' },
  listHeader: { paddingHorizontal: Spacing.xs, paddingTop: Spacing.sm, gap: Spacing.xxs },

  // Inside a card.
  answer: { gap: Spacing.xxs },
  block: { gap: Spacing.sm },
  rows: { gap: Spacing.md },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  finding: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.lg },
  findingBody: { flex: 1, minWidth: 0, gap: Spacing.sm },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.md, rowGap: Spacing.md },
  stat: { flexGrow: 1, flexBasis: '28%', minWidth: 84 },
  barRow: { gap: Spacing.xs },
  barRowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  dot: { width: 8, height: 8, borderRadius: Shape.full, marginTop: 6 },
});
