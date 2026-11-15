/**
 * Every figure on the Progress tab, and the streak and weight rate on Today.
 *
 * Pure: no React, no SQLite, no clock. Everything is worked out from the rows passed in, so each
 * definition in docs/PRODUCT.md can be tested with hand-computed numbers. `insights-data.ts`
 * gathers the rows.
 *
 * The honesty rule: a figure that the data cannot support is returned as
 * `{ ready: false, reason }`, with the reason written for the owner to read and, where it helps,
 * the thing to log to unlock it. Nothing here returns NaN or Infinity.
 */
import { addDays, dateKeyToDate, daysBetween, formatShortDate, isDateKey, weekdayIndex } from './dates';
import { ACTIVITIES, ACTIVITY_ORDER, formatMinutes, isActivity, type Activity } from './exercise';
import { calculateTargets, formatKcal, tdee, type Profile, type Targets } from './nutrition';
import { MEAL_LABELS, MEALS, type Macros, type Meal } from './types';
import { formatKg, isValidWeightKg, roundKg } from './weight';

// ---------------------------------------------------------------- definitions

export type InsightPeriod = 7 | 30 | 90;
export const INSIGHT_PERIODS: readonly InsightPeriod[] = [7, 30, 90];

export function isInsightPeriod(value: unknown): value is InsightPeriod {
  return value === 7 || value === 30 || value === 90;
}

/** Energy in a kilogram of body weight, the usual rule of thumb. */
export const KCAL_PER_KG = 7700;
/**
 * A complete ("full") day has at least max(800, 40% of the calorie goal) logged, and is over:
 * today is never one, however much is on it, and counts from tomorrow.
 */
export const COMPLETE_DAY_MIN_KCAL = 800;
export const COMPLETE_DAY_GOAL_SHARE = 0.4;
/** An average (calories, macros, a week's row) is shown from this many full days. Fewer is a day, not an average. */
export const AVERAGE_MIN_DAYS = 3;
/** Below this share of full days among the days that could have been logged, the headline leads with the coverage. */
export const LOW_COVERAGE_SHARE = 0.6;
/** The average budget is mentioned once workouts move it this far from the goal, in kcal a day. */
export const BUDGET_NOTE_MIN_KCAL = 25;
/** Exercise "a week on average" needs the app to have been in use for this many days. */
export const EXERCISE_WEEKLY_MIN_DAYS = 7;
/** Rate: at least 3 weigh-ins spanning at least 7 calendar days, first and last included. */
export const RATE_MIN_WEIGH_INS = 3;
export const RATE_MIN_SPAN_DAYS = 7;
/** One weigh-in is taken to be good to no better than this: the scale, and a day's water. */
export const WEIGH_IN_NOISE_KG = 0.3;
/** A rate is clear, and may be stated, when it is at least this many standard errors away from zero. */
export const RATE_CLEAR_SE = 2;
/** A rate that is not clear, but is pinned to within this many kg a week of zero, is holding steady. */
export const STEADY_WITHIN_KG_PER_WEEK = 0.3;
/** An unclear rate reads "Too early to say" until the weigh-ins cover this many days, then "No clear direction yet". */
export const UNCLEAR_LONG_DAYS = 21;
/**
 * The window behind the figures that do not follow the period switch: the current weight, Today's
 * weekly rate, and the rate and date the 7-day view borrows (a week is too short for its own).
 */
export const RATE_WINDOW_DAYS = 30;
/** Current weight without a fit: the mean of up to 3 weigh-ins made no more than 10 days before the latest. */
export const CURRENT_WEIGHT_MAX_WEIGH_INS = 3;
export const CURRENT_WEIGHT_WITHIN_DAYS = 10;
/** The 7-day view compares two weekly averages when each week has at least this many weigh-ins. */
export const WEEK_AVERAGE_MIN_WEIGH_INS = 2;
/** Maintenance: 14 days between first and last weigh-in, 4 weigh-ins, complete days on 60% of the days between. */
export const MAINTENANCE_MIN_DAYS_BETWEEN = 14;
export const MAINTENANCE_MIN_WEIGH_INS = 4;
export const MAINTENANCE_MIN_COMPLETE_SHARE = 0.6;
/** Maintenance is a range, each end to the nearest 50 kcal. Wider than 600 kcal it is not shown at all. */
export const MAINTENANCE_ROUND_KCAL = 50;
export const MAINTENANCE_MAX_WIDTH_KCAL = 600;
/** How sure the maintenance range is, from its width: good up to 200 kcal, fair up to 400, rough beyond. */
export const MAINTENANCE_GOOD_WIDTH_KCAL = 200;
export const MAINTENANCE_FAIR_WIDTH_KCAL = 400;
/** A day counts for protein when it reached 90% of the goal. */
export const PROTEIN_HIT_SHARE = 0.9;
/** Suggest recalculating targets once weight has moved this far from the weight they were set at. */
export const RECALC_AFTER_KG = 2;
/** Below this many kg a week, in either direction, a rate is too small to state however sure it is. */
export const FLAT_KG_PER_WEEK = 0.05;
/** Patterns need this many complete days before they say anything. */
export const PATTERNS_MIN_DAYS = 5;
/**
 * A difference between groups of days is stated only when it is at least this many standard
 * errors, worked out from the sample standard deviation of the period's full days. With a month
 * of days drawn from one distribution, the old fixed 50 kcal named a highest day 99 times in 100.
 */
export const PATTERN_CLEAR_SE = 2;
/** Weekdays against weekends: 3 full days of each, and a difference of at least 100 kcal. */
export const WEEK_SPLIT_MIN_DAYS = 3;
export const WEEK_SPLIT_MIN_KCAL = 100;
/**
 * The highest day of the week: two weeks of full days, 3 of a weekday before it is compared (or
 * drawn as a bar), and at least 150 kcal above the average of all full days.
 */
export const HIGHEST_DAY_MIN_DAYS = 14;
export const WEEKDAY_MIN_DAYS = 3;
export const HIGHEST_DAY_MIN_KCAL = 150;
/** A weekday is named as most often not logged in full when that happened on at least half of 3 or more of them. */
export const SKIPPED_WEEKDAY_MIN_DAYS = 3;
export const SKIPPED_WEEKDAY_MIN_SHARE = 0.5;
/** "Week by week" compares blocks of this many days, counted back from today. */
export const WEEK_BLOCK_DAYS = 7;
/** A projection further out than this is not worth a date. */
const PROJECTION_MAX_DAYS = 730;
/** A goal date is given as a span once its early and late ends are more than this many days apart. */
const PROJECTION_SPAN_MIN_DAYS = 14;
/** A chart covers at least this many days, however recently the app was first used. */
export const CHART_MIN_DAYS = 7;
/** An estimate outside this range means the weigh-ins and the food log disagree, not a real metabolism. */
const MAINTENANCE_PLAUSIBLE = { min: 1000, max: 6000 };

export function completeDayThreshold(calorieGoal: number): number {
  const goal = Number.isFinite(calorieGoal) && calorieGoal > 0 ? calorieGoal : 0;
  return Math.max(COMPLETE_DAY_MIN_KCAL, COMPLETE_DAY_GOAL_SHARE * goal);
}

// ---------------------------------------------------------------- result building blocks

export type InsightAction =
  | 'log-weight'
  | 'log-food'
  | 'log-exercise'
  | 'set-goal'
  /** The figure needs a longer period than the one selected: switch the Progress tab to 30 days. */
  | 'longer-period';

/**
 * How far along a figure that is not ready yet is, when what it waits for is a count: what there is
 * against what it needs ("Weigh-ins", 2 of 4). It says nothing `reason` does not; it is there so the
 * count can be drawn as a meter.
 */
export interface NotReadyProgress {
  /** What is counted, in a word or two: "Weigh-ins", "Full days". */
  label: string;
  have: number;
  need: number;
}

export interface NotReady {
  ready: false;
  /** Why the figure is missing, as a sentence to show the owner. */
  reason: string;
  /** The one step that unlocks it, when there is one: something to log, or a longer period to look at. */
  action?: InsightAction;
  /** Set when the reason is a count short of a threshold. */
  progress?: NotReadyProgress;
}

/** A card, or one figure on a card: either the data, or the reason it is not there yet. */
export type Card<T> = ({ ready: true } & T) | NotReady;

const notReady = (reason: string, action?: InsightAction, progress?: NotReadyProgress): NotReady => ({
  ready: false,
  reason,
  ...(action ? { action } : {}),
  ...(progress ? { progress } : {}),
});
const progressOf = (label: string, have: number, need: number): NotReadyProgress => ({ label, have, need });

// ---------------------------------------------------------------- input

/** Food totals for one day (the shape `getDailyTotals` returns). */
export interface DayFoodTotal extends Macros {
  date: string;
  /** Number of food entries. */
  count: number;
}

export interface WeighIn {
  date: string;
  kg: number;
}

export interface ExerciseLog {
  date: string;
  activity: Activity;
  minutes: number;
  calories: number;
}

export interface MealCalories {
  date: string;
  meal: Meal;
  calories: number;
}

export interface FoodCalories {
  name: string;
  calories: number;
  /** Times logged. */
  count: number;
}

export interface InsightsInput {
  /** Local day key. The period ends on this day. */
  today: string;
  days: InsightPeriod;
  /** Daily goals: calories in kcal, the rest in grams. */
  goals: Macros;
  weightGoalKg: number | null;
  goalStartDate: string | null;
  goalStartWeightKg: number | null;
  profile: Profile | null;
  /** The weight the calorie and macro targets were worked out at, when they were calculated. */
  targetsWeightKg: number | null;
  /** Food totals per day. Days outside the period are ignored. */
  dayTotals: readonly DayFoodTotal[];
  /** Workouts. Ones outside the period are ignored. */
  exercises: readonly ExerciseLog[];
  /** Weigh-ins. Pass everything on record: the current weight and the 7-day view reach back past the period. */
  weights: readonly WeighIn[];
  /** Calories per meal per day. Days outside the period are ignored. */
  mealCalories: readonly MealCalories[];
  /** Foods logged in the period with their total calories, grouped by name. */
  topFoods: readonly FoodCalories[];
  /** Every day with at least one food entry, all time. Streaks reach back past the period. */
  loggedDates: readonly string[];
  /** The day of the first workout ever logged, if any (for the weekly average). */
  firstExerciseDate: string | null;
  /**
   * True when Today and the day view add activity from other apps (Health Connect) to a day's
   * budget: `settings.countExerciseCalories && settings.healthConnectEnabled`. That activity is
   * not stored per day, so Progress cannot count it; the Calories note says so when this is set.
   */
  countsOtherActivity?: boolean;
}

// ---------------------------------------------------------------- output

export type DayStatus =
  /** Before the first day anything was logged: not a missed day. */
  | 'before'
  /** Nothing logged. */
  | 'none'
  /** Logged, at or under budget. */
  | 'within'
  /** Logged, over budget. */
  | 'over';

export type Direction = 'down' | 'up' | 'flat';

export interface HeadlineInfo {
  /** One sentence with the most important fact of the period. */
  text: string;
  tone: 'down' | 'up' | 'steady' | 'neutral';
}
export type HeadlineCard = Card<HeadlineInfo>;

export interface WeightChartPoint {
  date: string;
  /** Days from the start of the period: 0 for the first day, `days - 1` for today. Use it for x. */
  dayIndex: number;
  kg: number;
}

/** One end of the straight line through the weigh-ins, in the same `dayIndex` space as the points. */
export interface WeightLineEnd {
  date: string;
  dayIndex: number;
  /** The fitted weight on that day, to two decimals. */
  kg: number;
}

/**
 * The least-squares line through a set of weigh-ins, and what it supports saying.
 *
 * Exactly one of three things holds:
 *  - `clear`: the slope is at least twice its standard error. `direction` is 'down' or 'up', and
 *    `kgPerWeek` and `changeKg` may be shown.
 *  - `steady`: not clear, and the weigh-ins pin the rate to within 0.3 kg a week of zero.
 *    `direction` is 'flat'. Say "steady", and show no rate.
 *  - neither: the weigh-ins cannot tell a change from day-to-day swings. `direction` is null.
 *    Show no rate, no change and no arrow; `rateText` and `changeText` say so.
 */
