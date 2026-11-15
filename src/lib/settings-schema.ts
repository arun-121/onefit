/**
 * The shape of the app's settings, their defaults, and the code that reads a stored or imported
 * copy back safely. Pure (no SQLite) so the backup check can be tested; `settings.ts` adds the
 * reading and writing.
 */
import { isDateKey } from './dates';
import type { ActivityLevel, GoalType, Profile, Sex } from './nutrition';

export interface ReminderSetting {
  enabled: boolean;
  hour: number;
  minute: number;
}

export type ReminderMeal = 'breakfast' | 'lunch' | 'dinner';

export interface Settings {
  calorieGoal: number;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
  /** Add Health Connect active calories to the day's budget. */
  countExerciseCalories: boolean;
  remindersEnabled: boolean;
  reminders: Record<ReminderMeal, ReminderSetting>;
  healthConnectEnabled: boolean;
  profile: Profile | null;
  textModel: string;
  speechModel: string;
  /** The target weight. Null until the owner sets one. */
  weightGoalKg: number | null;
  /** The weigh-in the target is measured from; stamped when the target is set or changed. */
  goalStartDate: string | null;
  goalStartWeightKg: number | null;
  /** Daily weigh-in reminder. It has its own switch and does not depend on `remindersEnabled`. */
  weighInReminder: ReminderSetting;
  /**
   * The body weight the calorie and macro targets were worked out at. Logging a weight updates
   * `profile.weightKg` but never the targets, so this is what Progress compares against before
   * suggesting a recalculation. Null when the targets were typed in rather than calculated.
   */
  targetsWeightKg: number | null;
  /**
   * Whether this phone has already been asked to allow notifications. Android cannot tell "never
   * asked" from "said no once", so the app remembers, and asks unprompted only once. It is a fact
   * about this phone, not a choice: a backup never carries it and a restore never changes it.
   */
  notificationsAsked: boolean;
  /** The day of the last weekly check-in, taken or put off. Null before the first one. */
  lastCheckInDate: string | null;
  /** A morning notification when the app notices something (see `nudges.ts`). */
  headsUpNotifications: boolean;
}

/** The settings a backup carries: everything except what only this phone can know. */
export type PortableSettings = Omit<Settings, 'notificationsAsked'>;

/** Groq model IDs as of Nov 2026. Models get retired, so these are editable in Settings. */
export const DEFAULT_MODELS = {
  textModel: 'openai/gpt-oss-20b',
  speechModel: 'whisper-large-v3-turbo',
} as const;

export const DEFAULT_SETTINGS: Settings = {
  calorieGoal: 2000,
  proteinGoal: 110,
  carbsGoal: 230,
  fatGoal: 65,
  countExerciseCalories: false,
  remindersEnabled: true,
  reminders: {
    breakfast: { enabled: true, hour: 9, minute: 30 },
    lunch: { enabled: true, hour: 14, minute: 0 },
    dinner: { enabled: true, hour: 21, minute: 0 },
  },
  healthConnectEnabled: false,
  profile: null,
  ...DEFAULT_MODELS,
  weightGoalKg: null,
  goalStartDate: null,
  goalStartWeightKg: null,
  weighInReminder: { enabled: false, hour: 8, minute: 0 },
  targetsWeightKg: null,
  notificationsAsked: false,
  lastCheckInDate: null,
  headsUpNotifications: true,
};

