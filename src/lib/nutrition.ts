import type { Macros } from './types';

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type GoalType = 'lose_fat' | 'build_muscle' | 'recomp' | 'maintain';

export interface Profile {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goal: GoalType;
  /** Kilograms a week to lose (lose_fat) or gain (build_muscle). Left out, the goal's usual pace. */
  rateKg?: number;
}

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Desk job, little exercise',
  light: 'Exercise 1–3 days a week',
  moderate: 'Exercise 3–5 days a week',
  active: 'Exercise 6–7 days a week',
  very_active: 'Physical job or twice-a-day training',
};

export const GOAL_LABELS: Record<GoalType, string> = {
  lose_fat: 'Lose fat',
  build_muscle: 'Build muscle',
  recomp: 'Lose fat, build muscle',
  maintain: 'Maintain weight',
};

/** The weekly pace each goal can be set to, in kg, and where it starts. Goals without a pace have none. */
export const GOAL_RATES: Partial<Record<GoalType, { min: number; max: number; usual: number }>> = {
  lose_fat: { min: 0.1, max: 1, usual: 0.5 },
  build_muscle: { min: 0.1, max: 0.5, usual: 0.25 },
};

/** Protein for each goal, in grams per kg of body weight: more when eating under what you burn, to keep muscle. */
const PROTEIN_PER_KG: Record<GoalType, number> = {
  lose_fat: 2,
  build_muscle: 2,
  recomp: 2.2,
  maintain: 1.6,
};

/** Roughly the energy in a kilogram of body weight change, spread over a week. */
const KCAL_PER_KG_WEEK = 7700 / 7;

/** Losing fat while building muscle eats this share under what you burn. */
const RECOMP_DEFICIT = 0.1;

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
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

/** The weekly pace a profile's goal works to, held to the goal's range; 0 for goals without one. */
export function goalRateKg(p: Pick<Profile, 'goal' | 'rateKg'>): number {
  const range = GOAL_RATES[p.goal];
  if (!range) return 0;
  const rate = p.rateKg !== undefined && Number.isFinite(p.rateKg) && p.rateKg > 0 ? p.rateKg : range.usual;
  return Math.min(range.max, Math.max(range.min, rate));
}

/** Calories a day the goal adds to (positive) or takes from (negative) what the profile burns. */
export function goalAdjustment(p: Profile): number {
  switch (p.goal) {
    case 'lose_fat':
      return -goalRateKg(p) * KCAL_PER_KG_WEEK;
    case 'build_muscle':
      return goalRateKg(p) * KCAL_PER_KG_WEEK;
    case 'recomp':
      return -RECOMP_DEFICIT * tdee(p);
    case 'maintain':
    default:
      return 0;
  }
}

/** Grams of protein per kg of body weight for a goal. */
export function proteinPerKg(goal: GoalType): number {
  return PROTEIN_PER_KG[goal] ?? PROTEIN_PER_KG.maintain;
}

/**
 * Daily targets from a profile: calories from TDEE plus the goal's adjustment, protein by goal
 * (1.6 to 2.2 g per kg), fat at 25% of calories, carbs fill the rest.
 */
export function calculateTargets(p: Profile): Targets {
  return splitTargets(tdee(p) + goalAdjustment(p), p.goal, p.weightKg);
}

/** Calories (to the nearest 10, never under the floor) split into macros for a goal and a body weight. */
export function splitTargets(rawCalories: number, goal: GoalType, weightKg: number): Targets {
  const calories = Math.max(MIN_CALORIE_TARGET, Math.round(rawCalories / 10) * 10);
  // A goal this version does not know (a profile not read through the settings) counts as maintain.
  const protein = Math.round((PROTEIN_PER_KG[goal] ?? PROTEIN_PER_KG.maintain) * weightKg);
  const fat = Math.round((calories * 0.25) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat };
}

/**
 * The calories a goal adds to or takes from a measured burn rather than the formula's: the same as
 * `goalAdjustment`, except that losing fat while building muscle is 10% under the measured figure.
 */
export function goalAdjustmentFrom(burnKcal: number, p: Pick<Profile, 'goal' | 'rateKg'>): number {
  switch (p.goal) {
    case 'lose_fat':
      return -goalRateKg(p) * KCAL_PER_KG_WEEK;
    case 'build_muscle':
      return goalRateKg(p) * KCAL_PER_KG_WEEK;
    case 'recomp':
      return -RECOMP_DEFICIT * burnKcal;
    case 'maintain':
    default:
      return 0;
  }
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
