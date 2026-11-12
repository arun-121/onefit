/// <reference types="jest" />
import {
  BACKUP_APP,
  BACKUP_FORMAT,
  backupFileName,
  describeBackup,
  keepPhoneState,
  makeBackupFile,
  validateBackup,
  type BackupCheck,
  type BackupData,
} from '../backup-format';
import { DEFAULT_SETTINGS, portableSettings, readSettings, type Settings } from '../settings-schema';

/** The settings as they are stored on the phone the backup is made on. */
const phoneSettings: Settings = {
  ...DEFAULT_SETTINGS,
  calorieGoal: 1900,
  weightGoalKg: 75,
  goalStartDate: '2026-10-01',
  goalStartWeightKg: 80,
  weighInReminder: { enabled: true, hour: 7, minute: 30 },
  profile: { sex: 'male' as const, age: 30, heightCm: 175, weightKg: 78.4, activity: 'moderate' as const, goal: 'lose' as const },
  targetsWeightKg: 80,
  notificationsAsked: true,
};

/** What a backup holds of them: everything but the facts about that phone. */
const settings = portableSettings(phoneSettings);

const data: BackupData = {
  entries: [
    { id: 1, date: '2026-10-01', meal: 'breakfast', name: 'Idli', portion: '3 pieces', calories: 180, protein: 6, carbs: 36, fat: 1, source: 'text', createdAt: 1790000000000, hcRecordId: 'hc-1' },
    { id: 2, date: '2026-10-02', meal: 'snack', name: 'Black coffee', portion: '', calories: 2, protein: 0, carbs: 0, fat: 0, source: 'favourite', createdAt: 1790000100000, hcRecordId: null },
  ],
  foods: [{ id: 7, name: 'Idli', portion: '3 pieces', calories: 180, protein: 6, carbs: 36, fat: 1, pinned: true, useCount: 12, lastUsedAt: 1790000000000 }],
  exercises: [{ id: 3, date: '2026-10-03', activity: 'run', minutes: 30, intensity: 'moderate', calories: 320, createdAt: 1790000200000, hcSessionId: 's-1', hcCaloriesId: 'c-1' }],
  weights: [
    { id: 1, date: '2026-09-30', kg: 80, source: 'manual', createdAt: 1789900000000, hcRecordId: null },
    { id: 2, date: '2026-10-04', kg: 79.6, source: 'health', createdAt: 1790000300000, hcRecordId: 'scale-9' },
  ],
  settings,
};

/** A backup as it comes back from a file: plain JSON. */
function file(change?: (raw: any) => void): unknown {
  const raw = JSON.parse(JSON.stringify(makeBackupFile(data, new Date('2026-11-11T08:00:00.000Z'))));
  change?.(raw);
  return raw;
}

function problems(check: BackupCheck): string[] {
  if (check.ok) throw new Error('expected the file to be rejected');
  return check.problems;
}