const SEXES: readonly Sex[] = ['male', 'female'];
const ACTIVITY_LEVELS: readonly ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
const GOAL_TYPES: readonly GoalType[] = ['lose_fat', 'build_muscle', 'recomp', 'maintain'];
/** Goals saved before goals had a pace you set, and what each one became. */
const OLD_GOALS: Readonly<Record<string, { goal: GoalType; rateKg?: number }>> = {
  lose: { goal: 'lose_fat', rateKg: 0.5 },
  lose_slow: { goal: 'lose_fat', rateKg: 0.25 },
  gain: { goal: 'build_muscle', rateKg: 0.25 },
};
const REMINDER_MEAL_KEYS: readonly ReminderMeal[] = ['breakfast', 'lunch', 'dinner'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isPositive = (v: unknown): v is number => isAmount(v) && v > 0;

/**
 * Read settings from anything (the stored copy, or a backup file). Known fields with a usable
 * value are kept, missing ones get their default, and unknown fields are dropped, so nothing that
 * is not a setting (an API key, say) can travel through here. A field that is present but has the
 * wrong kind of value is replaced by its default and, when `problems` is given, described there in
 * plain language.
 */
export function readSettings(raw: unknown, problems?: string[]): Settings {
  const src = isRecord(raw) ? raw : {};
  const out: Settings = {
    ...DEFAULT_SETTINGS,
    reminders: {
      breakfast: { ...DEFAULT_SETTINGS.reminders.breakfast },
      lunch: { ...DEFAULT_SETTINGS.reminders.lunch },
      dinner: { ...DEFAULT_SETTINGS.reminders.dinner },
    },
    weighInReminder: { ...DEFAULT_SETTINGS.weighInReminder },
  };
  const bad = (what: string) => problems?.push(`Settings: ${what}.`);
  const has = (key: string) => src[key] !== undefined;

  const amount = (key: 'calorieGoal' | 'proteinGoal' | 'carbsGoal' | 'fatGoal', label: string) => {
    if (!has(key)) return;
    const v = src[key];
    if (isAmount(v)) out[key] = v;
    else bad(`the ${label} is not a number`);
  };
  amount('calorieGoal', 'calorie goal');
  amount('proteinGoal', 'protein goal');
  amount('carbsGoal', 'carbs goal');
  amount('fatGoal', 'fat goal');

  const flag = (key: 'countExerciseCalories' | 'remindersEnabled' | 'healthConnectEnabled' | 'headsUpNotifications', label: string) => {
    if (!has(key)) return;
    const v = src[key];
    if (typeof v === 'boolean') out[key] = v;
    else bad(`${label} should be on or off`);
  };
  flag('countExerciseCalories', 'counting activity from other apps');
  flag('remindersEnabled', 'meal reminders');
  flag('headsUpNotifications', 'heads-up notifications');
  flag('healthConnectEnabled', 'Health Connect syncing');

  const text = (key: 'textModel' | 'speechModel', label: string) => {
    if (!has(key)) return;
    const v = src[key];
    // An empty name is allowed: the Settings field saves on every keystroke, including the last backspace.
    if (typeof v === 'string') out[key] = v;
    else bad(`the ${label} is not a name`);
  };
  text('textModel', 'text model');
  text('speechModel', 'speech model');

  const reminder = (value: unknown, fallback: ReminderSetting, label: string): ReminderSetting => {
    if (!isRecord(value)) {
      bad(`the ${label} reminder is not readable`);
      return fallback;
    }
    const next = { ...fallback };
    if (value.enabled !== undefined) {
      if (typeof value.enabled === 'boolean') next.enabled = value.enabled;
      else bad(`the ${label} reminder should be on or off`);
    }
    const clock = (key: 'hour' | 'minute', max: number) => {
      const v = value[key];
      if (v === undefined) return;
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max) next[key] = v;
      else bad(`the ${label} reminder has a time that does not exist`);
    };
    clock('hour', 23);
    clock('minute', 59);
    return next;
  };
  if (has('reminders')) {
    const all = src.reminders;
    if (isRecord(all)) {
      for (const meal of REMINDER_MEAL_KEYS) {
        if (all[meal] !== undefined) out.reminders[meal] = reminder(all[meal], out.reminders[meal], meal);
      }
    } else bad('the meal reminders are not readable');
  }
  if (has('weighInReminder')) out.weighInReminder = reminder(src.weighInReminder, out.weighInReminder, 'weigh-in');

  if (has('profile') && src.profile !== null) {
    const p = src.profile;
    if (
      isRecord(p) &&
      SEXES.includes(p.sex as Sex) &&
      isAmount(p.age) &&
      isAmount(p.heightCm) &&
      isAmount(p.weightKg) &&
      ACTIVITY_LEVELS.includes(p.activity as ActivityLevel) &&
      (GOAL_TYPES.includes(p.goal as GoalType) || (typeof p.goal === 'string' && p.goal in OLD_GOALS))
    ) {
      const goal = GOAL_TYPES.includes(p.goal as GoalType) ? { goal: p.goal as GoalType } : OLD_GOALS[p.goal as string];
      const rateKg = isPositive(p.rateKg) ? p.rateKg : goal.rateKg;
      out.profile = {
        sex: p.sex as Sex,
        age: p.age,
        heightCm: p.heightCm,
        weightKg: p.weightKg,
        activity: p.activity as ActivityLevel,
        goal: goal.goal,
        ...(rateKg !== undefined ? { rateKg } : {}),
      };
    } else bad('the profile used to work out targets is incomplete');
  }

  const kg = (key: 'weightGoalKg' | 'goalStartWeightKg' | 'targetsWeightKg', label: string) => {
    if (!has(key) || src[key] === null) return;
    const v = src[key];
    if (isPositive(v)) out[key] = v;
    else bad(`the ${label} is not a weight`);
  };
  kg('weightGoalKg', 'target weight');
  kg('goalStartWeightKg', 'starting weight');
  kg('targetsWeightKg', 'weight the targets were set at');

  if (has('goalStartDate') && src.goalStartDate !== null) {
    if (isDateKey(src.goalStartDate)) out.goalStartDate = src.goalStartDate;
    else bad('the date the target weight was set is not a real day');
  }

  if (has('lastCheckInDate') && src.lastCheckInDate !== null) {
    if (isDateKey(src.lastCheckInDate)) out.lastCheckInDate = src.lastCheckInDate;
    else bad('the date of the last check-in is not a real day');
  }

  // About this phone, so never a reason to turn a backup away: anything but a clear yes is a no.
  if (src.notificationsAsked === true) out.notificationsAsked = true;
  return out;
}

/** Settings without the ones that describe this phone, ready to go into a backup. */
export function portableSettings(settings: Settings): PortableSettings {
  const portable: Partial<Settings> = { ...settings };
  delete portable.notificationsAsked;
  return portable as PortableSettings;
}

/**
 * Settings from a backup made whole for this phone: the owner's choices come from the backup, and
 * what only this phone can know (has it been asked about notifications?) stays as it is here.
 */
export function withPhoneSettings(fromBackup: PortableSettings, onThisPhone: Pick<Settings, 'notificationsAsked'>): Settings {
  return { ...fromBackup, notificationsAsked: onThisPhone.notificationsAsked };
}