export interface WeightRate {
  /** Least-squares slope of the weigh-ins, in kg a week. Negative when losing. Show it only when `clear`. */
  kgPerWeek: number;
  /** One standard error of that slope, in kg a week, taking a weigh-in to be good to no better than 0.3 kg. */
  seKgPerWeek: number;
  clear: boolean;
  steady: boolean;
  /** The fitted weight on the day of the latest weigh-in: the weight now with the day-to-day swings taken out. */
  nowKg: number;
  /** The change the slope gives between the first and last weigh-in. Show it only when `clear`. */
  changeKg: number;
  /** Calendar days from the first to the last weigh-in, both included. */
  days: number;
  weighIns: number;
  fromDate: string;
  toDate: string;
  direction: Direction | null;
  /** Whether the weight is moving toward the target; null with no target, or when the rate is not clear. */
  towardGoal: boolean | null;
  /**
   * "Down 2.0 kg in 29 days" or "Up 0.8 kg in 14 days" when clear, "Steady over 29 days" when
   * steady, else "Your weigh-ins vary from day to day by more than the change so far". No full stop.
   */
  changeText: string;
  /**
   * "Losing 0.5 kg a week" or "Gaining 0.3 kg a week" when clear, "Holding steady" when steady,
   * else "Too early to say" (under 3 weeks of weigh-ins) or "No clear direction yet".
   */
  rateText: string;
}

/** The 7-day view's two weekly averages: a plain comparison, not a rate. */
export interface WeekAverages {
  /** The last 7 days, today included. Averages are to 0.1 kg. */
  thisWeek: { average: number; weighIns: number };
  /** The 7 days before that, which lie outside the 7-day period. */
  lastWeek: { average: number; weighIns: number };
  /** This week's average minus last week's, to 0.1 kg. */
  changeKg: number;
  /** "Your weigh-ins averaged 80.4 kg over the last 7 days, 0.6 kg lower than the 7 days before (3 and 2 weigh-ins)." */
  text: string;
}

export type WeightProjection =
  | { kind: 'no-goal'; text: string; action: 'set-goal' }
  /** No date: too few weigh-ins for a rate, or a rate that is not clear. */
  | { kind: 'no-rate'; text: string }
  | { kind: 'reached'; text: string }
  /** The latest weigh-in is at the target, but the current weight is not there yet. */
  | { kind: 'latest-at-target'; text: string }
  | {
      kind: 'on-track';
      text: string;
      /** The date the rate itself gives. */
      date: string;
      daysFromToday: number;
      /**
       * Set when the rate's uncertainty moves the date by more than two weeks, and then the text
       * gives this span instead of one date. `latest` is null when the slow end is over 2 years out.
       */
      range: { earliest: string; latest: string | null } | null;
    }
  /** The line crosses the target on or before today, but the last weigh-in has not got there. */
  | { kind: 'due'; text: string }
  | { kind: 'flat'; text: string }
  | { kind: 'away'; text: string }
  | { kind: 'far'; text: string };

export interface WeightGoalProgress {
  kg: number;
  startKg: number | null;
  startDate: string | null;
  /** Distance from the current weight (`WeightInfo.currentKg`) to the target, never negative. */
  toGoKg: number;
  /** 0 to 1 of the way from the start to the target, by the current weight; null without a starting weight. */
  progress: number | null;
  /** The current weight is at the target, or past it in the direction it was set. */
  reached: boolean;
}

export interface TargetsSuggestion {
  /** The weight the current targets were set at. */
  fromKg: number;
  /** The current weight (`WeightInfo.currentKg`), to 0.1 kg: the weight to recalculate the targets for. */
  toKg: number;
  changeKg: number;
  /** What the targets would be at the current weight. */
  targets: Targets;
  /** New calorie target minus the current calorie goal. */
  calorieChange: number;
  text: string;
}

export interface WeightInfo {
  /** Weigh-ins in the period, oldest first. Gaps are real: there is no point for a day without a weigh-in. */
  points: WeightChartPoint[];
  /**
   * The straight line the rate comes from, from the first to the last weigh-in of the period.
   * Null when there is no fit (fewer than 3 weigh-ins, or under 7 days), and always in the 7-day
   * view. It is drawn whether or not the rate is clear: it is the fit, not a claim.
   */
  line: { from: WeightLineEnd; to: WeightLineEnd } | null;
  chart: {
    /** Vertical range that fits the points, the line and, when it is close enough, the target. */
    yMin: number;
    yMax: number;
    /** The target weight for the dashed line, or null. */
    goalKg: number | null;
    /** Set when the target is too far away to draw without flattening the data. */
    goalOffChart: 'above' | 'below' | null;
  };
  weighIns: number;
  first: WeighIn;
  latest: WeighIn;
  /** Latest minus first weigh-in in the period, as logged; null with a single weigh-in. */
  rawChangeKg: number | null;
  /**
   * The weight now, whatever period is selected (see `currentWeightKg`). Goal progress, "reached"
   * and the recalculation suggestion are measured from this, not from one weigh-in.
   */
  currentKg: number;
  /**
   * The period's rate. In the 7-day view it is never ready: a week is too short, so the reason
   * either sends the owner to 30 days (`action: 'longer-period'`) or, when the last 30 days have
   * no rate either, says what to log.
   */
  rate: Card<WeightRate>;
  /** 7-day view only, and only with 2 weigh-ins in each of the two weeks; otherwise null. */
  weekAverages: WeekAverages | null;
  goal: WeightGoalProgress | null;
  /** The date for the target. In the 7-day view it comes from the last 30 days, and its text says so. */
  projection: WeightProjection;
  /** Set when the current weight is 2 kg or more from the weight the targets were worked out at. */
  recalc: TargetsSuggestion | null;
}
export type WeightCard = Card<WeightInfo>;

export interface CalorieBar {
  date: string;
  dayIndex: number;
  /** Null when nothing was logged: draw a gap, not a zero. */
  calories: number | null;
  /** Calorie goal plus calories burned in workouts logged that day. */
  budget: number;
  status: DayStatus;
  /** False for a logged day that does not count toward averages: too little on it, or today, which is not over. */
  complete: boolean;
  isToday: boolean;
}

export interface CaloriesInfo {
  goal: number;
  /** One bar per day of the period, oldest first. */
  bars: CalorieBar[];
  /** A round number above every bar and the goal, for the chart's scale. */
  chartMax: number;
  /** Average intake on full days, and how many of them it is over. Not ready with fewer than 3. */
  average: Card<{ kcal: number; vsGoal: number; days: number }>;
  /**
   * The mean budget (goal plus logged workouts) over the same full days, rounded. Days are judged
   * against their budget, the average against the bare goal: this is what joins the two. Null
   * until the average is ready.
   */
  averageBudget: number | null;
  /**
   * "Your budget averaged 2,054 kcal with workouts, so you were 43 under it." A second line for
   * under the average. Null unless workouts move the average budget 25 kcal or more from the goal.
   */
  budgetText: string | null;
  loggedDays: number;
  /** Days that could have been logged: from the first logged day on, without today until it has an entry. */
  countedDays: number;
  periodDays: number;
  /** Full days: enough logged, and over. Today is never one. */
  completeDays: number;
  /**
   * There is an average, but full days are under 60% of `countedDays`: it stands on a minority of
   * the days, so the headline leads with the day count instead of the figure.
   */
  lowCoverage: boolean;
  /** Complete days at or under budget. */
  withinBudgetDays: number;
  /** Logged days over budget, today included once it is over. */
  overBudgetDays: number;
  /** Logged days before today left out of the average for having too little on them. */
  leftOutDays: number;
  /** Today has entries. It is never in the averages: it counts from tomorrow. */
  todayPending: boolean;
  /** Says how many days were left out, that today is not counted yet, and what the budget here leaves out; null with nothing to say. */
  note: string | null;
}
export type CaloriesCard = Card<CaloriesInfo>;

/**
 * One row of "Week by week": 7 days, counted back from today, so every row is a whole week and
 * rows can be compared. Each figure is null when the block has too little behind it.
 */
export interface WeekBlock {
  /** First and last day of the block, both included. The newest block ends today. */
  from: string;
  to: string;
  /** Days of the block on or after the first day anything was logged: 7, or fewer in the block the app was first used in. */
  daysInUse: number;
  /** Full days in the block. Today is never one, so the newest block has 6 at the most. */
  completeDays: number;
  /** Average intake on the block's full days, in kcal a day. Null with fewer than 3: say "too few full days". */
  averageKcal: number | null;
  weighIns: number;
  /** The mean of the block's weigh-ins, to 0.1 kg. Null with fewer than 2. */
  averageKg: number | null;
  /** The block's only weigh-in, when it has exactly one: show it as one weigh-in, not as an average. Otherwise null. */
  singleKg: number | null;
  workouts: number;
  /** Minutes of exercise in the block. */
  minutes: number;
}

/** A span of two figures, smaller first. */
export interface Span {
  min: number;
  max: number;
}

export interface MaintenanceInfo {
  /** The middle of the range, to the nearest 50: show it as "About 2,450 kcal a day", never alone. */
  kcal: number;
  /**
   * What the weigh-ins support: average intake minus (rate plus and minus 2 standard errors)
   * x 7,700, each end to the nearest 50 and kept inside 1,000 to 6,000. Never more than 600 apart.
   */
  low: number;
  high: number;
  /** "Likely between 2,250 and 2,650 kcal", to go under the figure. */
  rangeText: string;
  averageIntake: number;
  /** The slope the estimate is built on, in kg a week, whether or not it is clear enough to state as a rate. */
  kgPerWeek: number;
  /**
   * Whether that slope may be stated as a rate (see `WeightRate`). Quote `kgPerWeek` in a sentence
   * only when `rateClear`; say the weight held steady when `rateSteady`; otherwise name no rate.
   */
  rateClear: boolean;
  rateSteady: boolean;
  /** What the targets calculator in Settings gives (BMR times activity), to the nearest 10; null without a profile. */
  formulaKcal: number | null;
  /** Where the calculator's figure falls against the range. */
  formulaVsRange: 'below' | 'within' | 'above' | null;
  formulaText: string | null;
  goal: {
    kcal: number;
    /** A deficit when the goal is under the whole range, a surplus when over it, maintenance when inside it. */
    kind: 'deficit' | 'surplus' | 'maintenance';
    /** How far the goal is from the range, in kcal a day: to its near end and to its far end. Null inside the range. */
    gapKcal: Span | null;
    /** The weekly weight change that gap works out to, in kg, to one decimal. Null inside the range. */
    gapKgPerWeek: Span | null;
    text: string;
  };
  basis: { weighIns: number; completeDays: number; windowDays: number; fromDate: string; toDate: string };
  /** From the width of the range: good up to 200 kcal, fair up to 400, rough up to 600. */
  confidence: 'rough' | 'fair' | 'good';
  /** Labels the figure as an estimate, says what it is built on, and that food left unlogged makes it too low. */
  note: string;
}
export type MaintenanceCard = Card<MaintenanceInfo>;

export interface MacroAverage {
  /** Grams a day on complete days. */
  average: number;
  goal: number;
  /** Average over goal; null when the goal is 0. */
  ratio: number | null;
}

export interface MacrosInfo {
  /** Complete days the averages are built on. */
  days: number;
  protein: MacroAverage;
  carbs: MacroAverage;
  fat: MacroAverage;
  /** Complete days that reached 90% of the protein goal. */
  proteinDays: number;
  /** Share of calories from each macro (4, 4 and 9 kcal a gram); null when nothing was eaten. */
  split: { protein: number; carbs: number; fat: number } | null;
  note: string | null;
}
export type MacrosCard = Card<MacrosInfo>;

export interface ActivityTotal {
  activity: Activity;
  label: string;
  /** Icon name from the exercise catalogue. */
  icon: string;
  minutes: number;
  workouts: number;
  calories: number;
  /** Share of the period's exercise minutes, 0 to 1. */
  share: number;
}

export interface ExerciseInfo {
  workouts: number;
  minutes: number;
  calories: number;
  /** Days with at least one workout. */
  activeDays: number;
  /** Workouts and minutes a week on average. Null until the app has been in use for 7 days: before that there is no week to average. */
  perWeek: { workouts: number; minutes: number } | null;
  /** The top activities by time, at most three. */
  top: ActivityTotal[];
  /** One row per day of the period, oldest first. */
  daily: { date: string; dayIndex: number; minutes: number; calories: number; workouts: number }[];
}
export type ExerciseCard = Card<ExerciseInfo>;

