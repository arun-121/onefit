/**
 * The coach card on Today: one next step for the rest of the day, worked out from what is logged,
 * the goal picked in Settings and the owner's own saved foods. Pure, so every sentence is tested.
 *
 * It only says what the numbers support: calories and protein left against today's budget and
 * goal, and foods whose saved portion fits what is left. It never suggests a food the owner has
 * not logged before.
 */
import { formatKcal, type GoalType } from './nutrition';
import type { Macros, SavedFood } from './types';

export interface CoachInput {
  /** Local hour, 0 to 23. */
  hour: number;
  eaten: Macros;
  /** Calories for today: the goal plus the workouts that count. */
  budget: number;
  proteinGoal: number;
  /** The goal from the targets calculator; null when it was never used. */
  goal: GoalType | null;
  /** Food entries logged today. */
  entryCount: number;
  /** Saved foods, most used first. */
  foods: readonly SavedFood[];
}

export interface CoachTip {
  title: string;
  body: string;
  /** Saved foods that fit what is left, best first; logged with one tap. */
  suggestions: SavedFood[];
}

/** Protein left below this many grams counts as reached. */
const PROTEIN_CLOSE_G = 10;
/** A food has to bring at least this much protein to be suggested for protein. */
const SUGGEST_MIN_PROTEIN_G = 8;
const MAX_SUGGESTIONS = 3;

const g = (n: number): string => `${Math.round(n)} g`;
const kcal = (n: number): string => `${formatKcal(n)} kcal`;

/** Saved foods with real protein that fit in `room` kcal, the most protein per calorie first. */
export function proteinFoods(foods: readonly SavedFood[], room: number, limit = MAX_SUGGESTIONS): SavedFood[] {
  return foods
    .filter((f) => f.protein >= SUGGEST_MIN_PROTEIN_G && f.calories > 0 && f.calories <= room)
    .map((f, i) => ({ f, i, density: f.protein / f.calories }))
    .sort((a, b) => b.density - a.density || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.f);
}

/** Saved foods that fill `room` kcal without going over, the ones logged most first. */
function fillingFoods(foods: readonly SavedFood[], room: number): SavedFood[] {
  return foods.filter((f) => f.calories >= 100 && f.calories <= room).slice(0, MAX_SUGGESTIONS);
}

export function coachTip(input: CoachInput): CoachTip | null {
  const { hour, eaten, budget, proteinGoal, goal, entryCount, foods } = input;
  const left = Math.round(budget - eaten.calories);
  const proteinLeft = proteinGoal > 0 ? Math.round(proteinGoal - eaten.protein) : 0;

  if (entryCount === 0) {
    if (hour < 11) {
      const picks = proteinGoal > 0 ? proteinFoods(foods, budget / 3) : [];
      return {
        title: proteinGoal > 0 ? `${g(proteinGoal)} of protein today` : 'A fresh day',
        body:
          proteinGoal > 0
            ? `Getting 25 to 40 g at breakfast makes the goal much easier to reach.${picks.length ? ' From your foods:' : ''}`
            : 'Log breakfast when you have it.',
        suggestions: picks,
      };
    }
    return { title: 'Nothing logged yet today', body: 'Log what you have eaten so far, so today counts in your averages.', suggestions: [] };
  }

  if (left < 0) {
    const over = kcal(-left);
    const body =
      goal === 'build_muscle'
        ? 'A surplus is what building muscle needs. Keep protein up and it will count.'
        : goal === 'maintain'
          ? 'One day over is fine. What matters is being close to your goal across the week.'
          : 'One day over will not undo your progress: your weekly average is what moves your weight. Keep the next meal light.';
    return { title: `${over} over today`, body, suggestions: [] };
  }

  if (proteinLeft >= PROTEIN_CLOSE_G) {
    const picks = proteinFoods(foods, left);
    const room = `${kcal(left)} left.`;
    const muscle = goal === 'build_muscle' || goal === 'recomp' ? ' Protein is what turns your training into muscle.' : '';
    return {
      title: `${g(proteinLeft)} of protein to go`,
      body: picks.length
        ? `${room}${muscle} These from your foods fit:`
        : `${room}${muscle} Eggs, chicken, fish, paneer, tofu, dal or Greek yogurt fit best.`,
      suggestions: picks,
    };
  }

  if (goal === 'build_muscle' && left >= 300 && hour >= 17) {
    const picks = fillingFoods(foods, left);
    return {
      title: `${kcal(left)} left to eat`,
      body: `Your protein is in. Building muscle needs the surplus too, so eat the rest today.${picks.length ? ' From your foods:' : ''}`,
      suggestions: picks,
    };
  }

  if (proteinGoal > 0) {
    return {
      title: proteinLeft <= 0 ? 'Protein goal reached' : 'Protein nearly there',
      body: left > 0 ? `${kcal(left)} left for the rest of the day.` : 'Right on your calories for the day.',
      suggestions: [],
    };
  }
  return null;
}
