import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { DayLog } from '@/components/day-log';
import { BudgetRing } from '@/components/expressive';
import { DeltaChip } from '@/components/glance';
import { keepUnits, weightChange } from '@/components/screen-text';
import { MacroFigures } from '@/components/sheet-parts';
import { useSnackbar } from '@/components/snackbar';
import { ExerciseSection } from '@/components/today-tiles';
import { AppText, Group, GroupRow, Icon, ScreenHeader, SectionHeader, type IconName } from '@/components/ui';
import { Shape, Spacing } from '@/constants/theme';
import { useDayActivity, useLiveQuery, useToday } from '@/hooks/use-live-query';
import { useTheme } from '@/hooks/use-theme';
import { addDays, dateKeyToDate, formatDayLabel } from '@/lib/dates';
import { getDayExerciseCalories, getEntriesForDate, getExercisesForDate, getLatestWeight, getMealsLoggedOn, getWeight } from '@/lib/db';
import { copyMeal } from '@/lib/logging';
import { burnedForBudget, formatKcal, sumMacros } from '@/lib/nutrition';
import { getSettings } from '@/lib/settings';
import type { Macros, WeightEntry } from '@/lib/types';
import { formatKg } from '@/lib/weight';

const fullDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const dayAndMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });

/**
 * The header's two lines. Today and yesterday are named, with the date above; any other day is
 * its date, with the weekday above (and the year, when it is not this one).
 */
function dayHeading(date: string, today: string): { title: string; supporting: string } {
  const day = dateKeyToDate(date);
  if (date === today || date === addDays(today, -1)) return { title: formatDayLabel(date, dateKeyToDate(today)), supporting: fullDate.format(day) };
  const sameYear = day.getFullYear() === dateKeyToDate(today).getFullYear();
  return { title: dayAndMonth.format(day), supporting: sameYear ? weekday.format(day) : `${weekday.format(day)}, ${day.getFullYear()}` };
}

