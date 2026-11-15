/**
 * Gathers what the assistant is told about the owner, and keeps the conversation. This is the only
 * part of the assistant that touches SQLite; the words live in `assistant.ts`.
 */
import { assistantDigest, type ChatMessage } from './assistant';
import { addDays } from './dates';
import {
  getDailyTotals,
  getDayExerciseCalories,
  getEntriesForDate,
  getExercisesForDate,
  getKnownFoods,
  getTopProteinFoods,
  getWeightsBetween,
  kvGet,
  kvSet,
} from './db';
import { loadInsights } from './insights-data';
import { loadNudges } from './nudges-data';
import { getSettings } from './settings';

const CHAT_KEY = 'assistant_chat';
/** Messages kept between app runs. */
const KEEP_MESSAGES = 40;

const nowFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** The owner's data as the assistant is given it, for today. */
export function loadAssistantDigest(today: string, now: Date = new Date()): string {
  const settings = getSettings();
  const from14 = addDays(today, -13);
  return assistantDigest({
    nowText: nowFormat.format(now),
    goals: { calories: settings.calorieGoal, protein: settings.proteinGoal, carbs: settings.carbsGoal, fat: settings.fatGoal },
    profile: settings.profile,
    weightGoalKg: settings.weightGoalKg,
    insights: loadInsights(today, 30),
    todayEntries: getEntriesForDate(today),
    todayExercises: getExercisesForDate(today),
    // Workouts logged here always count; other apps' activity is read live on Today and not stored.
    todayBudget: settings.calorieGoal + getDayExerciseCalories(today),
    // Newest first already.
    recentDays: getDailyTotals(from14, today).filter((d) => d.calories > 0),
    recentWeights: getWeightsBetween(from14, today),
    proteinFoods: getTopProteinFoods(addDays(today, -29), today),
    savedFoods: getKnownFoods(20),
    noticed: loadNudges(today).map((n) => ({ title: n.title, body: n.body })),
  });
}

export function loadChat(): ChatMessage[] {
  const stored = kvGet<ChatMessage[]>(CHAT_KEY);
  return Array.isArray(stored) ? stored.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string') : [];
}

export function saveChat(messages: readonly ChatMessage[]): void {
  kvSet(CHAT_KEY, messages.slice(-KEEP_MESSAGES));
}
