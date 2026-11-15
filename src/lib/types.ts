export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** A food as the AI (or the user) describes it, before it is saved. */
export interface FoodItem extends Macros {
  name: string;
  portion: string;
}

export type Confidence = 'low' | 'medium' | 'high';

/** An AI-parsed item shown on the review screen. */
export interface DraftItem extends FoodItem {
  key: string;
  confidence: Confidence;
}

export type EntrySource = 'text' | 'voice' | 'favourite' | 'copy' | 'manual';

export interface Entry extends FoodItem {
  id: number;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  meal: Meal;
  source: EntrySource;
  createdAt: number;
  hcRecordId: string | null;
}

export interface SavedFood extends FoodItem {
  id: number;
  pinned: boolean;
  useCount: number;
  lastUsedAt: number;
}

export type LogMode = 'text' | 'voice';

export interface NewExercise {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  activity: import('./exercise').Activity;
  minutes: number;
  intensity: import('./exercise').Intensity;
  /** Active calories burned (kcal). */
  calories: number;
  /** What the owner called it ("Bench press"); empty for a workout logged by picking an activity. */
  name?: string;
  /** What was done ("4 × 10 at 60 kg", "5 km"); empty when nothing more was said. */
  details?: string;
  sets?: number | null;
  /** Reps per set. */
  reps?: number | null;
  /** Weight lifted per rep, kg. */
  loadKg?: number | null;
  /** The MET the calories were worked out from, when the AI estimated them. */
  met?: number | null;
}

export interface Exercise extends NewExercise {
  id: number;
  createdAt: number;
  hcSessionId: string | null;
  hcCaloriesId: string | null;
}

export type WeightSource = 'manual' | 'health';

/** One weigh-in. There is at most one per calendar day; a second one that day replaces the first. */
export interface WeightEntry {
  id: number;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  kg: number;
  /** 'manual' was typed in here; 'health' was read from another app through Health Connect. */
  source: WeightSource;
  createdAt: number;
  /** Our own Health Connect record for a manual weigh-in, or the record a 'health' weigh-in was read from. */
  hcRecordId: string | null;
}