/** One day, in Today's language: the day at a glance, then its meals, workouts and weigh-in as segmented groups. */
export default function DayScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const showSnack = useSnackbar();
  const entries = useLiveQuery(() => getEntriesForDate(date), [date]);
  const previousMeals = useLiveQuery(() => getMealsLoggedOn(addDays(date, -1)), [date]);
  const settings = useLiveQuery(getSettings, []);
  const exercises = useLiveQuery(() => getExercisesForDate(date), [date]);
  const exerciseKcal = useLiveQuery(() => getDayExerciseCalories(date), [date]);
  const today = useToday();
  const weight = useLiveQuery(() => getWeight(date), [date]);
  const previousWeight = useLiveQuery(() => getLatestWeight(addDays(date, -1)), [date]);
  const activity = useDayActivity(date, settings.healthConnectEnabled);
  const totals = sumMacros(entries);
  // Same budget as Today: the goal plus what was burned that day.
  const burned = burnedForBudget(exerciseKcal, activity?.activeCalories ?? 0, settings.countExerciseCalories);
  const heading = dayHeading(date, today);

  return (
    <>
      {/* The bar keeps only the back arrow; the day is the screen's own header, as on the tabs. */}
      <Stack.Screen options={{ title: formatDayLabel(date), headerTitle: '' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View>
          <ScreenHeader title={heading.title} supporting={heading.supporting} style={styles.header} />
          <DayGlance totals={totals} goal={settings.calorieGoal} burned={burned} logged={entries.length > 0} />
        </View>
        {/* No totals beside these headers: eaten and burned are figures of the tile above, and each
            meal row carries its own. */}
        <View>
          <SectionHeader title="Meals" />
          <DayLog
            entries={entries}
            copyableMeals={previousMeals}
            onAdd={(meal) => router.push({ pathname: '/log', params: { mode: 'text', meal, date } })}
            onCopy={async (meal) => {
              const n = await copyMeal(addDays(date, -1), meal, date);
              showSnack(n > 0 ? `Copied ${n} item${n > 1 ? 's' : ''} from the day before` : 'Nothing to copy');
            }}
            onPressEntry={(e) => router.push({ pathname: '/entry/[id]', params: { id: String(e.id) } })}
          />
        </View>
        <View>
          <SectionHeader title="Exercise" />
          <ExerciseSection exercises={exercises} date={date} />
        </View>
        {/* A weigh-in belongs to a day that has begun, so a day still to come has no weight row. */}
        {date <= today ? (
          <View>
            <SectionHeader title="Weight" />
            <DayWeight weight={weight} previous={previousWeight} date={date} today={today} goalKg={settings.weightGoalKg} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

/**
 * The day at a glance, lit as food: the budget ring (eaten in its wavy primary arc, what exercise
 * added as a tertiary stretch) beside the one number, how far under or over it the day ended. Under
 * them, the three figures the ring is drawn from, each with an icon in the ring's own colour for
 * it, and the macros as figures in their category colours. No sentence: the budget that used to
 * be spelled out ("Budget 2,320: 2,000 goal plus 320 burned") is the three figures in a row.
 *
 * A day with no food logged is not a day under budget: the number is then the budget itself, said
 * to be untouched ("no food logged"), with no row of zeros. A workout that day still shows, beside
 * the goal it was added to.
 */
function DayGlance({ totals, goal, burned, logged }: { totals: Macros; goal: number; burned: number; logged: boolean }) {
  const { colors } = useTheme();
  const on = colors.onPrimaryContainer;
  // Rounded exactly as Today's hero does, so the two never disagree by one.
  const left = Math.round(goal + burned - totals.calories);
  const over = left < 0;
  const against = burned > 0 ? 'budget' : 'goal';
  const figure = formatKcal(logged ? Math.abs(left) : goal + burned);
  const line = logged ? `${over ? 'over' : 'under'} ${against}` : `${against}, no food logged`;
  return (
    <View style={[styles.hero, { backgroundColor: colors.primaryContainer }]}>
      <View style={styles.heroTop} accessible accessibilityLabel={`${figure} calories ${line}`}>
        <BudgetRing eaten={totals.calories} goal={goal} burned={burned} size={88} stroke={8} memory={null}>
          <Icon name="fire" size={24} color={on} />
        </BudgetRing>
        <View style={styles.fill}>
          <AppText variant="headlineMedium" emphasized tabular color={on} numberOfLines={1}>
            {`${figure}\u00A0kcal`}
          </AppText>
          <AppText variant="bodyLarge" color={on}>
            {line}
          </AppText>
        </View>
      </View>
      {logged ? (
        <>
          <View style={styles.stats}>
            <DayStat icon="silverware-fork-knife" tint={colors.primary} figure={formatKcal(totals.calories)} label="eaten" />
            <DayStat icon="run" tint={colors.tertiary} figure={formatKcal(burned)} label="burned" />
            <DayStat icon="flag-variant-outline" tint={on} figure={formatKcal(goal + burned)} label={against} />
          </View>
          <MacroFigures totals={totals} color={on} />
        </>
      ) : burned > 0 ? (
        // What the budget above is made of; the eaten cell would only say 0.
        <View style={styles.stats}>
          <DayStat icon="run" tint={colors.tertiary} figure={formatKcal(burned)} label="burned" />
          <DayStat icon="flag-variant-outline" tint={on} figure={formatKcal(goal)} label="goal" />
          <View style={styles.stat} />
        </View>
      ) : null}
    </View>
  );
}

/** One figure of the day's row: an 18dp icon in its subject's colour, the figure, and a word under it. */
function DayStat({ icon, tint, figure, label }: { icon: IconName; tint: string; figure: string; label: string }) {
  const { colors } = useTheme();
  const on = colors.onPrimaryContainer;
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${figure} calories ${label}`}>
      <View style={styles.statHead}>
        <Icon name={icon} size={18} color={tint} />
        <AppText variant="titleMedium" emphasized tabular color={on} numberOfLines={1}>
          {figure}
        </AppText>
      </View>
      <AppText variant="bodySmall" color={on} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

/**
 * The day's weigh-in as a one-row group: the weight, and how it compares with the weigh-in before
 * as a delta chip (filled when it is toward the target), with the weigh-in it is compared with
 * under the weight. Unlit, with a ring avatar, when the day has none. Either way it opens the
 * weight sheet for that day.
 */
function DayWeight({
  weight,
  previous,
  date,
  today,
  goalKg,
}: {
  weight: WeightEntry | null;
  /** The latest weigh-in before this day. */
  previous: WeightEntry | null;
  date: string;
  today: string;
  goalKg: number | null;
}) {
  const { push } = useRouter();
  const open = () => push({ pathname: '/weight', params: { date } });
  if (!weight) {
    return (
      <Group>
        <GroupRow
          icon="scale-bathroom"
          tone="ring"
          headline="Log weight"
          supporting="No weigh-in for this day"
          trailing={
            <View importantForAccessibility="no-hide-descendants">
              <Icon name="plus" size={24} />
            </View>
          }
          onPress={open}
          accessibilityLabel="Log weight for this day"
        />
      </Group>
    );
  }
  const change = weightChange(weight.kg, previous, today, goalKg);
  const fromHealth = weight.source === 'health';
  const said = `${change ? change.text : 'Your first weigh-in'}${fromHealth ? '. From another app through Health Connect' : ''}`;
  const since = change ? change.since.charAt(0).toUpperCase() + change.since.slice(1) : 'Your first weigh-in';
  return (
    <Group>
      {/* Weight is drawn in the primary colours everywhere, as movement is in the tertiary ones. */}
      <GroupRow
        icon="scale-bathroom"
        tone="primary"
        headline={formatKg(weight.kg)}
        supporting={keepUnits(fromHealth ? `${since}\nFrom Health Connect` : since)}
        trailing={
          change ? (
            // The chip sets itself to the start of its parent, so it is centred in a box of its own.
            <View style={styles.centred}>
              <DeltaChip direction={change.direction} amount={change.amount} towardGoal={change.towardGoal} />
            </View>
          ) : undefined
        }
        onPress={open}
        accessibilityLabel={`Weight, ${weight.kg.toFixed(1)} kilograms. ${said}${change?.towardGoal ? ', toward your target' : ''}. Edit`}
      />
    </Group>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.xl, paddingBottom: Spacing.xxl },
  // The navigation bar above already gives the top room.
  header: { paddingTop: 0 },
  fill: { flex: 1, minWidth: 0 },
  hero: { borderRadius: Shape.extraLargeIncreased, padding: Spacing.xl, gap: Spacing.lg },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  stats: { flexDirection: 'row', gap: Spacing.md },
  stat: { flex: 1, minWidth: 0, gap: 2 },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  centred: { alignSelf: 'center' },
});
