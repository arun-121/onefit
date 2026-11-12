/**
 * The rest of Today under the calories hero, in the same language: the streak badge in the header,
 * the weight and exercise tiles, the "Log again" pills, and the meals and workouts as segmented
 * groups. The day view reuses the exercise and weight groups.
 *
 * A tile or an avatar is lit in its subject's colour when it holds something from today, and
 * neutral with a ring avatar when it is waiting (docs/DESIGN.md).
 */
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Alpha, Shape, Spacing, TOUCH_TARGET, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ACTIVITIES, formatMinutes, INTENSITY_LABELS } from '@/lib/exercise';
import type { Streak, TodaySummary } from '@/lib/insights';
import { formatKcal, sumMacros } from '@/lib/nutrition';
import { MEAL_LABELS, MEALS, type Entry, type Exercise, type Meal, type SavedFood, type WeightEntry } from '@/lib/types';
import { formatKg } from '@/lib/weight';
import { ShapeAvatar } from './expressive';
import {
  changeSincePrevious,
  exerciseTileText,
  keepUnits,
  streakBadgeText,
  TREND_ICONS,
  weightTileText,
  type TileText,
} from './screen-text';
import { AppText, Avatar, Group, GroupRow, Icon, SectionHeader, Tappable, type IconName } from './ui';

// Other screens import the section header from here.
export { SectionHeader };

export const MEAL_ICONS: Record<Meal, IconName> = {
  breakfast: 'weather-sunset-up',
  lunch: 'white-balance-sunny',
  dinner: 'weather-night',
  snack: 'cookie-outline',
};

/** A food's icon from its name, so a favourite reads at a glance like Home's device tiles. */
export function foodIcon(name: string): IconName {
  // Match at the start of words, so "veggie" isn't an egg and "goat cheese" isn't oats.
  const n = name.toLowerCase();
  if (/\b(coffee|tea|latte|espresso|cappuccino|chai)\b/.test(n)) return 'coffee';
  if (/\b(eggs?\b|omelet)/.test(n)) return 'egg-outline';
  if (/\b(apple|banana|fruit|orange|mango|berr|grape)/.test(n)) return 'food-apple-outline';
  if (/\b(rice|oat|porridge|cereal|muesli|biryani|curr(y|ies)|khichdi|dal\b)/.test(n)) return 'rice';
  if (/\b(bread|toast|sandwich|roti|chapati|paratha|naan)/.test(n)) return 'bread-slice-outline';
  return 'silverware-fork-knife';
}

/** The plus at the end of an unlit row or tile. Only a cue: the whole surface is the button. */
function AddCue({ color }: { color?: string }) {
  return (
    <View importantForAccessibility="no-hide-descendants">
      <Icon name="plus" size={24} color={color} />
    </View>
  );
}

// ---------------------------------------------------------------- header

/**
 * The streak, as the cookie badge in Today's header: the run of logged days inside the scalloped
 * shape that means "a good day" across the app. Lit in `primary` once today is logged, neutral
 * before. A tap opens Progress.
 */
export function StreakBadge({ streak }: { streak: Streak }) {
  const { navigate } = useRouter();
  const { colors } = useTheme();
  const text = streakBadgeText(streak);
  const on = text.lit ? colors.onPrimary : colors.onSurfaceVariant;
  return (
    <Tappable
      scale={0.95}
      onPress={() => navigate('/progress')}
      accessibilityLabel={text.label}
      rippleColor={withAlpha(on, Alpha.pressed)}
      style={styles.badge}>
      <ShapeAvatar shape="cookie9" size={TOUCH_TARGET} color={text.lit ? colors.primary : colors.surfaceContainerHigh}>
        {/* The badge is a fixed size, so its number grows only a little with the font size. */}
        <AppText variant="titleMedium" emphasized tabular color={on} numberOfLines={1} maxFontSizeMultiplier={1.15}>
          {text.count}
        </AppText>
      </ShapeAvatar>
    </Tappable>
  );
}

// ---------------------------------------------------------------- weight and exercise tiles

/**
 * One of the two tiles under the macros: an avatar and a small cue on top, then the figure and
 * one supporting line. Lit in `container` when it holds something from today.
 */