export interface Streak {
  /** Logged days in a row up to today, or up to yesterday while today is still empty. */
  current: number;
  best: number;
  loggedToday: boolean;
}

export interface CalendarDay {
  date: string;
  dayIndex: number;
  dayOfMonth: number;
  /** 0 for Monday, 6 for Sunday. */
  weekday: number;
  status: DayStatus;
  /**
   * A full day. A cell with `status: 'within'` that is not complete (too little logged, or today,
   * which is still open) is "Not a full day": the calendar's fourth look, not a day within budget.
   */
  complete: boolean;
  isToday: boolean;
}

/** A weekday that is most often not logged in full. */
export interface SkippedWeekday {
  /** 0 for Monday, 6 for Sunday. */
  weekday: number;
  /** "Saturday" */
  label: string;
  /** Days of this weekday before today, since the first log, with nothing or too little logged. */
  missed: number;
  /** Days of this weekday before today, since the first log. */
  of: number;
}

export interface ConsistencyInfo {
  /** One cell per day of the period, oldest first. */
  calendar: CalendarDay[];
  /** Empty cells before the first day in a Monday-first grid. */
  leadingBlanks: number;
  loggedDays: number;
  countedDays: number;
  /** Full days at or under budget. The same count as the Calories card's `withinBudgetDays`. */
  withinDays: number;
  /** Logged days over budget, today included once it is over. */
  overDays: number;
  /** Logged days before today with too little on them to be a full day, and not over budget. */
  partialDays: number;
  /** Today has entries and is not over budget: it is not counted as within or as partial, because the day is not over. */
  todayOpen: boolean;
  /**
   * The counts as one sentence that adds up: `loggedDays` is `withinDays + overDays + partialDays`,
   * plus today when `todayOpen`. "Logged 14 of 30 days: 8 full days within budget, 1 over,
   * 4 with too little logged. Today is still open."
   */
  text: string;
  /**
   * The weekday or two most often not logged in full, when that happened on at least half of 3 or
   * more of them; null when there is no such pattern. Those days are missing from every average.
   */
  skipped: { weekdays: SkippedWeekday[]; text: string } | null;
  streak: Streak;
}
export type ConsistencyCard = Card<ConsistencyInfo>;

export interface WeekSplit {
  weekday: { average: number; days: number };
  weekend: { average: number; days: number };
  /** Weekend average minus weekday average. */
  difference: number;
  /**
   * The difference is big enough to state: at least 100 kcal, and at least 2 standard errors
   * (2 x sd x sqrt(1/weekdays + 1/weekends), sd being the sample standard deviation of the full days).
   */
  clear: boolean;
  /**
   * "Weekends average 2,550 kcal a day, 550 more than weekdays." when clear; "Weekdays and
   * weekends look about the same so far, around 2,000 kcal a day." under 100 kcal apart;
   * otherwise "Too few days to tell weekdays and weekends apart yet."
   */
  text: string;
}

export interface MealShare {
  meal: Meal;
  label: string;
  /** Calories a day from this meal, on complete days. */
  average: number;
  /** Share of calories, 0 to 1. */
  share: number;
}

export interface WeekdayAverage {
  /** 0 for Monday, 6 for Sunday. */
  weekday: number;
  label: string;
  /** Null when no complete day fell on this weekday. */
  average: number | null;
  /** Full days on this weekday. Under 3 (`WEEKDAY_MIN_DAYS`) the average is too thin to draw as a bar: draw a stub. */
  days: number;
}

export interface HighestDay {
  /** The weekday with the highest average among those with 3 full days. 0 for Monday. */
  weekday: number;
  label: string;
  average: number;
  /** Its average minus the average of all full days. */
  aboveAverage: number;
  /**
   * It really is higher: at least 150 kcal above the average, and at least 2 standard errors
   * (2 x sd / sqrt(its days)). Highlight its bar only when this is true.
   */
  standsOut: boolean;
  /** "Saturday is your highest day, 2,600 kcal on average." or "No day of the week stands out yet." */
  text: string;
}

export interface PatternsInfo {
  /** Complete days the patterns are built on. */
  days: number;
  /** Not ready in the 7-day view (a week holds 2 weekend days), with `action: 'longer-period'`. */
  weekSplit: Card<WeekSplit>;
  /** Breakfast, lunch, dinner and snacks, in that order. */
  meals: MealShare[];
  /** Monday to Sunday. Draw the chart only when `highestDay` is ready. */
  byWeekday: WeekdayAverage[];
  /** Not ready in the 7-day view, with `action: 'longer-period'`. */
  highestDay: Card<HighestDay>;
}
export type PatternsCard = Card<PatternsInfo>;

export interface TopFood {
  name: string;
  calories: number;
  /** Times logged. */
  count: number;
  /** Share of all calories logged in the period, 0 to 1. */
  share: number;
}
export type TopFoodsCard = Card<{ foods: TopFood[]; totalCalories: number }>;

export interface DaySummary extends Macros {
  date: string;
  /** Has at least one food entry. A day can also be listed for a workout or a weigh-in alone. */
  logged: boolean;
  count: number;
  complete: boolean;
  burned: number;
  budget: number;
  over: boolean;
  workouts: number;
  exerciseMinutes: number;
  weightKg: number | null;
}
/** Days in the period with food, a workout or a weigh-in, newest first. */
export type EveryDayCard = Card<{ days: DaySummary[] }>;

export interface Insights {
  period: {
    days: InsightPeriod;
    from: string;
    to: string;
    /**
     * Where the charts start: `from`, or the first day anything was logged (food, a workout or a
     * weigh-in) when that is later, but never fewer than 7 days before today. Every `dayIndex`
     * still counts from `from`: take `daysBetween(from, chartFrom)` off it to place a mark.
     */
    chartFrom: string;
    /** Days from `chartFrom` to `to`, both included: 7 at the least, `days` at the most. */
    chartDays: number;
    /** The first day with a food entry, ever. */
    firstLoggedDate: string | null;
    /** What a day needs to count as complete, for explaining "full day". */
    completeDayKcal: number;
  };
  /** True when the period holds no food, workout or weigh-in at all. */
  empty: boolean;
  /**
   * Today already has its weigh-in. There is one a day, so nothing more can be logged today: the
   * weight and maintenance reasons then carry no 'log-weight' action and end "Weigh in again tomorrow."
   */
  weighedToday: boolean;
  headline: HeadlineCard;
  weight: WeightCard;
  calories: CaloriesCard;
  /**
   * "Week by week": 7-day blocks counted back from today, newest first. 4 for 30 days and 12 for
   * 90, less any that end before the first day anything was logged. Empty when that leaves fewer
   * than two, because one block is not a comparison: always in the 7-day view, and in a first
   * week of use. Show no card then.
   */
  weeks: WeekBlock[];
  maintenance: MaintenanceCard;
  macros: MacrosCard;
  exercise: ExerciseCard;
  consistency: ConsistencyCard;
  patterns: PatternsCard;
  topFoods: TopFoodsCard;
  everyDay: EveryDayCard;
}

