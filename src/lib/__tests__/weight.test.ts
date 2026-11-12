/// <reference types="jest" />
import { daysBetween, formatShortDate, isDateKey, weekdayIndex } from '../dates';
import { DEFAULT_SETTINGS, readSettings } from '../settings-schema';
import { clampWeightKg, formatKg, formatKgChange, isValidWeightKg, planWeightImport, roundKg, type HealthWeightSample } from '../weight';

describe('weight rules', () => {
  it('accepts body weights and nothing else', () => {
    expect(isValidWeightKg(78.4)).toBe(true);
    expect(isValidWeightKg(20)).toBe(true);
    expect(isValidWeightKg(400)).toBe(true);
    expect(isValidWeightKg(19.9)).toBe(false);
    expect(isValidWeightKg(400.1)).toBe(false);
    expect(isValidWeightKg(0)).toBe(false);
    expect(isValidWeightKg(NaN)).toBe(false);
    expect(isValidWeightKg(Infinity)).toBe(false);
    expect(isValidWeightKg('78')).toBe(false);
    expect(isValidWeightKg(null)).toBe(false);
  });

  it('rounds without a floating-point tail', () => {
    expect(roundKg(72.3 + 0.1)).toBe(72.4);
    expect(roundKg(78.449)).toBe(78.4);
    expect(roundKg(78.456, 2)).toBe(78.46);
  });

  it('keeps a stepped weight on the 0.1 kg grid and in range', () => {
    let kg = 78;
    for (let i = 0; i < 7; i++) kg = clampWeightKg(kg + 0.1);
    expect(kg).toBe(78.7);
    expect(clampWeightKg(5)).toBe(20);
    expect(clampWeightKg(999)).toBe(400);
    expect(clampWeightKg(NaN)).toBe(20);
  });

  it('formats weights and changes in plain words', () => {
    expect(formatKg(78)).toBe('78.0 kg');
    expect(formatKg(78.449)).toBe('78.4 kg');
    expect(formatKgChange(-0.42)).toBe('Down 0.4 kg');
    expect(formatKgChange(1.25)).toBe('Up 1.3 kg');
    expect(formatKgChange(0.04)).toBe('No change');
    expect(formatKgChange(-0.04)).toBe('No change');
  });
});

describe('reading other apps’ weigh-ins', () => {
  const at = (date: string, hour: number) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime();
  const sample = (recordId: string, date: string, hour: number, kg: number): HealthWeightSample => ({ recordId, date, time: at(date, hour), kg });

  it('imports a day that has no weigh-in', () => {
    expect(planWeightImport([], [sample('a', '2026-11-01', 7, 79.84)])).toEqual([{ date: '2026-11-01', kg: 79.84, recordId: 'a' }]);
  });

  it('takes the last reading of a day, whatever order they arrive in', () => {
    const samples = [sample('late', '2026-11-01', 21, 80.6), sample('early', '2026-11-01', 7, 79.8), sample('next', '2026-11-02', 7, 79.7)];
    expect(planWeightImport([], samples)).toEqual([
      { date: '2026-11-01', kg: 80.6, recordId: 'late' },
      { date: '2026-11-02', kg: 79.7, recordId: 'next' },
    ]);
  });

  it('never replaces a manual weigh-in', () => {
    const existing = [{ date: '2026-11-01', kg: 80, source: 'manual' as const, hcRecordId: null }];
    expect(planWeightImport(existing, [sample('a', '2026-11-01', 7, 79.8)])).toEqual([]);
  });

  it('leaves an import alone when nothing changed, and updates it when the reading did', () => {
    const existing = [{ date: '2026-11-01', kg: 79.8, source: 'health' as const, hcRecordId: 'a' }];
    expect(planWeightImport(existing, [sample('a', '2026-11-01', 7, 79.8)])).toEqual([]);
    expect(planWeightImport(existing, [sample('a', '2026-11-01', 7, 79.5)])).toEqual([{ date: '2026-11-01', kg: 79.5, recordId: 'a' }]);
    expect(planWeightImport(existing, [sample('b', '2026-11-01', 9, 79.8)])).toEqual([{ date: '2026-11-01', kg: 79.8, recordId: 'b' }]);
  });

  it('does not bring back a day the user deleted', () => {
    const samples = [sample('a', '2026-11-01', 7, 79.8), sample('b', '2026-11-01', 9, 79.9), sample('c', '2026-11-02', 7, 79.7)];
    expect(planWeightImport([], samples, ['2026-11-01'])).toEqual([{ date: '2026-11-02', kg: 79.7, recordId: 'c' }]);
  });

  it('drops readings that are not a body weight', () => {
    const samples = [sample('zero', '2026-11-01', 7, 0), sample('huge', '2026-11-02', 7, 4000), sample('', '2026-11-03', 7, 80), { ...sample('nan', '2026-11-04', 7, 80), time: NaN }];
    expect(planWeightImport([], samples)).toEqual([]);
  });
});

