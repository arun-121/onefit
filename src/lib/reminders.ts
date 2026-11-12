/**
 * Meal and weigh-in reminders as local notifications (no push server). Reminders are scheduled
 * one by one for the next week so that today's reminder can be cancelled once the meal or the
 * weight is logged. After that week come a few come-back reminders, further and further apart,
 * so a week away from the app does not silence it for good (`reminder-plan.ts` has the days).
 *
 * Everything is rebuilt when the app comes to the foreground, when a reminder setting changes,
 * and on the first food log of a day (which may come from the widget with the app closed).
 */
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { VOICE_LOGGING } from '@/constants/features';
import { addDays, dateKeyToDate, todayKey } from './dates';
import { getMealsLoggedOn, getWeightsBetween, kvGet, kvSet } from './db';
import {
  anyReminderEnabled,
  DAYS_AHEAD,
  enabledMealReminders,
  planComeBackReminders,
  type ComeBackAbout,
  type ComeBackReminderData,
} from './reminder-plan';
import { getSettings, updateSettings, type ReminderMeal } from './settings';
import { MEAL_LABELS, type Meal } from './types';

export { anyReminderEnabled, isComeBackReminderData, REMINDER_MEALS } from './reminder-plan';
export type { ComeBackAbout, ComeBackReminderData } from './reminder-plan';

export const REMINDER_CHANNEL = 'meal-reminders';
export const REMINDER_CATEGORY = 'meal-reminder';
export const ACTION_SAME_AS_YESTERDAY = 'same-as-yesterday';
export const ACTION_LOG_NOW = 'log-now';

const ID_PREFIX = 'meal-';

export interface ReminderData {
  kind: 'meal-reminder';
  meal: ReminderMeal;
  date: string;
}

export function isReminderData(data: unknown): data is ReminderData {
  const d = data as Partial<ReminderData> | null;
  return !!d && d.kind === 'meal-reminder' && typeof d.meal === 'string' && typeof d.date === 'string';
}

const reminderId = (meal: ReminderMeal, date: string) => `${ID_PREFIX}${meal}-${date}`;

// ---- weigh-in reminder: its own channel and category, so Android lets the owner tune it separately.

export const WEIGH_IN_CHANNEL = 'weigh-in-reminders';
export const WEIGH_IN_CATEGORY = 'weigh-in-reminder';
/** The notification's button. Tapping it, or the notification itself, should open the weight sheet. */
export const ACTION_LOG_WEIGHT = 'log-weight';
/** Where a weigh-in reminder leads. The sheet defaults to today, which is when the weighing happens. */
export const WEIGH_IN_ROUTE = '/weight';
const WEIGH_IN_PREFIX = 'weigh-in-';

export interface WeighInReminderData {
  kind: 'weigh-in-reminder';
  /** The day the reminder was scheduled for. */
  date: string;
}

export function isWeighInReminderData(data: unknown): data is WeighInReminderData {
  const d = data as Partial<WeighInReminderData> | null;
  return !!d && d.kind === 'weigh-in-reminder' && typeof d.date === 'string';
}

const weighInId = (date: string) => `${WEIGH_IN_PREFIX}${date}`;

const WEIGH_IN_COPY = { title: 'Time to weigh in', body: 'Log your weight. It takes a few seconds.' };

// ---- come-back reminders: the sparse ones after the week of daily reminders has run out.
// They sit on the channel of what they are about, and their ids start with that channel's prefix
// so the rebuild cancels them with the rest. "comeback" is not a meal and not a date, so an id
// can never collide with a daily reminder's.

/** Where a come-back reminder about meals leads: the log screen, on today and the meal for the time of day. */
export const COME_BACK_ROUTE = '/log';

const COME_BACK_PREFIX: Record<ComeBackAbout, string> = {
  meals: `${ID_PREFIX}comeback-`,
  'weigh-in': `${WEIGH_IN_PREFIX}comeback-`,
};
const COME_BACK_CHANNEL: Record<ComeBackAbout, string> = { meals: REMINDER_CHANNEL, 'weigh-in': WEIGH_IN_CHANNEL };
const COME_BACK_COPY: Record<ComeBackAbout, { title: string; body: string }> = {
  meals: { title: 'Pick your log back up', body: 'Today’s meals take a minute to add.' },
  // Someone with only the weigh-in reminder on is never nudged about meals.
  'weigh-in': WEIGH_IN_COPY,
};

const comeBackId = (about: ComeBackAbout, date: string) => `${COME_BACK_PREFIX[about]}${date}`;