// ---------------------------------------------------------------- small helpers

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const amount = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
const mean = (values: readonly number[]): number => (values.length ? sum(values) / values.length : 0);
const round = (n: number, decimals = 0): number => {
  const f = 10 ** decimals;
  const r = Math.round(n * f) / f;
  return r === 0 ? 0 : r; // never -0
};
/** Sample standard deviation (over n - 1); 0 with fewer than two values. */
const sampleSd = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(sum(values.map((v) => (v - m) * (v - m))) / (values.length - 1));
};
const roundTo10 = (n: number): number => round(n / 10) * 10;
const roundTo = (n: number, step: number): number => round(n / step) * step;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const kg1 = (n: number): string => Math.abs(roundKg(n)).toFixed(1);

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A date no finer than the data behind it: "early December", "mid January 2027". */
function roughDate(date: string, today: string): string {
  const d = dateKeyToDate(date);
  const part = d.getDate() <= 10 ? 'early' : d.getDate() <= 20 ? 'mid' : 'late';
  const year = d.getFullYear() === dateKeyToDate(today).getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${part} ${MONTH_NAMES[d.getMonth()]}${year}`;
}

/**
 * Two rough dates joined by "and": "mid December and early January 2027". What they share is said
 * once: "mid January and early February 2027", "early and late December".
 */
function roughSpan(from: string, to: string, today: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  // Measured against itself, the first date never carries a year.
  const a = roughDate(from, sameYear ? from : today);
  const b = roughDate(to, today);
  return sameMonth ? `${a.split(' ')[0]} and ${b}` : `${a} and ${b}`;
}

/** Valid weigh-ins up to and including `today`, oldest first, one per day (the last one given wins). */
function cleanWeighIns(weights: readonly WeighIn[], today: string): WeighIn[] {
  const byDate = new Map<string, number>();
  for (const w of weights) {
    if (!isDateKey(w.date) || w.date > today || !isValidWeightKg(w.kg)) continue;
    byDate.set(w.date, w.kg);
  }
  return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([date, kg]) => ({ date, kg }));
}

// ---------------------------------------------------------------- weight rate and current weight

export interface LineFit {
  slope: number;
  intercept: number;
  /** Sum of the squared distances of the x values from their mean. */
  sxx: number;
  /** How far the points sit from the line: sqrt(sum of squared residuals / (n - 2)). 0 with two points. */
  residualSd: number;
}

/** Least-squares line through the points; null with fewer than two distinct x values. */
export function linearFit(points: readonly { x: number; y: number }[]): LineFit | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) * (p.x - mx);
    sxy += (p.x - mx) * (p.y - my);
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let rss = 0;
  for (const p of points) {
    const residual = p.y - (intercept + slope * p.x);
    rss += residual * residual;
  }
  const residualSd = n > 2 ? Math.sqrt(rss / (n - 2)) : 0;
  return Number.isFinite(slope) && Number.isFinite(intercept) && Number.isFinite(residualSd) ? { slope, intercept, sxx, residualSd } : null;
}

interface RateFit {
  /** kg per day. */
  slope: number;
  /** One standard error of the slope, in kg per day. */
  se: number;
  /** The same slope per week, to two decimals: the figure that is shown. */
  kgPerWeek: number;
  /** See `WeightRate`: exactly one of clear, steady, or neither. */
  clear: boolean;
  steady: boolean;
  direction: Direction | null;
  /** The fitted weight on the day of the first weigh-in. */
  startKg: number;
  /** The fitted weight on the day of the last weigh-in. */
  fittedKg: number;
  first: WeighIn;
  last: WeighIn;
  weighIns: number;
  /** Days between the first and last weigh-in. */
  between: number;
}

type RateResult = { ready: true; fit: RateFit } | NotReady;

const HOW_FAST = 'how fast your weight is changing';

function fitRate(weighIns: readonly WeighIn[]): RateResult {
  const n = weighIns.length;
  if (n === 0) {
    return notReady(
      `Log your weight on ${RATE_MIN_WEIGH_INS} days over at least a week to see how fast it is changing.`,
      'log-weight',
      progressOf('Weigh-ins', 0, RATE_MIN_WEIGH_INS),
    );
  }
  const first = weighIns[0];
  const last = weighIns[n - 1];
  const between = daysBetween(first.date, last.date);
  if (n < RATE_MIN_WEIGH_INS) {
    const more = RATE_MIN_WEIGH_INS - n;
    return notReady(
      `Log ${plural(more, 'more weigh-in')} to see ${HOW_FAST}. That takes ${RATE_MIN_WEIGH_INS} weigh-ins over at least a week.`,
      'log-weight',
      progressOf('Weigh-ins', n, RATE_MIN_WEIGH_INS),
    );
  }
  if (between + 1 < RATE_MIN_SPAN_DAYS) {
    return notReady(
      `Your weigh-ins cover ${plural(between + 1, 'day')}. Keep weighing in until they cover a week to see ${HOW_FAST}.`,
      'log-weight',
      progressOf('Days covered', between + 1, RATE_MIN_SPAN_DAYS),
    );
  }
  const fit = linearFit(weighIns.map((w) => ({ x: daysBetween(first.date, w.date), y: w.kg })));
  if (!fit) return notReady(`Keep weighing in to see ${HOW_FAST}.`, 'log-weight');

  // How sure the slope is. Weigh-ins that happen to sit on a line are still only good to the
  // scale and a day's water, so the scatter is never taken to be smaller than that.
  const se = Math.max(fit.residualSd, WEIGH_IN_NOISE_KG) / Math.sqrt(fit.sxx);
  const kgPerWeek = round(fit.slope * 7, 2);
  // A slope can be sure and still too small to print: under 0.05 kg a week, or not yet 0.1 kg in all.
  const tooSmall = Math.abs(kgPerWeek) < FLAT_KG_PER_WEEK || Math.abs(roundKg(fit.slope * between)) < 0.1;
  const clear = Math.abs(fit.slope) >= RATE_CLEAR_SE * se && !tooSmall;
  const steady = !clear && RATE_CLEAR_SE * se * 7 <= STEADY_WITHIN_KG_PER_WEEK;
  return {
    ready: true,
    fit: {
      slope: fit.slope,
      se,
      kgPerWeek,
      clear,
      steady,
      direction: clear ? (fit.slope < 0 ? 'down' : 'up') : steady ? 'flat' : null,
      startKg: fit.intercept,
      fittedKg: fit.intercept + fit.slope * between,
      first,
      last,
      weighIns: n,
      between,
    },
  };
}

function rateCard(result: RateResult, weightGoalKg: number | null): Card<WeightRate> {
  if (!result.ready) return result;
  const { fit } = result;
  const toGo = weightGoalKg !== null && isValidWeightKg(weightGoalKg) ? weightGoalKg - fit.fittedKg : null;
  const changeKg = round(fit.slope * fit.between, 2);
  const days = fit.between + 1;
  const down = fit.direction === 'down';
  return {
    ready: true,
    kgPerWeek: fit.kgPerWeek,
    seKgPerWeek: round(fit.se * 7, 3),
    clear: fit.clear,
    steady: fit.steady,
    nowKg: roundKg(fit.fittedKg),
    changeKg,
    days,
    weighIns: fit.weighIns,
    fromDate: fit.first.date,
    toDate: fit.last.date,
    direction: fit.direction,
    towardGoal: !fit.clear || toGo === null || Math.abs(toGo) < 0.05 ? null : (toGo < 0) === (fit.slope < 0),
    changeText: fit.clear
      ? `${down ? 'Down' : 'Up'} ${kg1(changeKg)} kg in ${days} days`
      : fit.steady
        ? `Steady over ${days} days`
        : 'Your weigh-ins vary from day to day by more than the change so far',
    rateText: fit.clear
      ? `${down ? 'Losing' : 'Gaining'} ${Math.abs(fit.kgPerWeek).toFixed(1)} kg a week`
      : fit.steady
        ? 'Holding steady'
        : days >= UNCLEAR_LONG_DAYS
          ? 'No clear direction yet'
          : 'Too early to say',
  };
}

/**
 * Rate of change: the least-squares slope of the weigh-ins, in kg per week. It is worked out
 * from 3 weigh-ins spanning 7 calendar days, but it is `clear`, and may be shown, only when it
 * is at least twice its standard error. Expects one window's weigh-ins, oldest first.
 */
export function weightRate(weighIns: readonly WeighIn[], weightGoalKg: number | null = null): Card<WeightRate> {
  return rateCard(fitRate(weighIns), weightGoalKg);
}

/** The weigh-ins of the last 30 days, the window the period-independent figures are built on. */
const lastMonth = (weighIns: readonly WeighIn[], today: string): WeighIn[] => {
  const since = addDays(today, -(RATE_WINDOW_DAYS - 1));
  return weighIns.filter((w) => w.date >= since);
};

interface CurrentWeight {
  /** To 0.1 kg. */
  kg: number;
  /** What it rests on: the fitted line, the mean of a few close weigh-ins, or one reading. */
  basis: 'fit' | 'average' | 'latest';
}

/** Expects clean weigh-ins, oldest first. */
function currentWeight(weighIns: readonly WeighIn[], today: string): CurrentWeight | null {
  if (weighIns.length === 0) return null;
  const month = fitRate(lastMonth(weighIns, today));
  if (month.ready) return { kg: roundKg(month.fit.fittedKg), basis: 'fit' };
  const latest = weighIns[weighIns.length - 1];
  const since = addDays(latest.date, -CURRENT_WEIGHT_WITHIN_DAYS);
  const close = weighIns.filter((w) => w.date >= since).slice(-CURRENT_WEIGHT_MAX_WEIGH_INS);
  if (close.length > 1) return { kg: roundKg(mean(close.map((w) => w.kg))), basis: 'average' };
  return { kg: roundKg(latest.kg), basis: 'latest' };
}

/**
 * The weight now, with as much of the day-to-day swing taken out as the weigh-ins allow. It does
 * not depend on the period selected on Progress, so "reached", the distance to the target and the
 * recalculation suggestion read the same on every period and in Settings.
 *
 * In order: the fitted weight on the day of the latest weigh-in, from the line through the last
 * 30 days' weigh-ins, when they give one (3 weigh-ins over 7 days); else the mean of the latest
 * up to 3 weigh-ins made no more than 10 days before the latest one; else the latest weigh-in.
 * To 0.1 kg. Null before the first weigh-in. Takes the weigh-ins as stored, in any order.
 */
export function currentWeightKg(weights: readonly WeighIn[], today: string): number | null {
  return currentWeight(cleanWeighIns(weights, today), today)?.kg ?? null;
}

/** The 7-day view's comparison: this week's average weigh-in against the week before. Expects clean weigh-ins. */
function weekAverages(weighIns: readonly WeighIn[], today: string): WeekAverages | null {
  const weekStart = addDays(today, -6);
  const previousStart = addDays(today, -13);
  const thisWeek = weighIns.filter((w) => w.date >= weekStart).map((w) => w.kg);
  const lastWeek = weighIns.filter((w) => w.date >= previousStart && w.date < weekStart).map((w) => w.kg);
  if (thisWeek.length < WEEK_AVERAGE_MIN_WEIGH_INS || lastWeek.length < WEEK_AVERAGE_MIN_WEIGH_INS) return null;
  const now = roundKg(mean(thisWeek));
  const before = roundKg(mean(lastWeek));
  // From the two averages as shown, so the sentence adds up.
  const changeKg = round(now - before, 1);
  const versus = changeKg === 0 ? 'the same as' : `${kg1(changeKg)} kg ${changeKg < 0 ? 'lower' : 'higher'} than`;
  return {
    thisWeek: { average: now, weighIns: thisWeek.length },
    lastWeek: { average: before, weighIns: lastWeek.length },
    changeKg,
    text: `Your weigh-ins averaged ${formatKg(now)} over the last 7 days, ${versus} the 7 days before (${thisWeek.length} and ${plural(lastWeek.length, 'weigh-in')}).`,
  };
}

// ---------------------------------------------------------------- streaks and Today

/** Current and best run of logged days. Days after `today` are ignored. */
export function loggingStreak(loggedDates: readonly string[], today: string): Streak {
  const days = [...new Set(loggedDates.filter((d) => isDateKey(d) && d <= today))].sort();
  const logged = new Set(days);
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const d of days) {
    run = previous !== null && daysBetween(previous, d) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    previous = d;
  }
  const loggedToday = logged.has(today);
  // An empty today does not break the streak until the day is over.
  let cursor = loggedToday ? today : addDays(today, -1);
  let current = 0;
  while (logged.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, best, loggedToday };
}

export interface TodaySummary {
  streak: Streak;
  weight: {
    /** The most recent weigh-in, or null before the first one. */
    latest: WeighIn | null;
    /** True when the latest weigh-in is today's. */
    weighedToday: boolean;
    /**
     * How fast the weight is changing: the same least-squares rate as Progress, over the last
     * 30 days. Show the arrow and `kgPerWeek` only when it is ready and `clear`, "Steady" when it
     * is `steady`, and no rate at all otherwise.
     */
    rate: Card<WeightRate>;
  };
}

/** What Today's Streak and Weight tiles show. */
export function buildTodaySummary(input: { today: string; loggedDates: readonly string[]; weights: readonly WeighIn[] }): TodaySummary {
  const weighIns = cleanWeighIns(input.weights, input.today);
  const latest = weighIns.length ? weighIns[weighIns.length - 1] : null;
  return {
    streak: loggingStreak(input.loggedDates, input.today),
    weight: {
      latest,
      weighedToday: latest?.date === input.today,
      rate: weightRate(lastMonth(weighIns, input.today)),
    },
  };
}

// ---------------------------------------------------------------- the period, day by day

interface Day {
  date: string;
  index: number;
  weekday: number;
  isToday: boolean;
  /** On or after the first day anything was logged. */
  tracked: boolean;
  logged: boolean;
  /** Has at least the calories a full day needs, whether or not the day is over. */
  enough: boolean;
  /** A full day: enough logged, and over. Never today. */
  complete: boolean;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  count: number;
  burned: number;
  minutes: number;
  workouts: number;
  budget: number;
  over: boolean;
  weightKg: number | null;
}

const statusOf = (d: Day): DayStatus => (!d.tracked ? 'before' : !d.logged ? 'none' : d.over ? 'over' : 'within');

function buildDays(input: InsightsInput, from: string, firstLogged: string | null, weighIns: readonly WeighIn[]): Day[] {
  const goal = amount(input.goals.calories);
  const threshold = completeDayThreshold(goal);
  const food = new Map<string, DayFoodTotal>();
  for (const t of input.dayTotals) if (t.date >= from && t.date <= input.today) food.set(t.date, t);
  const burned = new Map<string, { calories: number; minutes: number; count: number }>();
  for (const x of input.exercises) {
    if (x.date < from || x.date > input.today) continue;
    const day = burned.get(x.date) ?? { calories: 0, minutes: 0, count: 0 };
    day.calories += amount(x.calories);
    day.minutes += amount(x.minutes);
    day.count += 1;
    burned.set(x.date, day);
  }
  const weight = new Map(weighIns.map((w) => [w.date, w.kg]));

  const days: Day[] = [];
  for (let index = 0; index < input.days; index++) {
    const date = addDays(from, index);
    const f = food.get(date);
    const x = burned.get(date);
    const logged = !!f && f.count > 0;
    const calories = logged ? amount(f.calories) : 0;
    const budget = goal + (x?.calories ?? 0);
    const isToday = date === input.today;
    const enough = logged && calories >= threshold;
    days.push({
      date,
      index,
      weekday: weekdayIndex(date),
      isToday,
      tracked: firstLogged !== null && date >= firstLogged,
      logged,
      enough,
      // Today is never a full day: counted from 800 kcal, an afternoon's worth pulled every average
      // down until dinner was logged. It counts from tomorrow.
      complete: enough && !isToday,
      calories,
      protein: logged ? amount(f.protein) : 0,
      carbs: logged ? amount(f.carbs) : 0,
      fat: logged ? amount(f.fat) : 0,
      count: logged ? f.count : 0,
      burned: x?.calories ?? 0,
      minutes: x?.minutes ?? 0,
      workouts: x?.count ?? 0,
      budget,
      // Rounded as Today and the day view round. The budget here is the goal plus logged workouts
      // only: when Today also adds activity from other apps (`countsOtherActivity`), a day can be
      // over here and under there, and the Calories note says so.
      over: logged && Math.round(budget - calories) < 0,
      weightKg: weight.get(date) ?? null,
    });
  }
  return days;
}

/** "2 days with very little logged were left out of the averages." */
function leftOutNote(leftOut: number, todayPending: boolean): string | null {
  if (leftOut === 0) return todayPending ? 'Today is not counted in the averages yet.' : null;
  const base = `${plural(leftOut, 'day')} with very little logged ${leftOut === 1 ? 'was' : 'were'} left out of the averages`;
  return todayPending ? `${base}, and today is not counted yet.` : `${base}.`;
}

/** Added to the Calories note when Today's budget counts activity that Progress cannot see. */
const OTHER_ACTIVITY_NOTE =
  'Progress counts the workouts you logged, not activity from other apps, so a day can read differently here than on Today or its own page.';

/**
 * Why an average is not shown yet, for a period with food logged on fewer than 3 full days.
 * `shows` opens the sentence that says what is waiting: "An average shows".
 */
function tooFewFullDays(logged: readonly Day[], goal: number, shows: string): NotReady {
  const full = logged.filter((d) => d.complete).length;
  const today = logged.find((d) => d.isToday);
  if (full > 0) {
    return notReady(
      `${plural(full, 'full day')} logged so far${today ? ', not counting today' : ''}. ${shows} after ${AVERAGE_MIN_DAYS}.`,
      'log-food',
      progressOf('Full days', full, AVERAGE_MIN_DAYS),
    );
  }
  const none = progressOf('Full days', 0, AVERAGE_MIN_DAYS);
  const after = `${shows} after ${AVERAGE_MIN_DAYS} full days.`;
  // An evening with the day's meals in: nothing is missing, the day is just not over.
  if (today?.enough) return notReady(`Today counts once the day is over. ${after}`, undefined, none);
  const fullDay = `A full day has at least ${formatKcal(completeDayThreshold(goal))} kcal logged`;
  // Nothing before today: say what a full day is without calling a first morning short.
  if (today && logged.length === 1) return notReady(`${after} ${fullDay}, and today counts once it is over.`, 'log-food', none);
  return notReady(`No day has enough logged yet. ${fullDay}. ${after}`, 'log-food', none);
}

// ---------------------------------------------------------------- weight card

function weightDomain(values: readonly number[], goalKg: number | null): WeightInfo['chart'] {
  const floorHalf = (n: number) => Math.floor(n * 2) / 2;
  const ceilHalf = (n: number) => Math.ceil(n * 2) / 2;
  let yMin = floorHalf(Math.min(...values) - 0.3);
  let yMax = ceilHalf(Math.max(...values) + 0.3);
  if (yMax - yMin < 2) {
    const mid = (yMin + yMax) / 2;
    yMin = floorHalf(mid - 1);
    yMax = ceilHalf(mid + 1);
  }
  let goalOffChart: 'above' | 'below' | null = null;
  if (goalKg !== null) {
    // Stretch to include the target only while the data keeps at least a third of the height.
    const span = yMax - yMin;
    if (goalKg < yMin) {
      const stretched = floorHalf(goalKg - 0.3);
      if (yMax - stretched <= span * 3) yMin = stretched;
      else goalOffChart = 'below';
    } else if (goalKg > yMax) {
      const stretched = ceilHalf(goalKg + 0.3);
      if (stretched - yMin <= span * 3) yMax = stretched;
      else goalOffChart = 'above';
    }
  }
  return { yMin, yMax, goalKg, goalOffChart };
}

/** The fits the weight card is built on. They differ only in the 7-day view. */
interface WeightFits {
  /** Behind the card's rate, the chart's line and the headline. In the 7-day view: not ready, with the reason to show. */
  shown: RateResult;
  /** Behind the date for the target. In the 7-day view: the last 30 days. */
  forDate: RateResult;
  /** How many days `forDate` covers when that is more than the period shown, so the sentence can say so. */
  borrowedDays: number | null;
}

function buildProjection(
  goalKg: number | null,
  startKg: number | null,
  latest: WeighIn,
  current: CurrentWeight,
  fits: WeightFits,
  today: string,
): { projection: WeightProjection; reached: boolean } {
  if (goalKg === null) {
    return { projection: { kind: 'no-goal', text: 'Set a target weight to see when you could reach it.', action: 'set-goal' }, reached: false };
  }
  const target = formatKg(goalKg);
  // Which way the target lies: from the starting weight when there is one, else from now.
  const wanted = startKg !== null && Math.abs(goalKg - startKg) >= 0.05 ? Math.sign(goalKg - startKg) : 0;
  const at = (kg: number): boolean =>
    wanted < 0 ? kg <= goalKg + 0.05 : wanted > 0 ? kg >= goalKg - 0.05 : Math.abs(kg - goalKg) <= 0.05;
  if (at(current.kg)) {
    // With nothing but one weigh-in behind it, it is a reading, not yet a weight.
    const text = current.basis === 'latest' ? `Your latest weigh-in is at your ${target} target.` : `You are at your ${target} target.`;
    return { projection: { kind: 'reached', text }, reached: true };
  }
  if (at(latest.kg)) {
    // One low (or high) morning is not the target reached, but it is worth saying.
    return {
      projection: { kind: 'latest-at-target', text: `Your latest weigh-in is at your ${target} target. A few more will confirm it.` },
      reached: false,
    };
  }
  const rate = fits.forDate;
  if (!rate.ready) {
    return { projection: { kind: 'no-rate', text: `A date for ${target} shows once there are enough weigh-ins to see ${HOW_FAST}.` }, reached: false };
  }
  const say = (sentence: string): string =>
    fits.borrowedDays === null ? sentence : `From the last ${fits.borrowedDays} days: ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;

  const { slope, se, fittedKg, last } = rate.fit;
  if (rate.fit.steady) {
    return { projection: { kind: 'flat', text: say(`Your weight is holding steady, so there is no date for ${target} yet.`) }, reached: false };
  }
  if (!rate.fit.clear) {
    return { projection: { kind: 'no-rate', text: say(`A date for ${target} shows once your weigh-ins show a clear direction.`) }, reached: false };
  }
  const toGo = goalKg - fittedKg;
  const toward = Math.sign(toGo) === Math.sign(slope);
  if (Math.abs(toGo) >= 0.05 && !toward) {
    return { projection: { kind: 'away', text: say(`Your weight is moving away from ${target} at the moment.`) }, reached: false };
  }
  const distance = toward ? Math.abs(toGo) : 0;
  const speed = Math.abs(slope);
  const sinceLast = daysBetween(last.date, today);
  /** Days from today until the line reaches the target, at a given kg a day. */
  const daysAt = (perDay: number): number => Math.ceil(distance / perDay) - sinceLast;
  const daysFromToday = daysAt(speed);
  if (daysFromToday > PROJECTION_MAX_DAYS) {
    return { projection: { kind: 'far', text: say(`At this rate ${target} is more than 2 years away.`) }, reached: false };
  }
  if (daysFromToday <= 0) {
    return { projection: { kind: 'due', text: say(`At this rate you should be at ${target} about now. Weigh in to check.`) }, reached: false };
  }
  const date = addDays(today, daysFromToday);

  // The rate is only known to within 2 standard errors, and so is the date. A clear rate is at
  // least that far from zero, so the slow end can be no progress at all: then there is no late date.
  const margin = RATE_CLEAR_SE * se;
  const soonest = Math.max(1, daysAt(speed + margin));
  const slowest = speed - margin > 0 ? daysAt(speed - margin) : Infinity;
  if (slowest - soonest <= PROJECTION_SPAN_MIN_DAYS) {
    return {
      projection: {
        kind: 'on-track',
        text: say(`At this rate you reach ${target} around ${formatShortDate(date, dateKeyToDate(today))}.`),
        date,
        daysFromToday,
        range: null,
      },
      reached: false,
    };
  }
  const earliest = addDays(today, soonest);
  if (!Number.isFinite(slowest) || slowest > PROJECTION_MAX_DAYS) {
    return {
      projection: {
        kind: 'on-track',
        text: say(`At this rate you reach ${target} in ${roughDate(earliest, today)} at the earliest.`),
        date,
        daysFromToday,
        range: { earliest, latest: null },
      },
      reached: false,
    };
  }
  const latestDate = addDays(today, slowest);
  return {
    projection: {
      kind: 'on-track',
      text: say(`At this rate you reach ${target} between ${roughSpan(earliest, latestDate, today)}.`),
      date,
      daysFromToday,
      range: { earliest, latest: latestDate },
    },
    reached: false,
  };
}

