/// <reference types="jest" />
/**
 * Deleting a weigh-in and undoing it, against a stand-in for the phone: the weights table, the
 * key/value table, Health Connect and the reminders are faked in memory; the logging and
 * settings code on top of them is the real one.
 */
import { deleteWeight, getDismissedWeightDates, logFoods, logWeight, restoreWeight } from '../logging';
import { getSettings } from '../settings';
import { DEFAULT_SETTINGS, type Settings } from '../settings-schema';
import type { WeightEntry, WeightSource } from '../types';

// Jest lifts the jest.mock calls below above the imports. The stand-ins only touch `mockPhone`
// when they are called.
const mockPhone = {
  kv: new Map<string, unknown>(),
  weights: new Map<string, WeightEntry>(),
  nextId: 1,
  /** What Health Connect was asked to do, in order. */
  health: [] as string[],
  /** What the reminders were asked to do, in order. */
  reminders: [] as string[],
};

jest.mock('../db', () => {
  const sorted = () => [...mockPhone.weights.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    kvGet: (key: string) => mockPhone.kv.get(key) ?? null,
    kvSet: (key: string, value: unknown) => void mockPhone.kv.set(key, JSON.parse(JSON.stringify(value))),
    notifyChanged: () => {},
    getWeight: (date: string) => mockPhone.weights.get(date) ?? null,
    getLatestWeight: () => sorted().pop() ?? null,
    getWeightsBetween: (from: string, to: string) => sorted().filter((w) => w.date >= from && w.date <= to),
    upsertWeight: (date: string, kg: number, source: WeightSource = 'manual', now: number = Date.now(), hcRecordId: string | null = null) => {
      const row = { id: mockPhone.weights.get(date)?.id ?? mockPhone.nextId++, date, kg, source, createdAt: now, hcRecordId };
      mockPhone.weights.set(date, row);
      return row;
    },
    deleteWeightRow: (date: string) => {
      const row = mockPhone.weights.get(date) ?? null;
      mockPhone.weights.delete(date);
      return row;
    },
    setWeightHealthId: (date: string, hcRecordId: string | null) => {
      const row = mockPhone.weights.get(date);
      if (row) mockPhone.weights.set(date, { ...row, hcRecordId });
    },
    insertEntries: (date: string, meal: string, items: { name: string }[]) => items.map((item, i) => ({ id: i + 1, date, meal, hcRecordId: null, ...item })),
    recordFoodUse: () => {},
  };
});

jest.mock('../health', () => ({
  getHealthGrants: async () => ({ writeNutrition: true, writeExercise: true, readSteps: true, readActiveCalories: true, writeWeight: true, readWeight: true }),
  writeWeight: async (w: WeightEntry) => {
    mockPhone.health.push(`write ${w.date} ${w.kg}`);
    return `ours-${w.date}`;
  },
  deleteWeightRecord: async (id: string) => void mockPhone.health.push(`delete ${id}`),
  writeNutrition: async () => null,
}));

jest.mock('../reminders', () => ({
  cancelReminder: async (meal: string, date: string) => void mockPhone.reminders.push(`cancel ${meal} ${date}`),
  cancelWeighInReminder: async (date: string) => void mockPhone.reminders.push(`cancel weigh-in ${date}`),
  keepRemindersAhead: async () => void mockPhone.reminders.push('keep ahead'),
  rescheduleReminders: async () => void mockPhone.reminders.push('rebuild'),
}));

jest.mock('../../widget/refresh', () => ({ refreshWidgets: async () => {} }));

const TODAY = '2026-11-12';

function setSettings(patch: Partial<Settings>) {
  mockPhone.kv.set('settings', { ...DEFAULT_SETTINGS, ...patch });
}

/** A weigh-in read from a scale through Health Connect, as importHealthWeights stores it. */
function imported(date: string, kg: number): WeightEntry {
  const row: WeightEntry = { id: mockPhone.nextId++, date, kg, source: 'health', createdAt: 1790000300000, hcRecordId: `scale-${date}` };
  mockPhone.weights.set(date, row);
  return row;
}

