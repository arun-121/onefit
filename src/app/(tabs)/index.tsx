import * as Haptics from 'expo-haptics';
import { useIsFocused, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CaloriesTile, MacroTiles } from '@/components/calorie-summary';
import { ButtonGroup } from '@/components/expressive';
import { useSnackbar, useSnackbarAboveFab } from '@/components/snackbar';
import { ExerciseSection, FavouritePills, MealTiles, StreakBadge, WeightExerciseTiles } from '@/components/today-tiles';
import { ExtendedFab, ScreenHeader, SectionHeader } from '@/components/ui';
import { VOICE_LOGGING } from '@/constants/features';
import { FAB_CLEARANCE, Spacing } from '@/constants/theme';
import { useDayActivity, useLiveQuery, useToday } from '@/hooks/use-live-query';
import { useTheme } from '@/hooks/use-theme';
import { dateKeyToDate, mealForTime } from '@/lib/dates';
import { getDayExerciseCalories, getEntriesForDate, getExercisesForDate, getFavourites } from '@/lib/db';
import { loadTodaySummary } from '@/lib/insights-data';
import { deleteEntries, logFavourite } from '@/lib/logging';
import { formatKcal, sumMacros } from '@/lib/nutrition';
import { getSettings } from '@/lib/settings';
import { MEAL_LABELS, type LogMode, type SavedFood } from '@/lib/types';

const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

/**
 * Today, top to bottom: the header with the streak badge, the calories hero, the macro tiles, the
 * weight and exercise tiles, the favourites to log again, the meals, and the day's workouts.
 * Logging food is the FAB.
 */
export default function TodayScreen() {
  const { push } = useRouter();
  const showSnack = useSnackbar();
  const { colors } = useTheme();
  // A snackbar must not cover the FAB while this screen is the one on show.
  useSnackbarAboveFab(useIsFocused());

  const today = useToday();
  const settings = useLiveQuery(getSettings, []);
  const entries = useLiveQuery(() => getEntriesForDate(today), [today]);
  const favourites = useLiveQuery(() => getFavourites(8), []);
  const exercises = useLiveQuery(() => getExercisesForDate(today), [today]);
  const exerciseKcal = useLiveQuery(() => getDayExerciseCalories(today), [today]);
  const activity = useDayActivity(today, settings.healthConnectEnabled);
  const summary = useLiveQuery(() => loadTodaySummary(today), [today]);
  const totals = sumMacros(entries);

  const openLog = (mode: LogMode) => push({ pathname: '/log', params: { mode } });

  const quickLog = async (food: SavedFood) => {
    const meal = mealForTime();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const logged = await logFavourite(food, today, meal);
    showSnack(`Added ${food.name} to ${MEAL_LABELS[meal].toLowerCase()}`, {
      label: 'Undo',
      onPress: () => void deleteEntries(logged.map((e) => e.id)),
    });
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View>
          <ScreenHeader
            title="Today"
            supporting={dateFormat.format(dateKeyToDate(today))}
            trailing={<StreakBadge streak={summary.streak} />}
          />
          <View style={styles.tiles}>
            <CaloriesTile
              totals={totals}
              settings={settings}
              activity={activity}
              exerciseKcal={exerciseKcal}
              onOpenDay={() => push({ pathname: '/day/[date]', params: { date: today } })}
            />
            {VOICE_LOGGING ? (
              <ButtonGroup
                height={56}
                items={[
                  { label: 'Say it', icon: 'microphone', onPress: () => openLog('voice'), variant: 'filled' },
                  { label: 'Type it', icon: 'pencil-outline', onPress: () => openLog('text') },
                ]}
              />
            ) : null}
            <MacroTiles totals={totals} settings={settings} />
            <WeightExerciseTiles summary={summary} today={today} exercises={exercises} />
          </View>
        </View>

        {favourites.length > 0 ? (
          <View>
            <SectionHeader title="Log again" />
            <FavouritePills favourites={favourites} onLog={(f) => void quickLog(f)} />
          </View>
        ) : null}

        <View>
          <SectionHeader title="Meals" hint={entries.length > 0 ? `${formatKcal(totals.calories)} kcal` : undefined} />
          <MealTiles entries={entries} />
        </View>

        {exercises.length > 0 ? (
          <View>
            <SectionHeader title="Exercise" />
            <ExerciseSection exercises={exercises} showAdd={false} />
          </View>
        ) : null}
      </ScrollView>

      <ExtendedFab
        icon="plus"
        label="Log food"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          openLog('text');
        }}
        style={styles.fab}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // 24dp before each section header; the tiles of the top block are 8dp apart.
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.xl, paddingBottom: FAB_CLEARANCE },
  tiles: { gap: Spacing.sm },
  fab: { position: 'absolute', right: Spacing.lg, bottom: Spacing.lg },
});
