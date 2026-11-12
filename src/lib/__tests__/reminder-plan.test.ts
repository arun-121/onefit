/// <reference types="jest" />
import { addDays, toDateKey } from '../dates';
import {
  anyReminderEnabled,
  COME_BACK_OFFSETS,
  DAYS_AHEAD,
  enabledMealReminders,
  isComeBackReminderData,
  planComeBackReminders,
  type ReminderSettings,
} from '../reminder-plan';
import { DEFAULT_SETTINGS } from '../settings-schema';

/** Breakfast 9:30, lunch 14:00 and dinner 21:00 on; weigh-in (8:00) off. */
const defaults: ReminderSettings = DEFAULT_SETTINGS;

const mealsOff: ReminderSettings = { ...defaults, remindersEnabled: false };
const weighInOnly: ReminderSettings = { ...mealsOff, weighInReminder: { enabled: true, hour: 7, minute: 15 } };
const everyMealOff: ReminderSettings = {
  ...defaults,
  reminders: {
    breakfast: { ...defaults.reminders.breakfast, enabled: false },
    lunch: { ...defaults.reminders.lunch, enabled: false },
    dinner: { ...defaults.reminders.dinner, enabled: false },
  },
};

/** Thursday 12 November 2026, mid-afternoon. */
const now = new Date(2026, 10, 12, 15, 40);

const clock = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('which meal reminders are on', () => {
  it('lists the enabled ones in meal order', () => {
    expect(enabledMealReminders(defaults).map((r) => r.meal)).toEqual(['breakfast', 'lunch', 'dinner']);
    const noLunch = { ...defaults, reminders: { ...defaults.reminders, lunch: { enabled: false, hour: 14, minute: 0 } } };
    expect(enabledMealReminders(noLunch)).toEqual([
      { meal: 'breakfast', enabled: true, hour: 9, minute: 30 },
      { meal: 'dinner', enabled: true, hour: 21, minute: 0 },
    ]);
  });

  it('is none of them while "Remind me to log meals" is off', () => {
    expect(enabledMealReminders(mealsOff)).toEqual([]);
  });
});

describe('whether any reminder is on', () => {
  it('is true out of the box, and with only the weigh-in reminder', () => {
    expect(anyReminderEnabled(defaults)).toBe(true);
    expect(anyReminderEnabled(weighInOnly)).toBe(true);
  });

  it('is false when nothing can fire', () => {
    expect(anyReminderEnabled(mealsOff)).toBe(false);
    // The main switch is on but every meal under it is off.
    expect(anyReminderEnabled(everyMealOff)).toBe(false);
  });

  it('is true when the meals are all off but the weigh-in is on', () => {
    expect(anyReminderEnabled({ ...everyMealOff, weighInReminder: { enabled: true, hour: 8, minute: 0 } })).toBe(true);
  });
});