/** `weighIns` is every clean weigh-in on record, oldest first: the card reaches back past the period. */
function buildWeight(input: InsightsInput, from: string, weighIns: readonly WeighIn[], fits: WeightFits): WeightCard {
  if (weighIns.length === 0) return notReady('Log your weight to see where it is heading.', 'log-weight');
  const inPeriod = weighIns.filter((w) => w.date >= from);
  if (inPeriod.length === 0) {
    const ago = daysBetween(weighIns[weighIns.length - 1].date, input.today);
    return notReady(`Log your weight to see where it is heading now. Your last weigh-in was ${ago} days ago.`, 'log-weight');
  }
  const points: WeightChartPoint[] = inPeriod.map((w) => ({ date: w.date, dayIndex: daysBetween(from, w.date), kg: w.kg }));
  const first = inPeriod[0];
  const latest = inPeriod[inPeriod.length - 1];
  const current: CurrentWeight = currentWeight(weighIns, input.today) ?? { kg: roundKg(latest.kg), basis: 'latest' };
  const goalKg = input.weightGoalKg !== null && isValidWeightKg(input.weightGoalKg) ? input.weightGoalKg : null;
  const startKg = input.goalStartWeightKg !== null && isValidWeightKg(input.goalStartWeightKg) ? input.goalStartWeightKg : null;

  const { projection, reached } = buildProjection(goalKg, startKg, latest, current, fits, input.today);

  let goal: WeightGoalProgress | null = null;
  if (goalKg !== null) {
    const whole = startKg !== null ? startKg - goalKg : 0;
    goal = {
      kg: goalKg,
      startKg,
      startDate: startKg !== null ? input.goalStartDate : null,
      toGoKg: reached ? 0 : round(Math.abs(current.kg - goalKg), 1),
      progress: startKg !== null && Math.abs(whole) >= 0.05 ? round(Math.min(1, Math.max(0, (startKg - current.kg) / whole)), 3) : null,
      reached,
    };
  }

  let recalc: TargetsSuggestion | null = null;
  const setAt = input.targetsWeightKg;
  if (input.profile && setAt !== null && isValidWeightKg(setAt) && Math.abs(current.kg - setAt) >= RECALC_AFTER_KG - 1e-9) {
    // `toKg` is written into the profile when the suggestion is taken, so it is the rounded figure.
    const targets = calculateTargets({ ...input.profile, weightKg: current.kg });
    recalc = {
      fromKg: setAt,
      toKg: current.kg,
      changeKg: round(current.kg - setAt, 1),
      targets,
      calorieChange: Math.round(targets.calories - amount(input.goals.calories)),
      text: `Your weight has moved ${kg1(current.kg - setAt)} kg since your targets were set at ${formatKg(setAt)}. Recalculate them for ${formatKg(current.kg)}.`,
    };
  }

  const shown = fits.shown;
  const line: WeightInfo['line'] = shown.ready
    ? {
        from: { date: shown.fit.first.date, dayIndex: daysBetween(from, shown.fit.first.date), kg: round(shown.fit.startKg, 2) },
        to: { date: shown.fit.last.date, dayIndex: daysBetween(from, shown.fit.last.date), kg: round(shown.fit.fittedKg, 2) },
      }
    : null;

  return {
    ready: true,
    points,
    line,
    chart: weightDomain([...points.map((p) => p.kg), ...(line ? [line.from.kg, line.to.kg] : [])], goalKg),
    weighIns: points.length,
    first,
    latest,
    rawChangeKg: points.length > 1 ? round(latest.kg - first.kg, 1) : null,
    currentKg: current.kg,
    rate: rateCard(shown, goalKg),
    weekAverages: input.days < RATE_WINDOW_DAYS ? weekAverages(weighIns, input.today) : null,
    goal,
    projection,
    recalc,
  };
}

// ---------------------------------------------------------------- calories, macros, maintenance