describe('settings', () => {
  it('starts from the defaults, with the weigh-in reminder off at 08:00 and no target weight', () => {
    const s = readSettings(null);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.weighInReminder).toEqual({ enabled: false, hour: 8, minute: 0 });
    expect(s).toMatchObject({ weightGoalKg: null, goalStartDate: null, goalStartWeightKg: null, targetsWeightKg: null });
    expect(readSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(readSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps stored values and fills in the rest', () => {
    const s = readSettings({ calorieGoal: 1850, reminders: { dinner: { enabled: false } }, weighInReminder: { enabled: true }, weightGoalKg: 72.5, goalStartDate: '2026-10-01', goalStartWeightKg: 80 });
    expect(s.calorieGoal).toBe(1850);
    expect(s.proteinGoal).toBe(DEFAULT_SETTINGS.proteinGoal);
    expect(s.reminders.dinner).toEqual({ enabled: false, hour: 21, minute: 0 });
    expect(s.reminders.breakfast).toEqual(DEFAULT_SETTINGS.reminders.breakfast);
    expect(s.weighInReminder).toEqual({ enabled: true, hour: 8, minute: 0 });
    expect(s).toMatchObject({ weightGoalKg: 72.5, goalStartDate: '2026-10-01', goalStartWeightKg: 80 });
  });

  it('does not share its defaults between calls', () => {
    const a = readSettings(null);
    a.reminders.breakfast.hour = 5;
    a.weighInReminder.enabled = true;
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.reminders.breakfast.hour).toBe(9);
    expect(DEFAULT_SETTINGS.weighInReminder.enabled).toBe(false);
  });

  it('drops anything that is not a setting', () => {
    const s = readSettings({ calorieGoal: 1850, apiKey: 'gsk_secret', widget_last_log: { text: 'x' } });
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(JSON.stringify(s)).not.toContain('gsk_secret');
  });

  it('accepts what the Settings screen can save: a goal of zero and an empty model name', () => {
    const problems: string[] = [];
    const s = readSettings({ calorieGoal: 0, fatGoal: 0, textModel: '' }, problems);
    expect(problems).toEqual([]);
    expect(s).toMatchObject({ calorieGoal: 0, fatGoal: 0, textModel: '' });
  });

  it('replaces a value of the wrong kind with the default, and says so when asked', () => {
    const problems: string[] = [];
    const s = readSettings({ calorieGoal: 'many', healthConnectEnabled: 1, textModel: 7, reminders: [], profile: { sex: 'male' }, targetsWeightKg: 'heavy' }, problems);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(problems).toEqual([
      'Settings: the calorie goal is not a number.',
      'Settings: Health Connect syncing should be on or off.',
      'Settings: the text model is not a name.',
      'Settings: the meal reminders are not readable.',
      'Settings: the profile used to work out targets is incomplete.',
      'Settings: the weight the targets were set at is not a weight.',
    ]);
    // Without a list to report to, the same input is read quietly.
    expect(readSettings({ calorieGoal: 'many' })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('date helpers', () => {
  it('counts whole days between two keys', () => {
    expect(daysBetween('2026-11-01', '2026-11-01')).toBe(0);
    expect(daysBetween('2026-11-01', '2026-11-30')).toBe(29);
    expect(daysBetween('2026-11-30', '2026-11-01')).toBe(-29);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2); // leap year
    // Across the spring and autumn clock changes of places that have them.
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
    expect(daysBetween('2026-10-01', '2026-11-15')).toBe(45);
  });

  it('recognises real days only', () => {
    expect(isDateKey('2026-11-11')).toBe(true);
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('2026-1-1')).toBe(false);
    expect(isDateKey('11/11/2026')).toBe(false);
    expect(isDateKey(20261111)).toBe(false);
    expect(isDateKey(null)).toBe(false);
  });

  it('puts Monday first', () => {
    expect(weekdayIndex('2026-11-30')).toBe(0); // Monday
    expect(weekdayIndex('2026-11-11')).toBe(2); // Wednesday
    expect(weekdayIndex('2026-11-01')).toBe(6); // Sunday
  });

  it('writes short dates, with the year only when it differs', () => {
    const now = new Date(2026, 10, 11);
    expect(formatShortDate('2026-12-25', now)).toBe('25 Dec');
    expect(formatShortDate('2027-01-04', now)).toBe('4 Jan 2027');
    expect(formatShortDate('2025-12-31', now)).toBe('31 Dec 2025');
  });
});