function FactTile({
  icon,
  text,
  cue,
  container,
  on,
  onPress,
}: {
  icon: IconName;
  text: TileText;
  /** The small icon top right: a trend for a lit weight tile, a plus for an unlit tile. */
  cue: IconName | null;
  /** The container colour of a lit tile, and the colour of what is on it. */
  container: string;
  on: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const fg = text.lit ? on : colors.onSurface;
  const quiet = text.lit ? on : colors.onSurfaceVariant;
  // A figure ("74.2 kg") gets the tile figure style; an invitation ("Log exercise") is a label, a step quieter.
  const figure = /^\d/.test(text.title);
  return (
    <Tappable
      onPress={onPress}
      accessibilityLabel={text.label}
      rippleColor={withAlpha(fg, Alpha.pressed)}
      style={[styles.factTile, { backgroundColor: text.lit ? container : colors.surfaceContainerHigh }]}>
      <View style={styles.factTop}>
        <Avatar icon={icon} tone="ring" tint={text.lit ? on : undefined} size={36} />
        {cue ? <Icon name={cue} size={24} color={quiet} /> : null}
      </View>
      <View>
        <AppText variant={figure ? 'titleLarge' : 'titleMedium'} emphasized tabular color={fg} numberOfLines={2}>
          {keepUnits(text.title)}
        </AppText>
        <AppText variant="bodyMedium" color={quiet} numberOfLines={2}>
          {keepUnits(text.detail)}
        </AppText>
      </View>
    </Tappable>
  );
}

/**
 * Weight and exercise, side by side under the macros: the two things besides food that are logged
 * in a day, one tap each. Weight opens the weight sheet and is lit (primary) once today has a
 * weigh-in. Exercise opens the sheet for a new workout and is lit (tertiary) once one is logged.
 */
export function WeightExerciseTiles({ summary, today, exercises }: { summary: TodaySummary; today: string; exercises: Exercise[] }) {
  const { push } = useRouter();
  const { colors } = useTheme();
  const weight = weightTileText(summary.weight, today);
  const exercise = exerciseTileText(
    exercises.map((ex) => ({ activity: ACTIVITIES[ex.activity].label, minutes: ex.minutes, calories: ex.calories })),
  );
  // The latest workout's own icon once there is one.
  const latest = exercises.length > 0 ? exercises[exercises.length - 1] : null;
  return (
    <View style={styles.pair}>
      <FactTile
        icon="scale-bathroom"
        text={weight}
        cue={weight.lit ? weight.icon : 'plus'}
        container={colors.primaryContainer}
        on={colors.onPrimaryContainer}
        onPress={() => push('/weight')}
      />
      <FactTile
        icon={latest ? (ACTIVITIES[latest.activity].icon as IconName) : 'run'}
        text={exercise}
        cue={exercise.lit ? null : 'plus'}
        container={colors.tertiaryContainer}
        on={colors.onTertiaryContainer}
        onPress={() => push('/exercise')}
      />
    </View>
  );
}

// ---------------------------------------------------------------- log again

/**
 * The favourites as one row of pills that scrolls sideways and runs off both edges of the screen.
 * A tap logs the food again. Put it inside a parent with the screen's 16dp gutter: it bleeds out
 * of the gutter by itself.
 */
export function FavouritePills({ favourites, onLog }: { favourites: SavedFood[]; onLog: (food: SavedFood) => void }) {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.pills}>
      {favourites.map((food) => (
        <Tappable
          key={food.id}
          scale={0.96}
          onPress={() => onLog(food)}
          accessibilityLabel={`Log ${food.name}, ${Math.round(food.calories)} calories`}
          style={[styles.pill, { backgroundColor: colors.surfaceContainerHigh }]}>
          <Icon name={foodIcon(food.name)} size={20} color={colors.primary} />
          <AppText variant="labelLarge" numberOfLines={1} style={styles.pillName}>
            {food.name}
          </AppText>
          <AppText variant="labelMedium" tabular color={colors.onSurfaceVariant} numberOfLines={1}>
            {`${formatKcal(food.calories)} kcal`}
          </AppText>
        </Tappable>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- meals

/**
 * The four meals as a segmented group. A logged meal has a lit avatar, what was eaten on one line
 * and its calories at the right; a meal with nothing logged has a ring avatar and a plus. Each row
 * opens the meal's sheet, for `date` when one is given.
 */
export function MealTiles({ entries, date }: { entries: Entry[]; date?: string }) {
  const { push } = useRouter();
  return (
    <Group>
      {MEALS.map((meal) => {
        const items = entries.filter((e) => e.meal === meal);
        const total = sumMacros(items).calories;
        const empty = items.length === 0;
        return (
          <GroupRow
            key={meal}
            icon={MEAL_ICONS[meal]}
            tone={empty ? 'ring' : 'secondary'}
            headline={MEAL_LABELS[meal]}
            supporting={empty ? 'Not logged' : items.map((e) => e.name).join(', ')}
            supportingLines={1}
            trailing={
              empty ? (
                <AddCue />
              ) : (
                <AppText variant="titleMedium" tabular>
                  {formatKcal(total)}
                </AppText>
              )
            }
            onPress={() => push({ pathname: '/meal/[meal]', params: { meal, ...(date ? { date } : {}) } })}
            accessibilityLabel={`${MEAL_LABELS[meal]}, ${empty ? 'nothing logged' : `${formatKcal(total)} calories, ${items.length} item${items.length > 1 ? 's' : ''}`}`}
          />
        );
      })}
    </Group>
  );
}

// ---------------------------------------------------------------- exercise

/**
 * A day's workouts as a segmented group; each row opens its workout to edit. With `showAdd` (the
 * day view) the group ends with an unlit row that logs another one, and a day without workouts is
 * that row alone. Today leaves `showAdd` off, because its Exercise tile already logs a workout,
 * and then shows nothing for a day without one.
 */
export function ExerciseSection({
  exercises,
  date,
  showAdd = true,
}: {
  exercises: Exercise[];
  date?: string;
  showAdd?: boolean;
}) {
  const { push } = useRouter();
  const { colors } = useTheme();
  const open = (id?: number) =>
    push({ pathname: '/exercise', params: { ...(id ? { id: String(id) } : {}), ...(date ? { date } : {}) } });
  const none = exercises.length === 0;
  if (none && !showAdd) return null;

  return (
    <Group>
      {exercises.map((ex) => (
        <GroupRow
          key={ex.id}
          icon={ACTIVITIES[ex.activity].icon as IconName}
          tone="tertiary"
          headline={ACTIVITIES[ex.activity].label}
          supporting={`${formatMinutes(ex.minutes)}, ${INTENSITY_LABELS[ex.intensity].toLowerCase()}`}
          trailing={
            <AppText variant="labelLarge" tabular color={colors.tertiary}>
              {`+${formatKcal(ex.calories)} kcal`}
            </AppText>
          }
          onPress={() => open(ex.id)}
          accessibilityLabel={`${ACTIVITIES[ex.activity].label}, ${formatMinutes(ex.minutes)}, ${Math.round(ex.calories)} calories. Edit`}
        />
      ))}
      {showAdd ? (
        <GroupRow
          key="add"
          icon="run"
          tone="ring"
          headline={none ? 'Log exercise' : 'Log another workout'}
          supporting={none ? 'Workouts add to the day’s budget' : undefined}
          trailing={<AddCue />}
          onPress={() => open()}
          accessibilityLabel={none ? 'Log exercise' : 'Log another workout'}
        />
      ) : null}
    </Group>
  );
}

// ---------------------------------------------------------------- weight (day view)

/**
 * A day's weigh-in as a one-row group, for the day view: the weight and how it compares with the
 * weigh-in before it, or an unlit row with a ring avatar when the day has none. Either way it
 * opens the weight sheet for that day.
 */
export function WeightRow({
  weight,
  previous,
  date,
  today,
}: {
  weight: WeightEntry | null;
  /** The latest weigh-in before this day. */
  previous: WeightEntry | null;
  date: string;
  today: string;
}) {
  const { push } = useRouter();
  const { colors } = useTheme();
  const open = () => push({ pathname: '/weight', params: { date } });

  if (!weight) {
    return (
      <Group>
        <GroupRow
          icon="scale-bathroom"
          tone="ring"
          headline="Log weight"
          supporting="No weigh-in for this day"
          trailing={<AddCue />}
          onPress={open}
          accessibilityLabel="Log weight for this day"
        />
      </Group>
    );
  }

  const change = changeSincePrevious(weight.kg, previous, today);
  const detail = `${change ? change.text : 'Your first weigh-in'}${weight.source === 'health' ? '. From another app through Health Connect' : ''}`;
  return (
    <Group>
      {/* Weight is drawn in the primary colours everywhere, as movement is in the tertiary ones. */}
      <GroupRow
        icon="scale-bathroom"
        tone="primary"
        headline={formatKg(weight.kg)}
        supporting={keepUnits(detail)}
        trailing={
          change ? (
            <View importantForAccessibility="no-hide-descendants">
              <Icon name={TREND_ICONS[change.direction]} size={24} color={colors.onSurfaceVariant} />
            </View>
          ) : undefined
        }
        onPress={open}
        accessibilityLabel={`Weight, ${weight.kg.toFixed(1)} kilograms. ${detail}. Edit`}
      />
    </Group>
  );
}

const styles = StyleSheet.create({
  badge: { width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: Shape.full },
  pair: { flexDirection: 'row', gap: Spacing.sm },
  factTile: {
    flex: 1,
    minHeight: 112,
    justifyContent: 'space-between',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Shape.largeIncreased,
  },
  factTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  bleed: { marginHorizontal: -Spacing.lg },
  pills: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  pill: {
    height: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.lg,
    borderRadius: Shape.full,
  },
  pillName: { maxWidth: 168 },
});