describe('a good backup', () => {
  it('passes and comes back typed, with a summary', () => {
    const check = validateBackup(file());
    if (!check.ok) throw new Error(check.problems.join(' '));
    expect(check.backup).toEqual({ app: 'calorie-tracker', format: 1, exportedAt: '2026-11-11T08:00:00.000Z', data });
    expect(check.summary).toEqual({
      exportedAt: '2026-11-11T08:00:00.000Z',
      entries: 2,
      foods: 1,
      exercises: 1,
      weights: 2,
      firstDate: '2026-09-30',
      lastDate: '2026-10-04',
    });
  });

  it('may be empty', () => {
    const check = validateBackup(file((raw) => Object.assign(raw.data, { entries: [], foods: [], exercises: [], weights: [] })));
    if (!check.ok) throw new Error(check.problems.join(' '));
    expect(check.summary).toMatchObject({ entries: 0, foods: 0, exercises: 0, weights: 0, firstDate: null, lastDate: null });
  });

  it('survives a second round trip unchanged', () => {
    const first = validateBackup(file());
    if (!first.ok) throw new Error('first check failed');
    const second = validateBackup(JSON.parse(JSON.stringify(first.backup)));
    expect(second).toEqual(first);
  });

  it('ignores fields the app does not know, wherever they are', () => {
    const check = validateBackup(
      file((raw) => {
        raw.madeBy = 'someone';
        raw.data.photos = [1, 2, 3];
        raw.data.entries[0].mood = 'hungry';
        raw.data.foods[0].barcode = '123';
        raw.data.exercises[0].route = [];
        raw.data.weights[0].bodyFat = 20;
        raw.data.settings.groqApiKey = 'gsk_secret';
        raw.data.settings.reminders.breakfast.sound = 'bell';
      }),
    );
    if (!check.ok) throw new Error(check.problems.join(' '));
    expect(check.backup.data).toEqual(data);
    expect(JSON.stringify(check.backup)).not.toContain('gsk_secret');
    expect(Object.keys(check.backup)).toEqual(['app', 'format', 'exportedAt', 'data']);
  });

  it('fills settings a backup from an older version does not have', () => {
    const check = validateBackup(
      file((raw) => {
        raw.data.settings = { calorieGoal: 1800, reminders: { lunch: { enabled: false, hour: 13, minute: 15 } } };
      }),
    );
    if (!check.ok) throw new Error(check.problems.join(' '));
    expect(check.backup.data.settings).toEqual(
      portableSettings({
        ...DEFAULT_SETTINGS,
        calorieGoal: 1800,
        reminders: { ...DEFAULT_SETTINGS.reminders, lunch: { enabled: false, hour: 13, minute: 15 } },
      }),
    );
  });

  it('takes nothing about a phone from the file, even when it is there and unreadable', () => {
    for (const claimed of [true, false, 'yes', 1, null]) {
      const check = validateBackup(file((raw) => (raw.data.settings.notificationsAsked = claimed)));
      if (!check.ok) throw new Error(check.problems.join(' '));
      expect(check.backup.data.settings).toEqual(settings);
      expect(check.backup.data.settings).not.toHaveProperty('notificationsAsked');
    }
  });

  it('treats a missing Health Connect id or portion as none', () => {
    const check = validateBackup(
      file((raw) => {
        delete raw.data.entries[1].hcRecordId;
        delete raw.data.entries[1].portion;
        delete raw.data.exercises[0].hcCaloriesId;
      }),
    );
    if (!check.ok) throw new Error(check.problems.join(' '));
    expect(check.backup.data.entries[1]).toMatchObject({ hcRecordId: null, portion: '' });
    expect(check.backup.data.exercises[0].hcCaloriesId).toBeNull();
  });

  it('keeps an entry made in a way a newer or older version knew', () => {
    const check = validateBackup(file((raw) => (raw.data.entries[0].source = 'photo')));
    if (!check.ok) throw new Error(check.problems.join(' '));
    expect(check.backup.data.entries[0].source).toBe('photo');
  });
});

describe('the wrong file', () => {
  it.each([null, undefined, 42, 'calorie-tracker', [], {}, { app: 'another-app', format: 1 }, { format: 1, data: {} }])(
    'rejects %p as not a backup',
    (raw) => {
      expect(validateBackup(raw)).toEqual({ ok: false, problems: ['This file is not a Calorie Tracker backup.'] });
    },
  );

  it('rejects a format from a newer app, and says to update', () => {
    expect(problems(validateBackup(file((raw) => (raw.format = 2))))).toEqual([
      'This backup was made by a newer version of Calorie Tracker. Update the app, then restore it.',
    ]);
  });

  it.each([0, '1', null, undefined, 1.5])('rejects the format number %p', (format) => {
    expect(problems(validateBackup(file((raw) => (raw.format = format))))).toEqual(['This backup is in a format this app does not understand.']);
  });

  it('rejects a file with no data', () => {
    expect(problems(validateBackup(file((raw) => delete raw.data)))).toEqual(['The backup has no data in it.']);
    expect(problems(validateBackup(file((raw) => (raw.data = []))))).toEqual(['The backup has no data in it.']);
  });

  it('rejects a file that does not say when it was made', () => {
    expect(problems(validateBackup(file((raw) => delete raw.exportedAt)))).toEqual(['The backup does not say when it was made.']);
    expect(problems(validateBackup(file((raw) => (raw.exportedAt = 'last Tuesday'))))).toEqual(['The backup does not say when it was made.']);
  });
});

