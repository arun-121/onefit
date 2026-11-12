import { todayKey } from '@/lib/dates';
import { getDayExerciseCalories, getDayTotals, getFavourites, kvGet, kvSet } from '@/lib/db';
import { getSettings } from '@/lib/settings';

export interface WidgetFavourite {
  id: number;
  label: string;
}

export interface WidgetBanner {
  text: string;
  entryIds: number[];
}

export interface WidgetData {
  left: number;
  goal: number;
  progress: number;
  over: boolean;
  protein: number;
  proteinGoal: number;
  favourites: WidgetFavourite[];
  banner: WidgetBanner | null;
}

const LAST_LOG_KEY = 'widget_last_log';
/** How long the "Logged X · Undo" strip stays on the widget. */
const BANNER_MS = 10 * 60 * 1000;

interface LastWidgetLog extends WidgetBanner {
  at: number;
}

export function rememberWidgetLog(text: string, entryIds: number[]) {
  kvSet(LAST_LOG_KEY, { text, entryIds, at: Date.now() } satisfies LastWidgetLog);
}

export function takeWidgetLog(): LastWidgetLog | null {
  const last = kvGet<LastWidgetLog>(LAST_LOG_KEY);
  kvSet(LAST_LOG_KEY, null);
  return last;
}

function shortLabel(name: string): string {
  return name.length > 14 ? `${name.slice(0, 13).trimEnd()}…` : name;
}

export function getWidgetData(now: number = Date.now()): WidgetData {
  const settings = getSettings();
  const today = todayKey();
  const totals = getDayTotals(today);
  // Workouts logged in the app raise the budget; Health Connect activity isn't read in the background.
  const budget = settings.calorieGoal + getDayExerciseCalories(today);
  const left = Math.round(budget - totals.calories);
  const last = kvGet<LastWidgetLog>(LAST_LOG_KEY);
  return {
    left,
    goal: settings.calorieGoal,
    progress: budget > 0 ? Math.min(1, totals.calories / budget) : 0,
    over: left < 0,
    protein: Math.round(totals.protein),
    proteinGoal: settings.proteinGoal,
    favourites: getFavourites(3).map((f) => ({ id: f.id, label: shortLabel(f.name) })),
    banner: last && now - last.at < BANNER_MS ? { text: last.text, entryIds: last.entryIds } : null,
  };
}