export async function setupNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
      name: 'Meal reminders',
      description: 'Reminders to log breakfast, lunch and dinner',
      importance: AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(WEIGH_IN_CHANNEL, {
      name: 'Weigh-in reminder',
      description: 'A daily reminder to log your weight',
      importance: AndroidImportance.DEFAULT,
    });
  }
  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
    { identifier: ACTION_LOG_NOW, buttonTitle: 'Log now', options: { opensAppToForeground: true } },
    { identifier: ACTION_SAME_AS_YESTERDAY, buttonTitle: 'Same as yesterday', options: { opensAppToForeground: true } },
  ]);
  await Notifications.setNotificationCategoryAsync(WEIGH_IN_CATEGORY, [
    { identifier: ACTION_LOG_WEIGHT, buttonTitle: 'Log weight', options: { opensAppToForeground: true } },
  ]);
}

// ---------------------------------------------------------------- permission

export async function hasNotificationPermission(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}

/**
 * How asking to allow notifications ended. 'refused': Android asked and the owner said no.
 * 'blocked': Android will not ask (again), so only the app's page in Android settings can turn
 * notifications on; `Linking.openSettings()` opens it.
 */
export type NotificationAsk = 'granted' | 'refused' | 'blocked';

/**
 * Make sure notifications are allowed, showing Android's question when it still can be shown.
 * Android cannot tell "never asked" from "said no once", so putting the question is recorded in
 * `notificationsAsked`, and the app never asks unprompted after that.
 */
export async function requestNotifications(): Promise<NotificationAsk> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';
  if (!current.canAskAgain) return 'blocked';
  if (!getSettings().notificationsAsked) updateSettings({ notificationsAsked: true });
  return (await Notifications.requestPermissionsAsync()).granted ? 'granted' : 'refused';
}

/** True when notifications are allowed, asking first if Android still lets the app ask. */
export async function ensureNotificationPermission(): Promise<boolean> {
  return (await requestNotifications()) === 'granted';
}

/**
 * The one time the app asks unprompted. Reminders are on from the first launch, but on Android 13
 * and later nothing is shown until the owner allows notifications, so they would read as on in
 * Settings and stay silent. Call this after a food log: when any reminder is on and this phone
 * has not been asked yet, it records that it asked, asks, and rebuilds the reminders. Later calls
 * do nothing. It never throws.
 */
export async function askForNotificationsOnce(): Promise<void> {
  try {
    const settings = getSettings();
    if (settings.notificationsAsked || !anyReminderEnabled(settings)) return;
    // Recorded before asking, so closing the app on the question does not bring it up again.
    updateSettings({ notificationsAsked: true });
    await requestNotifications();
    await rescheduleReminders();
  } catch (e) {
    console.warn('Could not ask to allow notifications', e);
  }
}

// ---------------------------------------------------------------- scheduling

/** The day the reminders were last rebuilt (kv table), so a food log can tell whether they are due. */
const BUILT_ON_KEY = 'reminders_built_on';

let queue: Promise<void> = Promise.resolve();
/** Rebuilds queued or running. */
let rebuilding = 0;

/** Rebuild the reminders: the week ahead, then the come-back ones. Calls are queued so they never interleave. */
export function rescheduleReminders(): Promise<void> {
  rebuilding += 1;
  const run = async () => {
    try {
      // Stamped only when the pass finished, so a failed one is tried again on the next food log.
      kvSet(BUILT_ON_KEY, await rebuild());
    } catch (e) {
      console.warn('Could not schedule reminders', e);
    } finally {
      rebuilding -= 1;
    }
  };
  queue = queue.then(run, run);
  return queue;
}

/**
 * Rebuild the reminders unless that has already happened today. Logging food calls this, because
 * a log from the widget may be the only sign of life for days: the week of daily reminders then
 * keeps moving ahead, and the come-back reminders are not sent to someone who never left.
 */
export async function keepRemindersAhead(): Promise<void> {
  if (kvGet<unknown>(BUILT_ON_KEY) === todayKey()) return;
  await rescheduleReminders();
}