beforeEach(() => {
  jest.useFakeTimers({
    now: new Date(2026, 10, 12, 8, 0),
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'hrtime'],
  });
  mockPhone.kv.clear();
  mockPhone.weights.clear();
  mockPhone.nextId = 1;
  mockPhone.health = [];
  mockPhone.reminders = [];
  setSettings({ healthConnectEnabled: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('undoing the delete of a weigh-in from another app', () => {
  it('puts back exactly what was there, and writes nothing to Health Connect', async () => {
    const original = imported('2026-11-09', 78.44);
    const removed = await deleteWeight('2026-11-09');
    expect(removed).toEqual(original);
    expect(getDismissedWeightDates()).toEqual(['2026-11-09']);

    const back = await restoreWeight(removed!);
    // Still the other app's reading: two decimals, marked as theirs, with their record.
    expect(back).toMatchObject({ date: '2026-11-09', kg: 78.44, source: 'health', createdAt: 1790000300000, hcRecordId: 'scale-2026-11-09' });
    expect(mockPhone.weights.get('2026-11-09')).toEqual(back);
    // The other app's record never left Health Connect, so nothing is written or deleted there.
    expect(mockPhone.health).toEqual([]);
    // Later syncs may keep the day up to date again.
    expect(getDismissedWeightDates()).toEqual([]);
  });

  it('takes away the reminder that deleting today’s weigh-in brought back', async () => {
    imported(TODAY, 80.02);
    const removed = await deleteWeight(TODAY);
    expect(mockPhone.reminders).toEqual(['rebuild']);
    await restoreWeight(removed!);
    expect(mockPhone.reminders).toEqual(['rebuild', `cancel weigh-in ${TODAY}`]);
  });

  it('leaves the reminders alone for a past day', async () => {
    imported('2026-11-09', 78.44);
    const removed = await deleteWeight('2026-11-09');
    await restoreWeight(removed!);
    expect(mockPhone.reminders).toEqual([]);
  });

  it('leaves a weigh-in that was logged for that day in the meantime', async () => {
    imported('2026-11-09', 55);
    const removed = await deleteWeight('2026-11-09');
    const typed = await logWeight('2026-11-09', 80.5);
    mockPhone.health = [];

    const back = await restoreWeight(removed!);
    expect(back).toEqual(typed);
    expect(mockPhone.weights.get('2026-11-09')).toMatchObject({ kg: 80.5, source: 'manual', hcRecordId: 'ours-2026-11-09' });
    expect(mockPhone.health).toEqual([]);
  });

  it('brings the body weight used for exercise estimates back with it', async () => {
    setSettings({ healthConnectEnabled: true, profile: { sex: 'male', age: 30, heightCm: 175, weightKg: 80, activity: 'moderate', goal: 'lose' } });
    await logWeight('2026-11-08', 80);
    imported('2026-11-09', 79.36);
    const removed = await deleteWeight('2026-11-09');
    expect(getSettings().profile?.weightKg).toBe(80);
    await restoreWeight(removed!);
    expect(getSettings().profile?.weightKg).toBe(79.36);
  });
});

describe('undoing the delete of a weigh-in typed in here', () => {
  it('logs it again and writes it to Health Connect again', async () => {
    await logWeight('2026-11-09', 80.5);
    const removed = await deleteWeight('2026-11-09');
    expect(removed).toMatchObject({ kg: 80.5, source: 'manual', hcRecordId: 'ours-2026-11-09' });
    // Deleting it removed our own record from Health Connect.
    expect(mockPhone.health).toEqual(['write 2026-11-09 80.5', 'delete ours-2026-11-09']);
    expect(getDismissedWeightDates()).toEqual([]);

    const back = await restoreWeight(removed!);
    expect(back).toMatchObject({ date: '2026-11-09', kg: 80.5, source: 'manual', hcRecordId: 'ours-2026-11-09' });
    expect(mockPhone.health).toEqual(['write 2026-11-09 80.5', 'delete ours-2026-11-09', 'write 2026-11-09 80.5']);
  });
});

describe('logging food', () => {
  it('cancels that meal’s reminder and keeps the reminders ahead', async () => {
    const saved = await logFoods({ date: TODAY, meal: 'lunch', items: [{ name: 'Dal', portion: '1 bowl', calories: 180, protein: 9, carbs: 24, fat: 5 }], source: 'text' });
    expect(saved).toHaveLength(1);
    expect(mockPhone.reminders).toEqual([`cancel lunch ${TODAY}`, 'keep ahead']);
  });

  it('touches no reminder when there was nothing to save', async () => {
    const saved = await logFoods({ date: TODAY, meal: 'lunch', items: [{ name: '  ', portion: '', calories: 0, protein: 0, carbs: 0, fat: 0 }], source: 'text' });
    expect(saved).toEqual([]);
    expect(mockPhone.reminders).toEqual([]);
  });
});