describe('missing lists', () => {
  it.each([
    ['entries', 'The backup has no list of food entries.'],
    ['foods', 'The backup has no list of saved foods.'],
    ['exercises', 'The backup has no list of workouts.'],
    ['weights', 'The backup has no list of weigh-ins.'],
  ])('rejects a backup without %s', (key, message) => {
    expect(problems(validateBackup(file((raw) => delete raw.data[key])))).toEqual([message]);
    expect(problems(validateBackup(file((raw) => (raw.data[key] = { 0: {} }))))).toEqual([message]);
  });

  it('rejects a backup without settings', () => {
    expect(problems(validateBackup(file((raw) => delete raw.data.settings)))).toEqual(['The backup has no settings.']);
    expect(problems(validateBackup(file((raw) => (raw.data.settings = 'default'))))).toEqual(['The backup has no settings.']);
  });

  it('lists everything that is missing at once', () => {
    expect(problems(validateBackup({ app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt: '2026-11-11T08:00:00.000Z', data: {} }))).toEqual([
      'The backup has no list of food entries.',
      'The backup has no list of saved foods.',
      'The backup has no list of workouts.',
      'The backup has no list of weigh-ins.',
      'The backup has no settings.',
    ]);
  });
});

describe('bad rows', () => {
  it('names the row and what is wrong with it', () => {
    const found = problems(
      validateBackup(
        file((raw) => {
          raw.data.entries[0].date = '2026-02-30';
          raw.data.entries[1].calories = 'lots';
          raw.data.entries[1].name = '  ';
        }),
      ),
    );
    expect(found).toEqual(['Food entry 1 has a date that is not a real day.', 'Food entry 2 has no name, and has calories that are not a number.']);
  });

  it.each([
    ['a meal the app does not know', (raw: any) => (raw.data.entries[0].meal = 'brunch'), 'Food entry 1 has a meal this app does not know.'],
    ['negative calories', (raw: any) => (raw.data.entries[0].calories = -5), 'Food entry 1 has calories that are not a number.'],
    ['missing protein', (raw: any) => delete raw.data.entries[0].protein, 'Food entry 1 has protein that is not a number.'],
    ['a number that JSON could not hold', (raw: any) => (raw.data.entries[0].fat = null), 'Food entry 1 has fat that is not a number.'],
    ['an id that is not a whole number', (raw: any) => (raw.data.entries[0].id = 1.5), 'Food entry 1 has no id.'],
    ['a missing date', (raw: any) => delete raw.data.entries[0].date, 'Food entry 1 has a date that is not a real day.'],
    ['a date in another shape', (raw: any) => (raw.data.entries[0].date = '1/10/2026'), 'Food entry 1 has a date that is not a real day.'],
    ['a name that is not text', (raw: any) => (raw.data.entries[0].name = 12), 'Food entry 1 has a name that is not text.'],
    ['a missing time', (raw: any) => delete raw.data.entries[0].createdAt, 'Food entry 1 has a time that is not a number.'],
    ['a Health Connect id that is not text', (raw: any) => (raw.data.entries[0].hcRecordId = 5), 'Food entry 1 has a Health Connect id that is not text.'],
    ['a row that is not an object', (raw: any) => (raw.data.entries[0] = 'idli'), 'Food entry 1 is not readable.'],
    ['a saved food without a star value', (raw: any) => (raw.data.foods[0].pinned = 1), 'Saved food 1 has a star that is not yes or no.'],
    ['a saved food without a name', (raw: any) => delete raw.data.foods[0].name, 'Saved food 1 has no name.'],
    ['an activity the app does not know', (raw: any) => (raw.data.exercises[0].activity = 'chess'), 'Workout 1 has an activity this app does not know.'],
    ['an intensity the app does not know', (raw: any) => (raw.data.exercises[0].intensity = 'extreme'), 'Workout 1 has an intensity this app does not know.'],
    ['workout minutes that are not a number', (raw: any) => (raw.data.exercises[0].minutes = '30'), 'Workout 1 has minutes that are not a number.'],
    ['an impossible weight', (raw: any) => (raw.data.weights[0].kg = 5), 'Weigh-in 1 has a weight that is not possible.'],
    ['a weight of zero', (raw: any) => (raw.data.weights[0].kg = 0), 'Weigh-in 1 has a weight that is not possible.'],
    ['a weight that is not a number', (raw: any) => (raw.data.weights[0].kg = '80'), 'Weigh-in 1 has a weight that is not possible.'],
    ['a weigh-in from an unknown source', (raw: any) => (raw.data.weights[1].source = 'guess'), 'Weigh-in 2 has a source this app does not know.'],
  ])('rejects %s', (_name, change, message) => {
    expect(problems(validateBackup(file(change)))).toEqual([message]);
  });

  it('rejects rows that share an id, and weigh-ins that share a day', () => {
    expect(problems(validateBackup(file((raw) => (raw.data.entries[1].id = 1))))).toEqual(['Two food entries share the id 1.']);
    expect(problems(validateBackup(file((raw) => (raw.data.weights[1].date = '2026-09-30'))))).toEqual(['Two weigh-ins share the date 2026-09-30.']);
  });

  it('rejects settings with the wrong kind of value', () => {
    const found = problems(
      validateBackup(
        file((raw) => {
          raw.data.settings.calorieGoal = '1900';
          raw.data.settings.remindersEnabled = 'yes';
          raw.data.settings.weighInReminder.hour = 25;
          raw.data.settings.profile.activity = 'lazy';
          raw.data.settings.weightGoalKg = -3;
          raw.data.settings.goalStartDate = 'October';
        }),
      ),
    );
    expect(found).toEqual([
      'Settings: the calorie goal is not a number.',
      'Settings: meal reminders should be on or off.',
      'Settings: the weigh-in reminder has a time that does not exist.',
      'Settings: the profile used to work out targets is incomplete.',
      'Settings: the target weight is not a weight.',
      'Settings: the date the target weight was set is not a real day.',
    ]);
  });

  it('spells out the first few problems and counts the rest', () => {
    const found = problems(
      validateBackup(
        file((raw) => {
          raw.data.entries = Array.from({ length: 30 }, (_, i) => ({ ...raw.data.entries[0], id: i + 1, calories: 'x' }));
        }),
      ),
    );
    expect(found).toHaveLength(9);
    expect(found[0]).toBe('Food entry 1 has calories that are not a number.');
    expect(found[8]).toBe('And 22 more problems like these.');
  });

  it('never uses words the app does not use', () => {
    const everything = problems(
      validateBackup(
        file((raw) => {
          raw.data.entries[0] = { id: 'a' };
          raw.data.foods[0] = {};
          raw.data.exercises[0] = {};
          raw.data.weights[0] = {};
          raw.data.settings = { calorieGoal: null, reminders: 5, profile: 'me' };
        }),
      ),
    ).join(' ');
    expect(everything).not.toMatch(/undefined|NaN|null|!|successfully/);
  });
});