/** `lastLogged` is the latest day with a food entry, ever. */
function buildCalories(input: InsightsInput, days: readonly Day[], counted: number, lastLogged: string | null): CaloriesCard {
  const logged = days.filter((d) => d.logged);
  if (logged.length === 0) {
    // Lead with the invitation. A gap is said as how long ago, so a new install is not told it missed a month.
    const invite = 'Log your meals to see your average against your goal.';
    const ago = lastLogged === null ? 0 : daysBetween(lastLogged, input.today);
    return notReady(ago > 0 ? `${invite} Your last logged meal was ${plural(ago, 'day')} ago.` : invite, 'log-food');
  }
  const goal = amount(input.goals.calories);
  const complete = logged.filter((d) => d.complete);
  const todayPending = logged.some((d) => d.isToday);
  const leftOut = logged.filter((d) => !d.complete && !d.isToday).length;
  // One or two days are days, not an average.
  const ready = complete.length >= AVERAGE_MIN_DAYS;
  const kcal = Math.round(mean(complete.map((d) => d.calories)));
  // Days are judged against their budget and the average against the bare goal. With workouts
  // logged the two differ, so the average budget over the same days is given beside it.
  const averageBudget = ready ? Math.round(mean(complete.map((d) => d.budget))) : null;
  let budgetText: string | null = null;
  if (averageBudget !== null && Math.abs(averageBudget - goal) >= BUDGET_NOTE_MIN_KCAL) {
    const gap = kcal - averageBudget;
    const versus = gap === 0 ? 'right on it' : `${formatKcal(Math.abs(gap))} ${gap < 0 ? 'under' : 'over'} it`;
    budgetText = `Your budget averaged ${formatKcal(averageBudget)} kcal with workouts, so you were ${versus}.`;
  }
  const notes = [leftOutNote(leftOut, todayPending), input.countsOtherActivity ? OTHER_ACTIVITY_NOTE : null].filter((n): n is string => n !== null);
  const tallest = Math.max(goal * 1.2, ...days.map((d) => d.calories), ...logged.map((d) => d.budget));
  return {
    ready: true,
    goal,
    bars: days.map((d) => ({
      date: d.date,
      dayIndex: d.index,
      calories: d.logged ? Math.round(d.calories) : null,
      budget: Math.round(d.budget),
      status: statusOf(d),
      complete: d.complete,
      isToday: d.isToday,
    })),
    chartMax: Math.max(100, Math.ceil(tallest / 100) * 100),
    average: ready
      ? { ready: true, kcal, vsGoal: Math.round(kcal - goal), days: complete.length }
      : tooFewFullDays(logged, goal, 'An average shows'),
    averageBudget,
    budgetText,
    loggedDays: logged.length,
    countedDays: counted,
    periodDays: input.days,
    completeDays: complete.length,
    lowCoverage: ready && complete.length < LOW_COVERAGE_SHARE * counted - 1e-9,
    withinBudgetDays: complete.filter((d) => !d.over).length,
    overBudgetDays: logged.filter((d) => d.over).length,
    leftOutDays: leftOut,
    todayPending,
    note: notes.length ? notes.join(' ') : null,
  };
}

function buildMacros(input: InsightsInput, days: readonly Day[]): MacrosCard {
  const logged = days.filter((d) => d.logged);
  const complete = logged.filter((d) => d.complete);
  if (logged.length === 0) return notReady('Log your meals to see your protein, carbs and fat against your goals.', 'log-food');
  if (complete.length < AVERAGE_MIN_DAYS) {
    return tooFewFullDays(logged, amount(input.goals.calories), 'Your protein, carbs and fat averages show');
  }
  const macro = (key: 'protein' | 'carbs' | 'fat'): MacroAverage => {
    const average = round(mean(complete.map((d) => d[key])), 1);
    const goal = amount(input.goals[key]);
    return { average, goal, ratio: goal > 0 ? round(average / goal, 3) : null };
  };
  const protein = macro('protein');
  const carbs = macro('carbs');
  const fat = macro('fat');
  const kcal = { protein: protein.average * 4, carbs: carbs.average * 4, fat: fat.average * 9 };
  const total = kcal.protein + kcal.carbs + kcal.fat;
  const todayPending = logged.some((d) => d.isToday);
  return {
    ready: true,
    days: complete.length,
    protein,
    carbs,
    fat,
    proteinDays: protein.goal > 0 ? complete.filter((d) => d.protein >= PROTEIN_HIT_SHARE * protein.goal).length : 0,
    split: total > 0 ? { protein: round(kcal.protein / total, 3), carbs: round(kcal.carbs / total, 3), fat: round(kcal.fat / total, 3) } : null,
    note: leftOutNote(logged.filter((d) => !d.complete && !d.isToday).length, todayPending),
  };
}

function buildMaintenance(input: InsightsInput, days: readonly Day[], weighIns: readonly WeighIn[], rate: RateResult): MaintenanceCard {
  if (input.days < MAINTENANCE_MIN_DAYS_BETWEEN + 1) {
    return notReady('This needs at least two weeks of weigh-ins and meals.', 'longer-period');
  }
  const n = weighIns.length;
  if (n < MAINTENANCE_MIN_WEIGH_INS) {
    const more = MAINTENANCE_MIN_WEIGH_INS - n;
    return notReady(
      `Log ${plural(more, 'more weigh-in')} to estimate what you burn. That takes ${MAINTENANCE_MIN_WEIGH_INS} weigh-ins over at least 2 weeks, with your meals logged in between.`,
      'log-weight',
      progressOf('Weigh-ins', n, MAINTENANCE_MIN_WEIGH_INS),
    );
  }
  const first = weighIns[0];
  const last = weighIns[n - 1];
  const between = daysBetween(first.date, last.date);
  if (between < MAINTENANCE_MIN_DAYS_BETWEEN || !rate.ready) {
    return notReady(
      `Your weigh-ins are ${plural(between, 'day')} apart. Keep weighing in until the first and the last are at least 14 days apart.`,
      'log-weight',
      between < MAINTENANCE_MIN_DAYS_BETWEEN ? progressOf('Days apart', between, MAINTENANCE_MIN_DAYS_BETWEEN) : undefined,
    );
  }
  // Today is not over, so it cannot be a full day yet: with a weigh-in this morning it is left
  // out of the days that could have been, or the share would drop by a day every morning.
  const window = days.filter((d) => d.date >= first.date && d.date <= last.date && !d.isToday);
  const complete = window.filter((d) => d.complete);
  const needed = Math.ceil(MAINTENANCE_MIN_COMPLETE_SHARE * window.length - 1e-9);
  if (complete.length < needed) {
    return notReady(
      `Meals were fully logged on ${complete.length} of the ${window.length} days between your weigh-ins. This needs at least ${needed}.`,
      'log-food',
      progressOf('Full days', complete.length, needed),
    );
  }
  const intake = mean(complete.map((d) => d.calories));
  // The slope is used whether or not it is clear enough to state as a rate: a flat weight that is
  // well pinned down is a good estimate. How well it is pinned down decides the range below.
  const { slope, se } = rate.fit;
  const estimate = intake - slope * KCAL_PER_KG;
  if (!(estimate >= MAINTENANCE_PLAUSIBLE.min && estimate <= MAINTENANCE_PLAUSIBLE.max)) {
    return notReady('Your weigh-ins and your food log do not line up well enough for an estimate yet. Keep logging both for another week or two.');
  }

  // The rate is known to within 2 standard errors, so the estimate is a range, not one number.
  const margin = RATE_CLEAR_SE * se * KCAL_PER_KG;
  const plausible = (kcal: number): number => Math.min(MAINTENANCE_PLAUSIBLE.max, Math.max(MAINTENANCE_PLAUSIBLE.min, kcal));
  const rawLow = roundTo(estimate - margin, MAINTENANCE_ROUND_KCAL);
  const rawHigh = roundTo(estimate + margin, MAINTENANCE_ROUND_KCAL);
  const width = rawHigh - rawLow;
  const low = plausible(rawLow);
  const high = plausible(rawHigh);
  if (width > MAINTENANCE_MAX_WIDTH_KCAL) {
    return notReady(
      `Your weigh-ins put this between ${formatKcal(low)} and ${formatKcal(high)} kcal a day, too wide to be useful yet. More weigh-ins narrow it.`,
      'log-weight',
    );
  }
  const kcal = roundTo(estimate, MAINTENANCE_ROUND_KCAL);

  // What the goal means is read off the range: a deficit or a surplus only when the goal is outside it.
  const goalKcal = amount(input.goals.calories);
  const kind = goalKcal < low ? 'deficit' : goalKcal > high ? 'surplus' : 'maintenance';
  const gapKcal: Span | null =
    kind === 'deficit'
      ? { min: Math.round(low - goalKcal), max: Math.round(high - goalKcal) }
      : kind === 'surplus'
        ? { min: Math.round(goalKcal - high), max: Math.round(goalKcal - low) }
        : null;
  const perWeek = (gap: number): number => round((gap * 7) / KCAL_PER_KG, 1);
  const gapKgPerWeek: Span | null = gapKcal ? { min: perWeek(gapKcal.min), max: perWeek(gapKcal.max) } : null;
  let goalText = `Your ${formatKcal(goalKcal)} kcal goal is close to what you burn.`;
  if (gapKcal && gapKgPerWeek) {
    const gap = gapKcal.min === gapKcal.max ? formatKcal(gapKcal.max) : `${formatKcal(gapKcal.min)} to ${formatKcal(gapKcal.max)}`;
    const weekly =
      gapKgPerWeek.max < 0.1
        ? ''
        : gapKgPerWeek.min === gapKgPerWeek.max
          ? `, about ${gapKgPerWeek.max.toFixed(1)} kg ${kind === 'deficit' ? 'lost' : 'gained'} a week`
          : gapKgPerWeek.min < 0.1
            ? `, up to ${gapKgPerWeek.max.toFixed(1)} kg ${kind === 'deficit' ? 'lost' : 'gained'} a week`
            : `, about ${gapKgPerWeek.min.toFixed(1)} to ${gapKgPerWeek.max.toFixed(1)} kg ${kind === 'deficit' ? 'lost' : 'gained'} a week`;
    goalText = `Your ${formatKcal(goalKcal)} kcal goal is ${gap} kcal ${kind === 'deficit' ? 'less' : 'more'} than you burn${weekly}.`;
  }

  // The calculator's figure is worked out now, from the profile and the latest weight.
  const formulaKcal = input.profile ? roundTo10(tdee(input.profile)) : null;
  const usable = formulaKcal !== null && Number.isFinite(formulaKcal) && formulaKcal > 0 ? formulaKcal : null;
  const formulaVsRange = usable === null ? null : usable < low ? 'below' : usable > high ? 'above' : 'within';
  const calculator = 'The targets calculator in Settings gives';
  const builtOn = 'for your age, height, weight and activity';
  const formulaText =
    usable === null || formulaVsRange === null
      ? null
      : formulaVsRange === 'within'
        ? `${calculator} about the same, ${formatKcal(usable)} kcal ${builtOn}.`
        : `${calculator} ${formatKcal(usable)} kcal ${builtOn}, ${formulaVsRange === 'above' ? 'more' : 'less'} than this range.`;

  const confidence = width <= MAINTENANCE_GOOD_WIDTH_KCAL ? 'good' : width <= MAINTENANCE_FAIR_WIDTH_KCAL ? 'fair' : 'rough';
  return {
    ready: true,
    kcal,
    low,
    high,
    rangeText: low === high ? `Likely within ${MAINTENANCE_ROUND_KCAL} kcal of that` : `Likely between ${formatKcal(low)} and ${formatKcal(high)} kcal`,
    averageIntake: Math.round(intake),
    kgPerWeek: round(slope * 7, 2),
    rateClear: rate.fit.clear,
    rateSteady: rate.fit.steady,
    formulaKcal: usable,
    formulaVsRange,
    formulaText,
    goal: { kcal: goalKcal, kind, gapKcal, gapKgPerWeek, text: goalText },
    basis: { weighIns: n, completeDays: complete.length, windowDays: window.length, fromDate: first.date, toDate: last.date },
    confidence,
    note:
      `${confidence === 'rough' ? 'A rough estimate' : 'An estimate'} from ${n} weigh-ins and ${plural(complete.length, 'full day')} of meals. ` +
      'It assumes everything you ate is logged. Anything missed makes the real figure higher. More weigh-ins narrow the range.',
  };
}

// ---------------------------------------------------------------- exercise

