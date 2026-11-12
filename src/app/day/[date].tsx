import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { DaySummaryTile } from '@/components/calorie-summary';
import { DayLog } from '@/components/day-log';
import { ExerciseSection, WeightRow } from '@/components/today-tiles';
import { useSnackbar } from '@/components/snackbar';
import { ScreenHeader, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useDayActivity, useLiveQuery, useToday } from '@/hooks/use-live-query';
import { addDays, dateKeyToDate, formatDayLabel } from '@/lib/dates';
import { getDayExerciseCalories, getEntriesForDate, getExercisesForDate, getLatestWeight, getMealsLoggedOn, getWeight } from '@/lib/db';
import { copyMeal } from '@/lib/logging';
import { burnedForBudget, formatKcal, sumMacros } from '@/lib/nutrition';
import { getSettings } from '@/lib/settings';

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
          <DaySummaryTile totals={totals} goal={settings.calorieGoal} burned={burned} />
        </View>
        <View>
          <SectionHeader title="Meals" hint={entries.length > 0 ? `${formatKcal(totals.calories)} kcal` : undefined} />
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
          <SectionHeader title="Exercise" hint={burned > 0 ? `+${formatKcal(burned)} kcal` : undefined} />
          <ExerciseSection exercises={exercises} date={date} />
        </View>
        {/* A weigh-in belongs to a day that has begun, so a day still to come has no weight row. */}
        {date <= today ? (
          <View>
            <SectionHeader title="Weight" />
            <WeightRow weight={weight} previous={previousWeight} date={date} today={today} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.xl, paddingBottom: Spacing.xxl },
  // The navigation bar above already gives the top room.
  header: { paddingTop: 0 },
});
