/**
 * Which reminders are due, worked out from the settings alone. Pure (no notifications, no SQLite)
 * so it can be tested; `reminders.ts` does the scheduling.
 */
import { addDays, dateKeyToDate, isDateKey, todayKey } from './dates';
import type { ReminderMeal, ReminderSetting, Settings } from './settings-schema';

export const REMINDER_MEALS: ReminderMeal[] = ['breakfast', 'lunch', 'dinner'];

/** Meal and weigh-in reminders are scheduled one by one for this many days, today included. */
export const DAYS_AHEAD = 7;

/**
 * Days from today on which a come-back reminder is scheduled. The daily reminders are rebuilt
 * whenever the app opens or food is logged, so they run out after DAYS_AHEAD days away, and
 * someone who has drifted for a week is exactly who the reminders are for. These few carry on
 * for a month, further and further apart; after that the app stays quiet.
 */
export const COME_BACK_OFFSETS: readonly number[] = [7, 10, 14, 21, 28];

/** The settings the reminders depend on. */
export type ReminderSettings = Pick<Settings, 'remindersEnabled' | 'reminders' | 'weighInReminder'>;

export interface MealReminder extends ReminderSetting {
  meal: ReminderMeal;
}

/** The meal reminders that will fire, in meal order: none while "Remind me to log meals" is off. */
export function enabledMealReminders(settings: ReminderSettings): MealReminder[] {
  if (!settings.remindersEnabled) return [];
  return REMINDER_MEALS.map((meal) => ({ meal, ...settings.reminders[meal] })).filter((r) => r.enabled);
}

/** True when at least one reminder is switched on, so notifications are worth asking for. */
export function anyReminderEnabled(settings: ReminderSettings): boolean {
  return enabledMealReminders(settings).length > 0 || settings.weighInReminder.enabled;
}

/** What a come-back reminder asks for: the food log, or (with only the weigh-in reminder on) a weigh-in. */
export type ComeBackAbout = 'meals' | 'weigh-in';

export interface ComeBackReminder {
  about: ComeBackAbout;
  /** The local day it fires on. */
  date: string;
  /** The moment it fires. */
  at: Date;
}

/**
 * The come-back reminders to schedule, oldest first. With any meal reminder on they are about
 * the food log and fire at the first enabled meal reminder's time. With only the weigh-in
 * reminder on they are about weighing in and fire at its time, so a weigh-in-only owner is never
 * nudged about meals. With every reminder off there are none.
 */
export function planComeBackReminders(settings: ReminderSettings, now: Date = new Date()): ComeBackReminder[] {
  const meals = enabledMealReminders(settings);
  let about: ComeBackAbout;
  let time: ReminderSetting;
  if (meals.length > 0) {
    about = 'meals';
    time = meals[0];
  } else if (settings.weighInReminder.enabled) {
    about = 'weigh-in';
    time = settings.weighInReminder;
  } else return [];

  const today = todayKey(now);
  return COME_BACK_OFFSETS.map((offset) => {
    const date = addDays(today, offset);
    // Built from the local day, so a daylight-saving change in between does not move the time.
    const at = dateKeyToDate(date);
    at.setHours(time.hour, time.minute, 0, 0);
    return { about, date, at };
  });
}

/** What a come-back notification carries, so a tap on it can open the right place. */
export interface ComeBackReminderData {
  kind: 'come-back-reminder';
  about: ComeBackAbout;
  /** The day the reminder was scheduled for. */
  date: string;
}

export function isComeBackReminderData(data: unknown): data is ComeBackReminderData {
  const d = data as Partial<ComeBackReminderData> | null;
  return !!d && d.kind === 'come-back-reminder' && (d.about === 'meals' || d.about === 'weigh-in') && isDateKey(d.date);
}
