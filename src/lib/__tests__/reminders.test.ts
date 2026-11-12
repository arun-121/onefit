/// <reference types="jest" />
/**
 * The scheduling itself, against a stand-in for the phone: notifications, permission and the
 * key/value table are faked in memory, and the settings code on top of them is the real one.
 */
import {
  askForNotificationsOnce,
  cancelReminder,
  cancelWeighInReminder,
  keepRemindersAhead,
  requestNotifications,
  rescheduleReminders,
} from '../reminders';
import { getSettings } from '../settings';
import { DEFAULT_SETTINGS, type Settings } from '../settings-schema';

// ---------------------------------------------------------------- the stand-in phone
// Jest lifts the two jest.mock calls below above the imports, so `reminders` and `settings` are
// loaded on top of the stand-ins. The stand-ins only touch `mockPhone` when they are called.

interface Scheduled {
  identifier: string;
  content: { title: string; body: string; data: Record<string, unknown>; categoryIdentifier?: string };
  trigger: { type: string; date: Date; channelId: string };
}

/** Jest only lets a mock factory reach variables whose names start with "mock". */
const mockPhone = {
  kv: new Map<string, unknown>(),
  scheduled: new Map<string, Scheduled>(),
  /** Ids of the notifications showing in the shade. */
  shown: [] as string[],
  permission: { granted: true, canAskAgain: true },
  /** What the owner answers when Android asks. */
  answer: true,
  timesAsked: 0,
  mealsLoggedToday: new Set<string>(),
  weighedOn: [] as string[],
  /** When set, every schedule call waits for this before it lands. */
  hold: null as Promise<void> | null,
};

jest.mock('../db', () => ({
  kvGet: (key: string) => mockPhone.kv.get(key) ?? null,
  kvSet: (key: string, value: unknown) => void mockPhone.kv.set(key, JSON.parse(JSON.stringify(value))),
  notifyChanged: () => {},
  getLatestWeight: () => null,
  getMealsLoggedOn: () => new Set(mockPhone.mealsLoggedToday),
  getWeightsBetween: (from: string, to: string) => mockPhone.weighedOn.filter((d) => d >= from && d <= to).map((date) => ({ date })),
}));

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { HIGH: 6, DEFAULT: 5 },
  getAllScheduledNotificationsAsync: async () => [...mockPhone.scheduled.values()],
  cancelScheduledNotificationAsync: async (id: string) => void mockPhone.scheduled.delete(id),
  scheduleNotificationAsync: async (request: Scheduled) => {
    if (mockPhone.hold) await mockPhone.hold;
    mockPhone.scheduled.set(request.identifier, request);
    return request.identifier;
  },
  getPresentedNotificationsAsync: async () => mockPhone.shown.map((identifier) => ({ request: { identifier } })),
  dismissNotificationAsync: async (id: string) => {
    mockPhone.shown = mockPhone.shown.filter((s) => s !== id);
  },
  getPermissionsAsync: async () => ({ ...mockPhone.permission }),
  requestPermissionsAsync: async () => {
    mockPhone.timesAsked += 1;
    mockPhone.permission = mockPhone.answer ? { granted: true, canAskAgain: true } : { granted: false, canAskAgain: true };
    return { ...mockPhone.permission };
  },
}));

const TODAY = '2026-11-12';
/** Thursday 12 November 2026, 8:00 in the morning: before every default reminder. */
const MORNING = new Date(2026, 10, 12, 8, 0);

function setSettings(patch: Partial<Settings>) {
  mockPhone.kv.set('settings', { ...DEFAULT_SETTINGS, ...patch });
}

const ids = () => [...mockPhone.scheduled.keys()].sort();
/** Let everything that is ready to run, run. */
const settle = () => new Promise<void>((resolve) => setImmediate(() => resolve()));
const clock = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
const comeBackDays = ['2026-11-19', '2026-11-22', '2026-11-26', '2026-12-03', '2026-12-10'];
const weekDays = ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'];