/** One pass: cancel everything of ours and schedule it afresh. Returns the day it planned from. */
async function rebuild(): Promise<string> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(ID_PREFIX) || n.identifier.startsWith(WEIGH_IN_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );

  const settings = getSettings();
  const weighIn = settings.weighInReminder;
  const now = new Date();
  const today = todayKey(now);
  const lastDay = addDays(today, DAYS_AHEAD - 1);
  const weighedOn = new Set(getWeightsBetween(today, lastDay).map((w) => w.date));
  const loggedToday = getMealsLoggedOn(today);
  await clearStaleReminders(today, weighedOn.has(today), loggedToday.size > 0);

  // The weigh-in reminder has its own switch; "Remind me to log meals" only covers the meals.
  if (!anyReminderEnabled(settings)) return today;
  if (!(await hasNotificationPermission())) return today;

  const meals = enabledMealReminders(settings);
  const soon = now.getTime() + 30_000;
  const { DATE } = Notifications.SchedulableTriggerInputTypes;

  for (let day = 0; day < DAYS_AHEAD; day++) {
    const date = addDays(today, day);
    for (const { meal, hour, minute } of meals) {
      if (day === 0 && loggedToday.has(meal)) continue;
      const at = dateKeyToDate(date);
      at.setHours(hour, minute, 0, 0);
      if (at.getTime() <= soon) continue;
      const data: ReminderData = { kind: 'meal-reminder', meal, date };
      await Notifications.scheduleNotificationAsync({
        identifier: reminderId(meal, date),
        content: {
          title: `Log your ${MEAL_LABELS[meal].toLowerCase()}`,
          body: VOICE_LOGGING ? 'Say or type what you had.' : 'Type what you had.',
          data: data as unknown as Record<string, unknown>,
          categoryIdentifier: REMINDER_CATEGORY,
        },
        trigger: { type: DATE, date: at, channelId: REMINDER_CHANNEL },
      });
    }
    // A day that already has a weigh-in needs no reminder.
    if (weighIn.enabled && !weighedOn.has(date)) {
      const at = dateKeyToDate(date);
      at.setHours(weighIn.hour, weighIn.minute, 0, 0);
      if (at.getTime() <= soon) continue;
      const data: WeighInReminderData = { kind: 'weigh-in-reminder', date };
      await Notifications.scheduleNotificationAsync({
        identifier: weighInId(date),
        content: { ...WEIGH_IN_COPY, data: data as unknown as Record<string, unknown>, categoryIdentifier: WEIGH_IN_CATEGORY },
        trigger: { type: DATE, date: at, channelId: WEIGH_IN_CHANNEL },
      });
    }
  }

  // After the week: every rebuild moves these on, so they only ever fire after a week away.
  for (const { about, date, at } of planComeBackReminders(settings, now)) {
    const data: ComeBackReminderData = { kind: 'come-back-reminder', about, date };
    await Notifications.scheduleNotificationAsync({
      identifier: comeBackId(about, date),
      // No category, so no buttons: after a week away there is no "same as yesterday" to offer.
      content: { ...COME_BACK_COPY[about], data: data as unknown as Record<string, unknown> },
      trigger: { type: DATE, date: at, channelId: COME_BACK_CHANNEL[about] },
    });
  }
  return today;
}

/**
 * Tidy the notification shade. A weigh-in reminder left there is only useful on its own day, and
 * not once that day has a weigh-in (which may have arrived from a smart scale through Health
 * Connect). A come-back reminder likewise goes once its day is over or what it asks for is done.
 * Daily meal reminders are left alone.
 */
async function clearStaleReminders(today: string, weighedToday: boolean, ateToday: boolean): Promise<void> {
  const current = new Set<string>();
  if (!weighedToday) current.add(weighInId(today)).add(comeBackId('weigh-in', today));
  if (!ateToday) current.add(comeBackId('meals', today));
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    const stale = presented
      .map((n) => n.request.identifier)
      .filter((id) => (id.startsWith(WEIGH_IN_PREFIX) || id.startsWith(COME_BACK_PREFIX.meals)) && !current.has(id));
    await Promise.all(stale.map((id) => Notifications.dismissNotificationAsync(id)));
  } catch {
    // Tidying up is best effort.
  }
}

// ---------------------------------------------------------------- once something is logged

async function cancelScheduled(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Not scheduled; nothing to do.
  }
}

async function dismissShown(id: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(id);
  } catch {
    // Not showing; nothing to do.
  }
}

/**
 * Cancel now and, when a rebuild is in flight, once more after it: that rebuild read the log
 * before this change, so it may still schedule the very reminder that was just cancelled (delete
 * a weigh-in, then Undo straight away). The second pass is not waited for, so logging never
 * hangs on the rebuild. `cancel` must not throw.
 */
async function cancelFor(cancel: () => Promise<void>): Promise<void> {
  await cancel();
  if (rebuilding > 0) void queue.then(cancel);
}

/**
 * Once a meal is logged, that day's reminder for it is no longer needed, and a come-back reminder
 * still showing for that day has done its job.
 */
export function cancelReminder(meal: Meal, date: string): Promise<void> {
  return cancelFor(async () => {
    if (meal !== 'snack') await cancelScheduled(reminderId(meal, date));
    await dismissShown(comeBackId('meals', date));
  });
}

/**
 * Once the weight for a day is logged, that day's reminder is no longer needed: cancel it if it
 * has not fired yet, and clear it (and a come-back reminder for that day) from the notification
 * shade if it has.
 */
export function cancelWeighInReminder(date: string): Promise<void> {
  return cancelFor(async () => {
    const id = weighInId(date);
    await cancelScheduled(id);
    await dismissShown(id);
    await dismissShown(comeBackId('weigh-in', date));
  });
}