describe('making a backup', () => {
  it('stamps the app, the format and the time', () => {
    const backup = makeBackupFile(data, new Date('2026-11-11T08:00:00.000Z'));
    expect(backup).toMatchObject({ app: 'calorie-tracker', format: 1, exportedAt: '2026-11-11T08:00:00.000Z' });
    expect(Object.keys(backup.data).sort()).toEqual(['entries', 'exercises', 'foods', 'settings', 'weights']);
  });

  it('writes out settings only, whatever else is stored beside them', () => {
    const backup = makeBackupFile({ ...data, settings: { ...settings, apiKey: 'gsk_secret' } as typeof settings }, new Date('2026-11-11T08:00:00.000Z'));
    expect(JSON.stringify(backup)).not.toContain('gsk_secret');
    expect(backup.data.settings).toEqual(settings);
  });

  it('leaves out what only this phone can know', () => {
    // The phone's full settings go in, as buildBackup passes them.
    const backup = makeBackupFile({ ...data, settings: phoneSettings }, new Date('2026-11-11T08:00:00.000Z'));
    expect(backup.data.settings).toEqual(settings);
    expect(JSON.stringify(backup)).not.toContain('notificationsAsked');
  });

  it('names the file for the local day', () => {
    expect(backupFileName(new Date(2026, 10, 11, 23, 30))).toBe('calorie-tracker-backup-2026-11-11.json');
    expect(backupFileName(new Date(2027, 0, 5, 0, 10))).toBe('calorie-tracker-backup-2027-01-05.json');
  });

  it('describes what is inside', () => {
    const check = validateBackup(file());
    if (!check.ok) throw new Error('rejected');
    expect(describeBackup(check.summary, new Date(2026, 10, 11))).toBe('2 food entries, 1 workout, 2 weigh-ins and 1 saved food, from 30 Sep to 4 Oct');
    expect(describeBackup({ ...check.summary, entries: 1240, firstDate: null, lastDate: null })).toBe('1,240 food entries, 1 workout, 2 weigh-ins and 1 saved food');
    expect(describeBackup({ ...check.summary, firstDate: '2025-12-31', lastDate: '2025-12-31' }, new Date(2026, 10, 11))).toBe(
      '2 food entries, 1 workout, 2 weigh-ins and 1 saved food, from 31 Dec 2025',
    );
  });
});

