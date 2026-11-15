import * as Haptics from 'expo-haptics';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CaloriesTile, MacroTiles } from '@/components/calorie-summary';
import { CheckInCard } from '@/components/check-in-card';
import { CoachCard } from '@/components/coach-card';
import { HeadsUp } from '@/components/heads-up';
import { ButtonGroup } from '@/components/expressive';
import { useSnackbar, useSnackbarAboveFab } from '@/components/snackbar';
import { ExerciseSection, FavouritePills, MealTiles, StreakBadge, WeightExerciseTiles } from '@/components/today-tiles';
import { ExtendedFab, ScreenHeader, SectionHeader } from '@/components/ui';
import { VOICE_LOGGING } from '@/constants/features';
import { FAB_CLEARANCE, Spacing } from '@/constants/theme';
import { useDayActivity, useLiveQuery, useToday } from '@/hooks/use-live-query';
import { useTheme } from '@/hooks/use-theme';
import { dateKeyToDate, mealForTime } from '@/lib/dates';
import { coachTip } from '@/lib/coach';
import { getDayExerciseCalories, getEntriesForDate, getExercisesForDate, getFavourites, getKnownFoods } from '@/lib/db';
import { loadCheckIn, loadCurrentWeightKg, loadTodaySummary } from '@/lib/insights-data';
import { dismissNudge, loadNudges, markNudgesSeen } from '@/lib/nudges-data';
import type { Nudge } from '@/lib/nudges';
import { refreshHeadsUp } from '@/lib/reminders';
import { deleteEntries, logFavourite } from '@/lib/logging';
import { burnedForBudget, formatKcal, sumMacros } from '@/lib/nutrition';
import { finishCheckIn, getSettings, updateSettings } from '@/lib/settings';
import { MEAL_LABELS, type LogMode, type SavedFood } from '@/lib/types';
import { refreshWidgets } from '@/widget/refresh';

const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

/**
 * Today, top to bottom: the header with the streak badge, the calories hero, the macro tiles, the
 * weight and exercise tiles, the weekly check-in when one is due, what the app noticed (Heads up),
 * the coach's next step, the favourites to log again, the meals, and the day's workouts.
 * Logging food is the FAB.
 */
export default function TodayScreen() {
  const { push, navigate } = useRouter();
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
  const knownFoods = useLiveQuery(() => getKnownFoods(40), []);
  const checkIn = useLiveQuery(() => loadCheckIn(today), [today]);
  const currentKg = useLiveQuery(() => loadCurrentWeightKg(today), [today]);
  // At most three, so Today stays about today.
  const nudges = useLiveQuery(() => loadNudges(today), [today]).slice(0, 3);
  const shownIds = nudges.map((n) => n.id).join(',');
  useEffect(() => {
    // What is on screen now is never sent again as a notification; tomorrow's is worked out afresh.
    if (shownIds) markNudgesSeen(shownIds.split(','));
    void refreshHeadsUp();
  }, [shownIds, today]);

  const followNudge = (n: Nudge) => {
    const a = n.action;
    if (!a) return;
    if (a.to === 'log-food') push({ pathname: '/log', params: { mode: 'text', ...(a.date ? { date: a.date } : {}) } });
    else if (a.to === 'log-weight') push({ pathname: '/weight', params: { date: today } });
    else if (a.to === 'log-exercise') push({ pathname: '/exercise', params: { date: today } });
    else navigate('/progress');
  };
  // The coach's budget is the Calories tile's: the goal, workouts logged here, and other apps'
  // activity when that is switched on.
  const counted = burnedForBudget(exerciseKcal, activity?.activeCalories ?? 0, settings.countExerciseCalories);
  const tip = coachTip({
    hour: new Date().getHours(),
    eaten: totals,
    budget: settings.calorieGoal + counted,
    proteinGoal: settings.proteinGoal,
    goal: settings.profile?.goal ?? null,
    entryCount: entries.length,
    foods: knownFoods,
  });

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

  // Taking or putting off the check-in both wait a week for the next; Undo puts back what was there.
  const finish = (take: boolean) => {
    if (!checkIn) return;
    const before = finishCheckIn(take && !checkIn.onTrack ? checkIn.targets : null, today, currentKg);
    void refreshWidgets();
    if (checkIn.onTrack) return;
    showSnack(take ? 'Targets updated' : 'Check-in moved to next week', {
      label: 'Undo',
      onPress: () => {
        updateSettings({
          calorieGoal: before.calorieGoal,
          proteinGoal: before.proteinGoal,
          carbsGoal: before.carbsGoal,
          fatGoal: before.fatGoal,
          targetsWeightKg: before.targetsWeightKg,
          lastCheckInDate: before.lastCheckInDate,
        });
        void refreshWidgets();
      },
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

        {checkIn ? <CheckInCard checkIn={checkIn} onApply={() => finish(true)} onSkip={() => finish(false)} /> : null}

        {nudges.length > 0 ? (
          <View>
            <SectionHeader title="Heads up" />
            <HeadsUp nudges={nudges} onAction={followNudge} onDismiss={(n) => dismissNudge(n.id)} />
          </View>
        ) : null}

        {tip ? (
          <View>
            <SectionHeader title="Next step" />
            <CoachCard tip={tip} onLog={(f) => void quickLog(f)} onAsk={() => navigate('/assistant')} />
          </View>
        ) : null}

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