function buildExercise(input: InsightsInput, days: readonly Day[], from: string, startOfUse: string | null): ExerciseCard {
  const workouts = input.exercises
    .filter((x) => x.date >= from && x.date <= input.today)
    .map((x) => ({ ...x, activity: isActivity(x.activity) ? x.activity : ('other' as const) }));
  if (workouts.length === 0) {
    return notReady('Log a workout to see your minutes, calories burned and top activities.', 'log-exercise');
  }
  const minutes = sum(workouts.map((x) => amount(x.minutes)));
  const calories = sum(workouts.map((x) => amount(x.calories)));
  // A weekly average over the part of the period the app was in use. Under a week of use there is
  // no week to average: three days in, "2 workouts a week" would be the three days stretched.
  const inUse = startOfUse !== null && startOfUse > from ? daysBetween(startOfUse, input.today) + 1 : input.days;
  const weeks = inUse / 7;

  const byActivity = new Map<Activity, { minutes: number; workouts: number; calories: number }>();
  for (const x of workouts) {
    const t = byActivity.get(x.activity) ?? { minutes: 0, workouts: 0, calories: 0 };
    t.minutes += amount(x.minutes);
    t.workouts += 1;
    t.calories += amount(x.calories);
    byActivity.set(x.activity, t);
  }
  const top = [...byActivity.entries()]
    .sort(
      ([a, ta], [b, tb]) =>
        tb.minutes - ta.minutes || tb.workouts - ta.workouts || ACTIVITY_ORDER.indexOf(a) - ACTIVITY_ORDER.indexOf(b),
    )
    .slice(0, 3)
    .map(([activity, t]) => ({
      activity,
      label: ACTIVITIES[activity].label,
      icon: ACTIVITIES[activity].icon,
      minutes: Math.round(t.minutes),
      workouts: t.workouts,
      calories: Math.round(t.calories),
      share: minutes > 0 ? round(t.minutes / minutes, 3) : 0,
    }));

  return {
    ready: true,
    workouts: workouts.length,
    minutes: Math.round(minutes),
    calories: Math.round(calories),
    activeDays: days.filter((d) => d.workouts > 0).length,
    perWeek: inUse >= EXERCISE_WEEKLY_MIN_DAYS ? { workouts: round(workouts.length / weeks, 1), minutes: Math.round(minutes / weeks) } : null,
    top,
    daily: days.map((d) => ({
      date: d.date,
      dayIndex: d.index,
      minutes: Math.round(d.minutes),
      calories: Math.round(d.burned),
      workouts: d.workouts,
    })),
  };
}

// ---------------------------------------------------------------- consistency, patterns, foods, days

/** "Saturdays", "Saturdays and Sundays". */
const listOf = (names: readonly string[]): string => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? ''));

/**
 * The weekday that most often has nothing, or too little, logged. Those days are missing from
 * every average, so a habit of skipping Saturdays is worth saying: it is why the averages run low.
 */
function skippedWeekdays(days: readonly Day[]): ConsistencyInfo['skipped'] {
  const tally: SkippedWeekday[] = WEEKDAY_NAMES.map((label, weekday) => ({ weekday, label, missed: 0, of: 0 }));
  for (const d of days) {
    // Days before the first log were never missed, and today is not over.
    if (!d.tracked || d.isToday) continue;
    tally[d.weekday].of += 1;
    if (!d.complete) tally[d.weekday].missed += 1;
  }
  const often = tally.filter((t) => t.of >= SKIPPED_WEEKDAY_MIN_DAYS && t.missed >= SKIPPED_WEEKDAY_MIN_SHARE * t.of);
  if (often.length === 0) return null;
  // The largest share missed. Cross-multiplied, so 3 of 4 and 4 of 5 compare exactly.
  const top = often.reduce((a, b) => (b.missed * a.of > a.missed * b.of ? b : a));
  const weekdays = often.filter((t) => t.missed * top.of === top.missed * t.of);
  // Three weekdays or more level at the top is not the habit of a day; the headline's day count covers that.
  if (weekdays.length > 2) return null;
  const counts = listOf(weekdays.map((t) => `${t.missed} of ${t.of}`));
  return {
    weekdays,
    text: `${listOf(weekdays.map((t) => `${t.label}s`))} are most often not logged in full (${counts}), so your averages leave those days out.`,
  };
}

function buildConsistency(days: readonly Day[], counted: number, streak: Streak, firstLogged: string | null): ConsistencyCard {
  if (firstLogged === null) return notReady('Log a meal to start your calendar and your streak.', 'log-food');
  const logged = days.filter((d) => d.logged);
  // Every logged day is exactly one of these, so the sentence adds up. "Within budget" is said of
  // full days only: a coffee-only day is under budget, but it is not a day kept within it.
  const within = logged.filter((d) => d.complete && !d.over).length;
  const over = logged.filter((d) => d.over).length;
  const partial = logged.filter((d) => !d.complete && !d.over && !d.isToday).length;
  const todayOpen = logged.some((d) => d.isToday && !d.over);
  const counts =
    within + over + partial > 0
      ? [`${plural(within, 'full day')} within budget`, `${over} over`, ...(partial > 0 ? [`${partial} with too little logged`] : [])]
      : [];
  const text = `Logged ${logged.length} of ${plural(counted, 'day')}${counts.length ? `: ${counts.join(', ')}` : ''}.${todayOpen ? ' Today is still open.' : ''}`;
  return {
    ready: true,
    calendar: days.map((d) => ({
      date: d.date,
      dayIndex: d.index,
      dayOfMonth: dateKeyToDate(d.date).getDate(),
      weekday: d.weekday,
      status: statusOf(d),
      complete: d.complete,
      isToday: d.isToday,
    })),
    leadingBlanks: days.length ? days[0].weekday : 0,
    loggedDays: logged.length,
    countedDays: counted,
    withinDays: within,
    overDays: over,
    partialDays: partial,
    todayOpen,
    text,
    skipped: skippedWeekdays(days),
    streak,
  };
}

function buildPatterns(input: InsightsInput, days: readonly Day[], from: string): PatternsCard {
  const complete = days.filter((d) => d.complete);
  if (complete.length < PATTERNS_MIN_DAYS) {
    return notReady(
      complete.length === 0
        ? `Log ${PATTERNS_MIN_DAYS} full days of meals to see your patterns.`
        : `Log ${plural(PATTERNS_MIN_DAYS - complete.length, 'more full day')} of meals to see your patterns. You have ${complete.length} so far.`,
      'log-food',
      progressOf('Full days', complete.length, PATTERNS_MIN_DAYS),
    );
  }
  const overall = mean(complete.map((d) => d.calories));
  // How much one full day differs from the next. A gap between two groups of days is stated only
  // when it is at least twice the standard error this gives it: with about four of each weekday in
  // a month, one heavy dinner is otherwise enough to name a "highest day".
  const sd = sampleSd(complete.map((d) => d.calories));
  // A week holds one of each weekday and two weekend days: no amount of logging makes it enough.
  const tooShort = input.days < HIGHEST_DAY_MIN_DAYS;

  const weekdays = complete.filter((d) => d.weekday < 5);
  const weekends = complete.filter((d) => d.weekday >= 5);
  let weekSplit: PatternsInfo['weekSplit'];
  if (tooShort) {
    weekSplit = notReady(`A week is too short to compare weekdays with weekends. That takes ${WEEK_SPLIT_MIN_DAYS} full days of each.`, 'longer-period');
  } else if (weekdays.length < WEEK_SPLIT_MIN_DAYS || weekends.length < WEEK_SPLIT_MIN_DAYS) {
    weekSplit = notReady(
      `Comparing weekdays with weekends needs ${WEEK_SPLIT_MIN_DAYS} full days of each. So far you have ${plural(weekdays.length, 'weekday')} and ${plural(weekends.length, 'weekend day')}.`,
      'log-food',
      // The one further from its 3; weekends, with two a week, nearly always.
      weekends.length < WEEK_SPLIT_MIN_DAYS && weekends.length <= weekdays.length
        ? progressOf('Weekend days', weekends.length, WEEK_SPLIT_MIN_DAYS)
        : progressOf('Weekdays', weekdays.length, WEEK_SPLIT_MIN_DAYS),
    );
  } else {
    const wd = Math.round(mean(weekdays.map((d) => d.calories)));
    const we = Math.round(mean(weekends.map((d) => d.calories)));
    const difference = we - wd;
    const needed = Math.max(WEEK_SPLIT_MIN_KCAL, PATTERN_CLEAR_SE * sd * Math.sqrt(1 / weekdays.length + 1 / weekends.length));
    const clear = Math.abs(difference) >= needed;
    weekSplit = {
      ready: true,
      weekday: { average: wd, days: weekdays.length },
      weekend: { average: we, days: weekends.length },
      difference,
      clear,
      text: clear
        ? `Weekends average ${formatKcal(we)} kcal a day, ${formatKcal(Math.abs(difference))} ${difference > 0 ? 'more' : 'less'} than weekdays.`
        : // A large gap that is not proven is not "about the same": say only that it is too early.
          Math.abs(difference) < WEEK_SPLIT_MIN_KCAL
          ? `Weekdays and weekends look about the same so far, around ${formatKcal(overall)} kcal a day.`
          : 'Too few days to tell weekdays and weekends apart yet.',
    };
  }

  const completeDates = new Set(complete.map((d) => d.date));
  const mealTotals: Record<Meal, number> = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
  for (const m of input.mealCalories) {
    if (m.date < from || !completeDates.has(m.date) || !(m.meal in mealTotals)) continue;
    mealTotals[m.meal] += amount(m.calories);
  }
  const mealSum = sum(MEALS.map((m) => mealTotals[m]));
  const meals: MealShare[] = MEALS.map((meal) => ({
    meal,
    label: MEAL_LABELS[meal],
    average: Math.round(mealTotals[meal] / complete.length),
    share: mealSum > 0 ? round(mealTotals[meal] / mealSum, 3) : 0,
  }));

  const byWeekday: WeekdayAverage[] = WEEKDAY_NAMES.map((label, weekday) => {
    const on = complete.filter((d) => d.weekday === weekday);
    return { weekday, label, average: on.length ? Math.round(mean(on.map((d) => d.calories))) : null, days: on.length };
  });
  let highestDay: PatternsInfo['highestDay'];
  const eligible = byWeekday.filter((w): w is WeekdayAverage & { average: number } => w.average !== null && w.days >= WEEKDAY_MIN_DAYS);
  if (tooShort) {
    highestDay = notReady('One week is too short to pick out a day of the week.', 'longer-period');
  } else if (complete.length < HIGHEST_DAY_MIN_DAYS) {
    highestDay = notReady(
      `Your highest day of the week shows after ${HIGHEST_DAY_MIN_DAYS} full days. You have ${complete.length} so far.`,
      'log-food',
      progressOf('Full days', complete.length, HIGHEST_DAY_MIN_DAYS),
    );
  } else if (eligible.length < 2) {
    highestDay = notReady(
      `Your highest day of the week shows once two weekdays have ${WEEKDAY_MIN_DAYS} full days each.`,
      'log-food',
      progressOf(`Weekdays with ${WEEKDAY_MIN_DAYS} full days`, eligible.length, 2),
    );
  } else {
    const top = eligible.reduce((best, w) => (w.average > best.average ? w : best));
    const above = Math.round(top.average - overall);
    const standsOut = above >= Math.max(HIGHEST_DAY_MIN_KCAL, (PATTERN_CLEAR_SE * sd) / Math.sqrt(top.days));
    highestDay = {
      ready: true,
      weekday: top.weekday,
      label: top.label,
      average: top.average,
      aboveAverage: above,
      standsOut,
      text: standsOut ? `${top.label} is your highest day, ${formatKcal(top.average)} kcal on average.` : 'No day of the week stands out yet.',
    };
  }

  return { ready: true, days: complete.length, weekSplit, meals, byWeekday, highestDay };
}

function buildTopFoods(input: InsightsInput, days: readonly Day[]): TopFoodsCard {
  const total = sum(days.map((d) => d.calories));
  const merged = new Map<string, { name: string; calories: number; count: number }>();
  for (const f of input.topFoods) {
    const name = typeof f.name === 'string' ? f.name.trim().replace(/\s+/g, ' ') : '';
    if (!name) continue;
    const key = name.toLowerCase();
    const have = merged.get(key);
    const count = Math.max(1, Math.round(amount(f.count)));
    if (have) {
      have.calories += amount(f.calories);
      have.count += count;
    } else merged.set(key, { name, calories: amount(f.calories), count });
  }
  const foods = [...merged.values()]
    .filter((f) => f.calories > 0)
    .sort((a, b) => b.calories - a.calories || b.count - a.count || (a.name < b.name ? -1 : 1))
    .slice(0, 5);
  if (foods.length === 0) {
    return notReady(`Log your meals to see which foods add up the most over ${input.days} days.`, 'log-food');
  }
  // The foods can only be a share of what was eaten; guard against totals that disagree.
  const whole = Math.max(total, sum(foods.map((f) => f.calories)));
  return {
    ready: true,
    foods: foods.map((f) => ({ name: f.name, calories: Math.round(f.calories), count: f.count, share: round(f.calories / whole, 3) })),
    totalCalories: Math.round(total),
  };
}