beforeEach(() => {
  // Only the clock is faked; promises and timers run as usual.
  jest.useFakeTimers({
    now: MORNING,
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'hrtime'],
  });
  mockPhone.kv.clear();
  mockPhone.scheduled.clear();
  mockPhone.shown = [];
  mockPhone.permission = { granted: true, canAskAgain: true };
  mockPhone.answer = true;
  mockPhone.timesAsked = 0;
  mockPhone.mealsLoggedToday = new Set();
  mockPhone.weighedOn = [];
  mockPhone.hold = null;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('rebuilding the reminders', () => {
  it('schedules a week of meal reminders, then the come-back ones', async () => {
    await rescheduleReminders();
    const expected = [
      ...weekDays.flatMap((d) => [`meal-breakfast-${d}`, `meal-lunch-${d}`, `meal-dinner-${d}`]),
      ...comeBackDays.map((d) => `meal-comeback-${d}`),
    ].sort();
    expect(ids()).toEqual(expected);
  });

  it('makes a come-back reminder a plain notification on the meal channel that says where it leads', async () => {
    await rescheduleReminders();
    const first = mockPhone.scheduled.get('meal-comeback-2026-11-19');
    expect(first?.content).toEqual({
      title: 'Pick your log back up',
      body: 'Today’s meals take a minute to add.',
      data: { kind: 'come-back-reminder', about: 'meals', date: '2026-11-19' },
    });
    // No category means no "Same as yesterday" button.
    expect(first?.content).not.toHaveProperty('categoryIdentifier');
    expect(first?.trigger.type).toBe('date');
    expect(first?.trigger.channelId).toBe('meal-reminders');
    expect(clock(first!.trigger.date)).toBe('9:30');
    // The daily ones keep their buttons.
    expect(mockPhone.scheduled.get('meal-lunch-2026-11-13')?.content.categoryIdentifier).toBe('meal-reminder');
  });

  it('gives someone with only the weigh-in reminder on the weigh-in wording and channel', async () => {
    setSettings({ remindersEnabled: false, weighInReminder: { enabled: true, hour: 7, minute: 15 } });
    await rescheduleReminders();
    // 7:15 today has passed, so the daily ones start tomorrow.
    expect(ids()).toEqual([...comeBackDays.map((d) => `weigh-in-comeback-${d}`), ...weekDays.slice(1).map((d) => `weigh-in-${d}`)].sort());
    const comeBack = mockPhone.scheduled.get('weigh-in-comeback-2026-11-19');
    expect(comeBack?.content).toEqual({
      title: 'Time to weigh in',
      body: 'Log your weight. It takes a few seconds.',
      data: { kind: 'come-back-reminder', about: 'weigh-in', date: '2026-11-19' },
    });
    expect(comeBack?.trigger.channelId).toBe('weigh-in-reminders');
    expect(clock(comeBack!.trigger.date)).toBe('7:15');
    expect(ids().some((id) => id.startsWith('meal-'))).toBe(false);
  });

  it('sends one come-back reminder a day, about meals, when both kinds are on', async () => {
    setSettings({ weighInReminder: { enabled: true, hour: 7, minute: 15 } });
    await rescheduleReminders();
    expect(ids().filter((id) => id.includes('comeback'))).toEqual(comeBackDays.map((d) => `meal-comeback-${d}`));
  });

  it('skips what is already logged today and what is already past', async () => {
    jest.setSystemTime(new Date(2026, 10, 12, 15, 0));
    mockPhone.mealsLoggedToday = new Set(['dinner']);
    mockPhone.weighedOn = ['2026-11-12'];
    setSettings({ weighInReminder: { enabled: true, hour: 23, minute: 0 } });
    await rescheduleReminders();
    const today = ids().filter((id) => id.endsWith(TODAY));
    // Breakfast (9:30) and lunch (14:00) have passed, dinner is logged, and today has a weigh-in.
    expect(today).toEqual([]);
    expect(ids()).toContain('meal-dinner-2026-11-13');
    expect(ids()).toContain('weigh-in-2026-11-13');
  });

  it('replaces what it scheduled before and leaves other notifications alone', async () => {
    const old = (identifier: string) => mockPhone.scheduled.set(identifier, { identifier } as Scheduled);
    old('meal-comeback-2026-11-01');
    old('meal-lunch-2026-11-01');
    old('weigh-in-comeback-2026-11-01');
    old('weigh-in-2026-11-01');
    old('something-else');
    await rescheduleReminders();
    expect(ids().filter((id) => id.endsWith('2026-11-01'))).toEqual([]);
    expect(ids()).toContain('something-else');
  });

  it('schedules nothing while notifications are not allowed, or with every reminder off', async () => {
    mockPhone.permission = { granted: false, canAskAgain: true };
    await rescheduleReminders();
    expect(ids()).toEqual([]);

    mockPhone.permission = { granted: true, canAskAgain: true };
    setSettings({ remindersEnabled: false });
    await rescheduleReminders();
    expect(ids()).toEqual([]);
  });

  it('moves the come-back reminders on each time, so they only fire after a week away', async () => {
    await rescheduleReminders();
    jest.setSystemTime(new Date(2026, 10, 15, 8, 0));
    await rescheduleReminders();
    expect(ids().filter((id) => id.includes('comeback'))).toEqual(
      ['2026-11-22', '2026-11-25', '2026-11-29', '2026-12-06', '2026-12-13'].map((d) => `meal-comeback-${d}`),
    );
  });
});

describe('keeping the reminders ahead from a food log', () => {
  it('rebuilds on the first log of a day and not again that day', async () => {
    await keepRemindersAhead();
    expect(ids()).toContain('meal-comeback-2026-11-19');

    mockPhone.scheduled.clear();
    await keepRemindersAhead();
    expect(ids()).toEqual([]);

    // Next day, logged from the widget with the app closed: the week and the come-back days move on.
    jest.setSystemTime(new Date(2026, 10, 13, 8, 0));
    await keepRemindersAhead();
    expect(ids()).toContain('meal-dinner-2026-11-19');
    expect(ids()).toContain('meal-comeback-2026-11-20');
    expect(ids()).not.toContain('meal-comeback-2026-11-19');
  });

  it('counts a rebuild made for any other reason', async () => {
    await rescheduleReminders();
    mockPhone.scheduled.clear();
    await keepRemindersAhead();
    expect(ids()).toEqual([]);
  });
});

describe('tidying the notification shade', () => {
  it('clears a come-back reminder once its day is over', async () => {
    mockPhone.shown = ['meal-comeback-2026-11-05', 'weigh-in-comeback-2026-11-05', 'weigh-in-2026-11-11'];
    await rescheduleReminders();
    expect(mockPhone.shown).toEqual([]);
  });

  it('keeps today’s until what it asks for is done', async () => {
    mockPhone.shown = [`meal-comeback-${TODAY}`, `weigh-in-comeback-${TODAY}`, `weigh-in-${TODAY}`];
    await rescheduleReminders();
    expect(mockPhone.shown).toEqual([`meal-comeback-${TODAY}`, `weigh-in-comeback-${TODAY}`, `weigh-in-${TODAY}`]);

    mockPhone.mealsLoggedToday = new Set(['snack']);
    await rescheduleReminders();
    expect(mockPhone.shown).toEqual([`weigh-in-comeback-${TODAY}`, `weigh-in-${TODAY}`]);

    mockPhone.weighedOn = [TODAY];
    await rescheduleReminders();
    expect(mockPhone.shown).toEqual([]);
  });

  it('leaves daily meal reminders and other notifications where they are', async () => {
    mockPhone.shown = ['meal-lunch-2026-11-11', 'something-else'];
    await rescheduleReminders();
    expect(mockPhone.shown).toEqual(['meal-lunch-2026-11-11', 'something-else']);
  });
});

describe('once something is logged', () => {
  it('cancels that meal’s reminder for the day and clears a come-back reminder showing for it', async () => {
    await rescheduleReminders();
    mockPhone.shown = [`meal-comeback-${TODAY}`];
    await cancelReminder('lunch', TODAY);
    expect(ids()).not.toContain(`meal-lunch-${TODAY}`);
    expect(ids()).toContain(`meal-dinner-${TODAY}`);
    expect(mockPhone.shown).toEqual([]);
  });

  it('clears the come-back reminder for a snack too, which has no reminder of its own', async () => {
    await rescheduleReminders();
    const before = ids();
    mockPhone.shown = [`meal-comeback-${TODAY}`];
    await cancelReminder('snack', TODAY);
    expect(ids()).toEqual(before);
    expect(mockPhone.shown).toEqual([]);
  });

  it('cancels and clears the weigh-in reminder, daily or come-back', async () => {
    setSettings({ weighInReminder: { enabled: true, hour: 20, minute: 0 } });
    await rescheduleReminders();
    expect(ids()).toContain(`weigh-in-${TODAY}`);
    mockPhone.shown = [`weigh-in-comeback-${TODAY}`];
    await cancelWeighInReminder(TODAY);
    expect(ids()).not.toContain(`weigh-in-${TODAY}`);
    expect(mockPhone.shown).toEqual([]);
  });

  it('is not undone by a rebuild that was already running (delete a weigh-in, then Undo)', async () => {
    setSettings({ weighInReminder: { enabled: true, hour: 20, minute: 0 } });
    let release = () => {};
    mockPhone.hold = new Promise<void>((resolve) => (release = resolve));
    // The weigh-in was just deleted, so the rebuild reads "not weighed today"...
    const rebuild = rescheduleReminders();
    await settle();
    // ...and Undo puts it back while that rebuild is still scheduling.
    mockPhone.weighedOn = [TODAY];
    await cancelWeighInReminder(TODAY);
    release();
    await rebuild;
    await settle();
    expect(ids()).not.toContain(`weigh-in-${TODAY}`);
    expect(ids()).toContain('weigh-in-2026-11-13');
  });
});

describe('asking to allow notifications', () => {
  beforeEach(() => {
    mockPhone.permission = { granted: false, canAskAgain: true };
  });

  it('asks once after a food log, remembers it asked, and schedules when the answer is yes', async () => {
    await askForNotificationsOnce();
    expect(mockPhone.timesAsked).toBe(1);
    expect(getSettings().notificationsAsked).toBe(true);
    expect(ids()).toContain(`meal-dinner-${TODAY}`);
  });

  it('does not ask a second time, whatever the first answer was', async () => {
    mockPhone.answer = false;
    await askForNotificationsOnce();
    await askForNotificationsOnce();
    expect(mockPhone.timesAsked).toBe(1);
    expect(getSettings().notificationsAsked).toBe(true);
    expect(ids()).toEqual([]);
  });

  it('waits until a reminder is switched on', async () => {
    setSettings({ remindersEnabled: false });
    await askForNotificationsOnce();
    expect(mockPhone.timesAsked).toBe(0);
    expect(getSettings().notificationsAsked).toBe(false);

    setSettings({ remindersEnabled: false, weighInReminder: { enabled: true, hour: 8, minute: 0 } });
    await askForNotificationsOnce();
    expect(mockPhone.timesAsked).toBe(1);
  });

  it('does not bring up Android’s question when notifications are already allowed', async () => {
    mockPhone.permission = { granted: true, canAskAgain: true };
    await askForNotificationsOnce();
    expect(mockPhone.timesAsked).toBe(0);
    expect(getSettings().notificationsAsked).toBe(true);
    expect(ids()).toContain(`meal-dinner-${TODAY}`);
  });

  it('says how asking from Settings ended', async () => {
    mockPhone.answer = false;
    expect(await requestNotifications()).toBe('refused');
    expect(getSettings().notificationsAsked).toBe(true);

    mockPhone.answer = true;
    expect(await requestNotifications()).toBe('granted');
    expect(await requestNotifications()).toBe('granted');
    expect(mockPhone.timesAsked).toBe(2);
  });

  it('reports blocked, without asking, when Android will not show its question', async () => {
    mockPhone.permission = { granted: false, canAskAgain: false };
    expect(await requestNotifications()).toBe('blocked');
    expect(mockPhone.timesAsked).toBe(0);
    expect(getSettings().notificationsAsked).toBe(false);
  });
});