describe('what a restore keeps from this phone', () => {
  const backup = (() => {
    const check = validateBackup(file());
    if (!check.ok) throw new Error(check.problems.join(' '));
    return check.backup.data;
  })();

  it('takes the settings from the backup', () => {
    const kept = keepPhoneState(backup, { settings: DEFAULT_SETTINGS, dismissedWeightDates: [] });
    expect(kept.settings).toEqual({ ...settings, notificationsAsked: false });
    expect(kept.dismissedWeightDates).toEqual([]);
  });

  it('keeps whether this phone was asked about notifications, whichever way it is', () => {
    const asked = keepPhoneState(backup, { settings: { notificationsAsked: true }, dismissedWeightDates: [] });
    expect(asked.settings).toEqual({ ...settings, notificationsAsked: true });
    // A backup from a phone that was asked does not make a new phone think it was.
    const notAsked = keepPhoneState(backup, { settings: { notificationsAsked: false }, dismissedWeightDates: [] });
    expect(notAsked.settings.notificationsAsked).toBe(false);
  });

  it('gives back settings the app can read again unchanged', () => {
    const kept = keepPhoneState(backup, { settings: { notificationsAsked: true }, dismissedWeightDates: [] });
    expect(readSettings(JSON.parse(JSON.stringify(kept.settings)))).toEqual(kept.settings);
  });

  it('keeps the days whose imported weigh-in was deleted here', () => {
    // 9 Nov: a reading from the scale that was deleted on this phone. The backup has no weigh-in that day.
    const kept = keepPhoneState(backup, { settings: DEFAULT_SETTINGS, dismissedWeightDates: ['2026-11-09', '2026-10-20'] });
    expect(kept.dismissedWeightDates).toEqual(['2026-10-20', '2026-11-09']);
  });

  it('stops dismissing a day that has a weigh-in again in the backup', () => {
    // The backup holds weigh-ins for 30 Sep (typed in) and 4 Oct (from another app).
    const kept = keepPhoneState(backup, { settings: DEFAULT_SETTINGS, dismissedWeightDates: ['2026-09-30', '2026-10-04', '2026-11-09'] });
    expect(kept.dismissedWeightDates).toEqual(['2026-11-09']);
  });

  it('drops repeats and anything that is not a real day', () => {
    const stored = ['2026-11-09', '2026-11-09', '2026-02-30', 'yesterday', ''];
    expect(keepPhoneState(backup, { settings: DEFAULT_SETTINGS, dismissedWeightDates: stored }).dismissedWeightDates).toEqual(['2026-11-09']);
  });

  it('does not change what it was given', () => {
    const dismissed = ['2026-11-09', '2026-10-20'];
    keepPhoneState(backup, { settings: DEFAULT_SETTINGS, dismissedWeightDates: dismissed });
    expect(dismissed).toEqual(['2026-11-09', '2026-10-20']);
    expect(backup.settings).toEqual(settings);
  });
});

describe('the setting that is about this phone', () => {
  it('is off until the phone has been asked', () => {
    expect(readSettings(null).notificationsAsked).toBe(false);
    expect(readSettings({ notificationsAsked: true }).notificationsAsked).toBe(true);
  });

  it('reads anything but a clear yes as not asked, without complaint', () => {
    for (const stored of [false, 'true', 1, null, {}]) {
      const found: string[] = [];
      expect(readSettings({ notificationsAsked: stored }, found).notificationsAsked).toBe(false);
      expect(found).toEqual([]);
    }
  });

  it('is the only thing a backup leaves out of the settings', () => {
    const all = Object.keys(DEFAULT_SETTINGS).sort();
    const carried = Object.keys(portableSettings(DEFAULT_SETTINGS)).sort();
    expect(all.filter((key) => !carried.includes(key))).toEqual(['notificationsAsked']);
    // The original is left whole.
    expect(DEFAULT_SETTINGS).toHaveProperty('notificationsAsked', false);
  });
});
