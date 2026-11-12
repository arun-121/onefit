import type { Macros } from './types';

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type GoalType = 'lose' | 'lose_slow' | 'maintain' | 'gain';

export interface Profile {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goal: GoalType;
}

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Desk job, little exercise',
  light: 'Exercise 1–3 days a week',
  moderate: 'Exercise 3–5 days a week',
  active: 'Exercise 6–7 days a week',
  very_active: 'Physical job or twice-a-day training',
};

export const GOAL_LABELS: Record<GoalType, string> = {
  lose: 'Lose ~0.5 kg a week',
  lose_slow: 'Lose ~0.25 kg a week',
  maintain: 'Maintain weight',
  gain: 'Gain slowly',
};

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const GOAL_ADJUSTMENT: Record<GoalType, number> = {
  lose: -500,
  lose_slow: -250,
  maintain: 0,
  gain: 300,
};

/** Never suggest a target below this; very low intakes need medical supervision. */
export const MIN_CALORIE_TARGET = 1200;

/** Mifflin–St Jeor resting energy expenditure. */
export function bmr(p: Profile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === 'male' ? base + 5 : base - 161;
}

export function tdee(p: Profile): number {
  return bmr(p) * ACTIVITY_FACTOR[p.activity];
}

export type Targets = Macros;

/**
 * Daily targets from a profile: calories from TDEE plus the goal adjustment,
 * protein at 1.6 g per kg, fat at 25% of calories, carbs fill the rest.
 */
export function calculateTargets(p: Profile): Targets {
  const raw = tdee(p) + GOAL_ADJUSTMENT[p.goal];
  const calories = Math.max(MIN_CALORIE_TARGET, Math.round(raw / 10) * 10);
  const protein = Math.round(1.6 * p.weightKg);
  const fat = Math.round((calories * 0.25) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat };
}

export function sumMacros(items: readonly Macros[]): Macros {
  return items.reduce<Macros>(
    (acc, i) => ({
      calories: acc.calories + i.calories,
      protein: acc.protein + i.protein,
      carbs: acc.carbs + i.carbs,
      fat: acc.fat + i.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/**
 * Calories burned that raise today's budget: workouts logged in the app always count;
 * active calories from other apps (via Health Connect) count only when the user opts in.
 */
export function burnedForBudget(loggedExercise: number, healthActive: number, countHealth: boolean): number {
  return Math.round(loggedExercise + (countHealth ? healthActive : 0));
}

/** Calories left for the day; exercise calories are added only when the user opts in. */
export function caloriesLeft(goal: number, eaten: number, activeBurned: number, countExercise: boolean): number {
  return Math.round(goal + (countExercise ? activeBurned : 0) - eaten);
}

export function formatKcal(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatGrams(n: number): string {
  return `${Math.round(n)}g`;
}
