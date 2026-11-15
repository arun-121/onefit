/**
 * Gathers what the Progress and Today figures are built from. This is the only part of insights
 * that touches SQLite; the sums live in `insights.ts`.
 *
 * Use with the live-query hook so the cards follow the data:
 *   const insights = useLiveQuery(() => loadInsights(today, days), [today, days]);
 */
import { weeklyCheckIn, type CheckIn } from './check-in';
import { addDays } from './dates';
import {
  getAllWeights,
  getDailyTotals,
  getExercisesBetween,
  getFirstExerciseDate,
  getLoggedDates,
  getMealCaloriesByDay,
  getTopFoods,
} from './db';
import { buildInsights, buildTodaySummary, currentWeightKg, type InsightPeriod, type Insights, type TodaySummary } from './insights';
import { getSettings } from './settings';

/** Every Progress card for the 7, 30 or 90 days ending today. */
export function loadInsights(today: string, days: InsightPeriod): Insights {
  const from = addDays(today, -(days - 1));
  const settings = getSettings();
  return buildInsights({
    today,
    days,
    goals: {
      calories: settings.calorieGoal,
      protein: settings.proteinGoal,
      carbs: settings.carbsGoal,
      fat: settings.fatGoal,
    },
    weightGoalKg: settings.weightGoalKg,
    goalStartDate: settings.goalStartDate,
    goalStartWeightKg: settings.goalStartWeightKg,
    profile: settings.profile,
    // Until a weigh-in moves it, the profile's weight is the weight the targets were worked out at.
    targetsWeightKg: settings.targetsWeightKg ?? settings.profile?.weightKg ?? null,
    dayTotals: getDailyTotals(from, today),
    exercises: getExercisesBetween(from, today),
    // All of them: the current weight, and the 7-day view's rate and weekly averages, reach back past the period.
    weights: getAllWeights(),
    mealCalories: getMealCaloriesByDay(from, today),
    topFoods: getTopFoods(from, today),
    loggedDates: getLoggedDates(),
    firstExerciseDate: getFirstExerciseDate(),
    // Today and the day view add other apps' activity to a day's budget only with both switches on
    // (the activity is read through Health Connect). It is not stored per day, so Progress cannot
    // count it, and says so on the Calories card.
    countsOtherActivity: settings.countExerciseCalories && settings.healthConnectEnabled,
  });
}

/** The streak, the latest weigh-in and the weekly rate over the last 30 days, for Today's two small tiles. */
export function loadTodaySummary(today: string): TodaySummary {
  return buildTodaySummary({ today, loggedDates: getLoggedDates(), weights: getAllWeights() });
}

/**
 * The weight now, the same figure Progress measures the target from on every period (see
 * `currentWeightKg`). Settings uses it for the line under the target weight, so the two screens
 * never disagree about how far there is to go. Null before the first weigh-in.
 */
export function loadCurrentWeightKg(today: string): number | null {
  return currentWeightKg(getAllWeights(), today);
}

/** The weekly check-in due today, or null (see `weeklyCheckIn`). */
export function loadCheckIn(today: string): CheckIn | null {
  const settings = getSettings();
  return weeklyCheckIn({
    today,
    lastCheckInDate: settings.lastCheckInDate,
    maintenance: loadInsights(today, 30).maintenance,
    profile: settings.profile,
    currentKg: currentWeightKg(getAllWeights(), today),
    goals: { calories: settings.calorieGoal, protein: settings.proteinGoal, carbs: settings.carbsGoal, fat: settings.fatGoal },
  });
}