describe('come-back reminders', () => {
  it('fall 7, 10, 14, 21 and 28 days from today', () => {
    expect(COME_BACK_OFFSETS).toEqual([7, 10, 14, 21, 28]);
    expect(planComeBackReminders(defaults, now).map((r) => r.date)).toEqual([
      '2026-11-19',
      '2026-11-22',
      '2026-11-26',
      '2026-12-03',
      '2026-12-10',
    ]);
  });

  it('start only after the last day that has its daily reminders', () => {
    const lastDailyDay = addDays('2026-11-12', DAYS_AHEAD - 1);
    for (const r of planComeBackReminders(defaults, now)) expect(r.date > lastDailyDay).toBe(true);
    expect(Math.min(...COME_BACK_OFFSETS)).toBeGreaterThanOrEqual(DAYS_AHEAD);
  });

  it('are about meals, at the time of the first meal reminder that is on', () => {
    const plan = planComeBackReminders(defaults, now);
    expect(plan.map((r) => r.about)).toEqual(['meals', 'meals', 'meals', 'meals', 'meals']);
    expect(plan.map((r) => clock(r.at))).toEqual(['9:30', '9:30', '9:30', '9:30', '9:30']);

    const lunchFirst = { ...defaults, reminders: { ...defaults.reminders, breakfast: { enabled: false, hour: 9, minute: 30 } } };
    expect(planComeBackReminders(lunchFirst, now).map((r) => clock(r.at))).toEqual(['14:00', '14:00', '14:00', '14:00', '14:00']);
  });

  it('fire on the day they are dated', () => {
    for (const r of planComeBackReminders(defaults, now)) {
      expect(toDateKey(r.at)).toBe(r.date);
      expect(r.at.getSeconds()).toBe(0);
    }
  });

  it('stay about meals when the weigh-in reminder is on as well: one nudge a day, not two', () => {
    const both = { ...defaults, weighInReminder: { enabled: true, hour: 7, minute: 15 } };
    const plan = planComeBackReminders(both, now);
    expect(plan).toHaveLength(5);
    expect(new Set(plan.map((r) => r.about))).toEqual(new Set(['meals']));
    expect(clock(plan[0].at)).toBe('9:30');
  });

  it('are about weighing in, at the weigh-in time, for someone with only that reminder on', () => {
    const plan = planComeBackReminders(weighInOnly, now);
    expect(plan.map((r) => r.about)).toEqual(['weigh-in', 'weigh-in', 'weigh-in', 'weigh-in', 'weigh-in']);
    expect(plan.map((r) => r.date)).toEqual(['2026-11-19', '2026-11-22', '2026-11-26', '2026-12-03', '2026-12-10']);
    expect(plan.map((r) => clock(r.at))).toEqual(['7:15', '7:15', '7:15', '7:15', '7:15']);
    // Every meal switched off one by one counts the same as the main switch.
    const viaEachMeal = { ...everyMealOff, weighInReminder: weighInOnly.weighInReminder };
    expect(planComeBackReminders(viaEachMeal, now)).toEqual(plan);
  });

  it('are none when every reminder is off', () => {
    expect(planComeBackReminders(mealsOff, now)).toEqual([]);
    expect(planComeBackReminders(everyMealOff, now)).toEqual([]);
  });

  it('count calendar days, whatever the time of day', () => {
    const justAfterMidnight = planComeBackReminders(defaults, new Date(2026, 10, 12, 0, 1));
    const justBeforeMidnight = planComeBackReminders(defaults, new Date(2026, 10, 12, 23, 59));
    expect(justAfterMidnight).toEqual(justBeforeMidnight);
    expect(justAfterMidnight[0].date).toBe('2026-11-19');
  });

  it('carry on across the end of a month and a year', () => {
    expect(planComeBackReminders(defaults, new Date(2026, 11, 20, 10, 0)).map((r) => r.date)).toEqual([
      '2026-12-27',
      '2026-12-30',
      '2027-01-03',
      '2027-01-10',
      '2027-01-17',
    ]);
    // 2028 is a leap year.
    expect(planComeBackReminders(defaults, new Date(2028, 1, 22, 10, 0)).map((r) => r.date)[0]).toBe('2028-02-29');
  });

  it('are in order and never in the past', () => {
    const plan = planComeBackReminders(defaults, now);
    for (let i = 0; i < plan.length; i++) {
      expect(plan[i].at.getTime()).toBeGreaterThan(i === 0 ? now.getTime() : plan[i - 1].at.getTime());
    }
  });
});

describe('what a come-back notification carries', () => {
  it('is recognised', () => {
    expect(isComeBackReminderData({ kind: 'come-back-reminder', about: 'meals', date: '2026-11-19' })).toBe(true);
    expect(isComeBackReminderData({ kind: 'come-back-reminder', about: 'weigh-in', date: '2026-11-19' })).toBe(true);
  });

  it('is not mistaken for a daily reminder, or for anything else', () => {
    expect(isComeBackReminderData({ kind: 'meal-reminder', meal: 'lunch', date: '2026-11-19' })).toBe(false);
    expect(isComeBackReminderData({ kind: 'weigh-in-reminder', date: '2026-11-19' })).toBe(false);
    expect(isComeBackReminderData({ kind: 'come-back-reminder', about: 'exercise', date: '2026-11-19' })).toBe(false);
    expect(isComeBackReminderData({ kind: 'come-back-reminder', about: 'meals', date: '19 Nov' })).toBe(false);
    expect(isComeBackReminderData({ kind: 'come-back-reminder', about: 'meals' })).toBe(false);
    expect(isComeBackReminderData(null)).toBe(false);
    expect(isComeBackReminderData(undefined)).toBe(false);
    expect(isComeBackReminderData('come-back-reminder')).toBe(false);
  });
});