function buildEveryDay(days: readonly Day[]): EveryDayCard {
  const withData = days.filter((d) => d.logged || d.workouts > 0 || d.weightKg !== null);
  if (withData.length === 0) return notReady('Days you log show up here, each with its calories, workouts and weight.', 'log-food');
  return {
    ready: true,
    days: [...withData].reverse().map((d) => ({
      date: d.date,
      logged: d.logged,
      count: d.count,
      complete: d.complete,
      calories: Math.round(d.calories),
      protein: Math.round(d.protein),
      carbs: Math.round(d.carbs),
      fat: Math.round(d.fat),
      burned: Math.round(d.burned),
      budget: Math.round(d.budget),
      over: d.over,
      workouts: d.workouts,
      exerciseMinutes: Math.round(d.minutes),
      weightKg: d.weightKg,
    })),
  };
}

// ---------------------------------------------------------------- week by week

/**
 * The period as whole weeks: 7-day blocks counted back from today, newest first. Calendar weeks
 * would leave a part-week at each end, and a part-week's workouts cannot be compared with a whole
 * one's. The few oldest days of the period that do not fill a block are left out.
 */
function buildWeeks(input: InsightsInput, days: readonly Day[], startOfUse: string | null): WeekBlock[] {
  const count = Math.floor(input.days / WEEK_BLOCK_DAYS);
  if (startOfUse === null) return [];
  const blocks: WeekBlock[] = [];
  for (let i = 0; i < count; i++) {
    const end = days.length - i * WEEK_BLOCK_DAYS;
    const block = days.slice(end - WEEK_BLOCK_DAYS, end);
    const daysInUse = block.filter((d) => d.date >= startOfUse).length;
    // Before the first day anything was logged there is no week to show.
    if (daysInUse === 0) break;
    const full = block.filter((d) => d.complete);
    const kgs = block.map((d) => d.weightKg).filter((kg): kg is number => kg !== null);
    const averageKg = kgs.length >= WEEK_AVERAGE_MIN_WEIGH_INS ? roundKg(mean(kgs)) : null;
    blocks.push({
      from: block[0].date,
      to: block[block.length - 1].date,
      daysInUse,
      completeDays: full.length,
      averageKcal: full.length >= AVERAGE_MIN_DAYS ? Math.round(mean(full.map((d) => d.calories))) : null,
      weighIns: kgs.length,
      averageKg,
      singleKg: averageKg === null && kgs.length === 1 ? roundKg(kgs[0]) : null,
      workouts: sum(block.map((d) => d.workouts)),
      minutes: Math.round(sum(block.map((d) => d.minutes))),
    });
  }
  // One block is not a comparison: none in the 7-day view, and none in a first week of use.
  return blocks.length < 2 ? [] : blocks;
}

// ---------------------------------------------------------------- headline

/** `everUsed`: something was logged at some point, in the period or before it. */
function buildHeadline(input: InsightsInput, weight: WeightCard, calories: CaloriesCard, exercise: ExerciseCard, everUsed: boolean): HeadlineCard {
  const average = calories.ready && calories.average.ready ? calories.average : null;
  // On a minority of the days, "on average" would pass for the whole period: name the days instead.
  const low = calories.ready && calories.lowCoverage;
  const intake = average
    ? `${formatKcal(average.kcal)} kcal a day ${low ? `on the ${average.days} days you logged in full` : 'on average'}`
    : null;

  // The weight half is said only when the weigh-ins support it: a clear change, or a weight that is
  // pinned down as steady. Anything less falls through to the calories sentence.
  if (weight.ready && weight.rate.ready && (weight.rate.clear || weight.rate.steady)) {
    const rate = weight.rate;
    const moved = rate.clear ? rate.changeText : `Weight steady over ${rate.days} days`;
    return {
      ready: true,
      text: intake ? `${moved}, eating ${intake}.` : `${moved}.`,
      tone: !rate.clear ? 'steady' : rate.direction === 'down' ? 'down' : 'up',
    };
  }
  if (calories.ready && average && low) {
    // The most important fact of a patchy period is how little of it the average stands on.
    return {
      ready: true,
      text: `Meals fully logged on ${calories.completeDays} of ${plural(calories.countedDays, 'day')}. On those days you ate ${formatKcal(average.kcal)} kcal on average.`,
      tone: 'neutral',
    };
  }
  if (average) {
    const versus =
      Math.abs(average.vsGoal) < 25
        ? 'right on your goal'
        : `${formatKcal(Math.abs(average.vsGoal))} ${average.vsGoal < 0 ? 'under' : 'over'} your goal`;
    return { ready: true, text: `Eating ${formatKcal(average.kcal)} kcal a day on average, ${versus}.`, tone: 'neutral' };
  }
  if (calories.ready) {
    const waiting = `An average shows after ${AVERAGE_MIN_DAYS}`;
    const text =
      calories.countedDays <= 1
        ? `Your first day is logged. ${waiting} full days.`
        : calories.completeDays > 0
          ? `${plural(calories.completeDays, 'full day')} of meals logged so far. ${waiting}.`
          : `Meals logged on ${plural(calories.loggedDays, 'day')}. ${waiting} full days.`;
    return { ready: true, text, tone: 'neutral' };
  }
  if (weight.ready) {
    return { ready: true, text: `Your latest weigh-in is ${formatKg(weight.latest.kg)}.`, tone: 'neutral' };
  }
  if (exercise.ready) {
    return {
      ready: true,
      text: `${plural(exercise.workouts, 'workout')} and ${formatMinutes(exercise.minutes)} of exercise in the last ${input.days} days.`,
      tone: 'neutral',
    };
  }
  // Lead with the invitation. On a new install there are no last 30 days to look back on.
  const invite = 'Log a meal, a workout or your weight to see how';
  return notReady(everUsed ? `${invite} the last ${input.days} days went.` : `${invite} you are doing.`, 'log-food');
}

// ---------------------------------------------------------------- what an empty Progress tab will show

/** One line of the "What shows up here" tile. */
export interface Unlock {
  /** The card it is about, for its icon. */
  card: 'weight' | 'calories' | 'maintenance' | 'patterns';
  /** What will show: "Where your weight is heading". */
  title: string;
  /** What it takes: "After 3 weigh-ins over at least a week". */
  needs: string;
}

/** "a week", "2 weeks", "10 days". */
const spanOf = (days: number): string => (days % 7 !== 0 ? `${days} days` : days === 7 ? 'a week' : `${days / 7} weeks`);

/**
 * What Progress shows once there is enough logged, and what each takes, in card order. For the
 * one tile an empty app shows in place of a not-ready tile per card. Every number in it is one
 * of the constants above, so a threshold is never typed into a component.
 */
export function whatShowsUpHere(): Unlock[] {
  return [
    {
      card: 'weight',
      title: 'Where your weight is heading',
      needs: `After ${RATE_MIN_WEIGH_INS} weigh-ins over at least ${spanOf(RATE_MIN_SPAN_DAYS)}`,
    },
    { card: 'calories', title: 'Your average calories against your goal', needs: `After ${AVERAGE_MIN_DAYS} full days of meals` },
    {
      card: 'maintenance',
      title: 'What you actually burn',
      needs: `After ${MAINTENANCE_MIN_WEIGH_INS} or more weigh-ins over at least ${spanOf(MAINTENANCE_MIN_DAYS_BETWEEN)}, with your meals logged in between`,
    },
    { card: 'patterns', title: 'Patterns in your week', needs: `After ${PATTERNS_MIN_DAYS} full days of meals` },
  ];
}

// ---------------------------------------------------------------- entry point

/** Build every Progress card for a period of 7, 30 or 90 days ending today. */
export function buildInsights(input: InsightsInput): Insights {
  const { today } = input;
  const from = addDays(today, -(input.days - 1));

  const loggedDates = input.loggedDates.filter((d) => isDateKey(d) && d <= today);
  const foodDates = input.dayTotals.filter((t) => t.count > 0 && isDateKey(t.date) && t.date <= today).map((t) => t.date);
  const allLogged = [...loggedDates, ...foodDates];
  const firstLogged = allLogged.length ? allLogged.reduce((a, b) => (a < b ? a : b)) : null;

  const allWeighIns = cleanWeighIns(input.weights, today);
  const periodWeighIns = allWeighIns.filter((w) => w.date >= from);
  const weighedToday = allWeighIns.length > 0 && allWeighIns[allWeighIns.length - 1].date === today;
  // A week is too short to tell a real change from day-to-day swings, so the 7-day view fits no
  // rate of its own. It borrows the date from the last 30 days, and when those give a rate it
  // sends the owner there; when they do not, it says what to log, exactly as the 30-day view would.
  const weekView = input.days < RATE_WINDOW_DAYS;
  const monthRate = fitRate(lastMonth(allWeighIns, today));
  const rate: RateResult = !weekView
    ? input.days === RATE_WINDOW_DAYS
      ? monthRate
      : fitRate(periodWeighIns)
    : monthRate.ready
      ? notReady('A week is too short to tell a real change from day-to-day swings.', 'longer-period')
      : monthRate;
  const fits: WeightFits = { shown: rate, forDate: weekView ? monthRate : rate, borrowedDays: weekView ? RATE_WINDOW_DAYS : null };

  const days = buildDays(input, from, firstLogged, periodWeighIns);
  // Days that could have been logged: not before the first log, and not today while it is still empty.
  const counted = days.filter((d) => d.tracked && (!d.isToday || d.logged)).length;

  const firstExercise = input.firstExerciseDate && isDateKey(input.firstExerciseDate) ? input.firstExerciseDate : null;
  const starts = [firstLogged, firstExercise, allWeighIns.length ? allWeighIns[0].date : null].filter((d): d is string => d !== null);
  const startOfUse = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null;

  // There is one weigh-in a day. Once today has its own, "Log weight" could only reopen it, so the
  // reasons that ask for weigh-ins drop the button and say when the next one can be made.
  const afterToday = <T>(card: Card<T>): Card<T> =>
    !card.ready && card.action === 'log-weight' && weighedToday ? notReady(`${card.reason} Weigh in again tomorrow.`, undefined, card.progress) : card;
  const builtWeight = buildWeight(input, from, allWeighIns, fits);
  const weight: WeightCard = builtWeight.ready ? { ...builtWeight, rate: afterToday(builtWeight.rate) } : afterToday(builtWeight);
  const lastLogged = allLogged.length ? allLogged.reduce((a, b) => (a > b ? a : b)) : null;
  const calories = buildCalories(input, days, counted, lastLogged);
  const exercise = buildExercise(input, days, from, startOfUse);
  const everyDay = buildEveryDay(days);

  // Charts start where the data does, so the 90-day view is not two-thirds empty a month in.
  const latestChartStart = addDays(today, -(CHART_MIN_DAYS - 1));
  const chartFrom = startOfUse === null || startOfUse <= from ? from : startOfUse > latestChartStart ? latestChartStart : startOfUse;

  return {
    period: {
      days: input.days,
      from,
      to: today,
      chartFrom,
      chartDays: daysBetween(chartFrom, today) + 1,
      firstLoggedDate: firstLogged,
      completeDayKcal: Math.round(completeDayThreshold(input.goals.calories)),
    },
    empty: !everyDay.ready,
    weighedToday,
    headline: buildHeadline(input, weight, calories, exercise, startOfUse !== null),
    weight,
    calories,
    weeks: buildWeeks(input, days, startOfUse),
    maintenance: afterToday(buildMaintenance(input, days, periodWeighIns, rate)),
    macros: buildMacros(input, days),
    exercise,
    consistency: buildConsistency(days, counted, loggingStreak(allLogged, today), firstLogged),
    patterns: buildPatterns(input, days, from),
    topFoods: buildTopFoods(input, days),
    everyDay,
  };
}
