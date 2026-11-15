/**
 * "Heads up": the app speaking first. Every rule here looks at the owner's own logs for something
 * unusual (a day far from the usual, a sudden weigh-in, a missed day), something to act on (protein
 * running low, no workout lately, weight moving faster than the goal's pace), or something won (a
 * new best on a lift, a streak). Pure, so every rule and every sentence is tested.
 *
 * Each rule needs enough data to stand on and says nothing otherwise. Days are named ("Thursday"),
 * never "yesterday", so a sentence stays true when it arrives as the next morning's notification.
 */
import { addDays, dateKeyToDate, daysBetween } from './dates';
import { completeDayThreshold, loggingStreak, weightRate, type WeighIn } from './insights';
import { formatKcal, type GoalType } from './nutrition';
import type { Exercise, Macros } from './types';
import { formatKg } from './weight';

export type NudgeKind = 'unusual' | 'tip' | 'win';
export type NudgeAction = 'log-food' | 'log-weight' | 'log-exercise' | 'progress';

/** Whose colour a nudge's picture takes: food and weight, the streak, movement, protein. */
export type NudgeTone = 'primary' | 'secondary' | 'tertiary' | 'protein';

/** One day in a row of dots: logged (`hit`), not (`miss`), or today, which is still open. */
export interface NudgeDay {
  date: string;
  mark: 'hit' | 'miss' | 'today';
  /** Under the dot: the weekday's initial ("S"), or its short name ("Sat") when the days are not in a row. */
  label: string;
}

/** The one picture a nudge's card draws (docs/DESIGN.md, "Show, don't tell"). */
export type NudgePicture =
  /** Days hit or missed: a missed day, protein low, a gap in weigh-ins or workouts, a streak. */
  | { kind: 'days'; tone: NudgeTone; days: NudgeDay[] }
  /** One day's calories against the usual day's: two bars. */
  | { kind: 'compare'; tone: NudgeTone; day: { name: string; kcal: number }; usualKcal: number }
  /** The weight's weekly rate against the goal's pace, kg a week (gaining above zero). */
  | { kind: 'pace'; tone: NudgeTone; kgPerWeek: number; goalKgPerWeek: number }
  /**
   * One weigh-in against the spread of the weigh-ins before it: the lowest to the highest of
   * those as a band, the one weigh-in as a dot labelled with its day ("Wed").
   */
  | { kind: 'reading'; tone: NudgeTone; lowKg: number; highKg: number; kg: number; label: string };

/**
 * How a nudge is shown on Today: a short heading, one figure, one picture and one line, each
 * optional. `title` and `body` stay the whole message, for the morning notification, the
 * Assistant, a screen reader and the card's "How it's worked out" (left out when `line` is the
 * whole body).
 */
export interface NudgeVisual {
  /** One to three words: "Protein low", "Light day". */
  heading: string;
  /** The one number, with a change when there is one ("62.5 kg × 8", up 2.5 kg). */
  figure?: {
    value: string;
    unit?: string;
    change?: { direction: 'up' | 'down'; amount: string; towardGoal: boolean; spoken: string };
    tone?: NudgeTone;
  };
  picture?: NudgePicture;
  /** At most one short line, about 60 characters, that says what to do or why. */
  line?: string;
}

export interface Nudge {
  /** Stable for what it is about, so a dismissed nudge stays dismissed. */
  id: string;
  kind: NudgeKind;
  title: string;
  body: string;
  /** Higher first; 50 and over may become the morning notification. */
  priority: number;
  action?: { label: string; to: NudgeAction; date?: string };
  /** How Today shows it. Left out, the card shows the title and the body. */
  visual?: NudgeVisual;
}

export interface NudgeInput {
  today: string;
  goal: GoalType | null;
  /** The goal's weekly pace, kg; 0 when it has none. */
  paceKg: number;
  goals: Pick<Macros, 'calories' | 'protein'>;
  /** Food totals per logged day, any order, covering at least the last 30 days. */
  days: readonly ({ date: string; count: number } & Macros)[];
  /** The biggest item eaten on a day, by calories, for the days the rules may name. */
  biggestItem: (date: string) => { name: string; calories: number } | null;
  /** Every weigh-in, any order. */
  weights: readonly WeighIn[];
  /** Workouts over at least the last 60 days, any order. */
  exercises: readonly Exercise[];
  loggedDates: readonly string[];
  /** The owner's best protein foods, for the protein tip. */
  proteinFoods: readonly string[];
}

/** Notifications only for these and above. */
export const NOTIFY_MIN_PRIORITY = 50;

const weekdayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const dayName = (date: string): string => weekdayFormat.format(dateKeyToDate(date));
/** "S" for a day in a row of days, "Sat" for a day picked out of several. */
const dayInitial = (date: string): string => dayName(date).charAt(0);
const dayShort = (date: string): string => dayName(date).slice(0, 3);

/**
 * The `count` days up to today as a row of dots: `hit` where `isHit` holds, `today` for today
 * (still open, whatever is logged), `miss` otherwise. Oldest first.
 */
function lastDays(today: string, count: number, isHit: (date: string) => boolean): NudgeDay[] {
  return Array.from({ length: count }, (_, k) => {
    const date = addDays(today, k - count + 1);
    return { date, mark: date === today ? 'today' : isHit(date) ? 'hit' : 'miss', label: dayInitial(date) };
  });
}
/** Up to this many days in a row of dots for a streak: a month. */
const STREAK_DOTS = 30;
const kcal = (n: number): string => `${formatKcal(n)} kcal`;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
/** The Monday of a day's week, to key the tips that may come back once a week. */
export function weekKey(date: string): string {
  const day = (dateKeyToDate(date).getDay() + 6) % 7;
  return addDays(date, -day);
}
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
const normalName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Estimated one-rep max (Epley). */
export const oneRepMax = (kg: number, reps: number): number => kg * (1 + reps / 30);

// ---------------------------------------------------------------- the rules

function missedDay(i: NudgeInput, yesterday: string, byDate: Map<string, Macros & { count: number }>): Nudge | null {
  if (byDate.has(yesterday)) return null;
  let logged = 0;
  for (let k = 1; k <= 7; k++) if (byDate.has(addDays(yesterday, -k))) logged += 1;
  if (logged < 4) return null;
  const body = 'Add what you remember while it is fresh, so your averages stay true.';
  return {
    id: `missed-${yesterday}`,
    kind: 'tip',
    priority: 80,
    title: `Nothing logged on ${dayName(yesterday)}`,
    body,
    action: { label: `Log ${dayName(yesterday)}`, to: 'log-food', date: yesterday },
    visual: {
      heading: `${dayName(yesterday)} not logged`,
      picture: { kind: 'days', tone: 'primary', days: lastDays(i.today, 7, (d) => byDate.has(d)) },
      // The whole body is one short sentence: a shorter line would put the same words again behind a disclosure.
      line: body,
    },
  };
}

function unusualDay(i: NudgeInput, yesterday: string, byDate: Map<string, Macros & { count: number }>): Nudge | null {
  const y = byDate.get(yesterday);
  if (!y) return null;
  const full = completeDayThreshold(i.goals.calories);
  const before = [...byDate.entries()]
    .filter(([d, t]) => d < yesterday && d >= addDays(yesterday, -30) && t.calories >= full)
    .map(([, t]) => t.calories);
  if (before.length < 7) return null;
  const usual = mean(before);
  const spread = sd(before);

  if (y.calories >= full && y.calories > usual + 2 * spread && y.calories - i.goals.calories >= 400) {
    const top = i.biggestItem(yesterday);
    const highest = y.calories > Math.max(...before);
    const tail =
      i.goal === 'build_muscle'
        ? 'A big day helps building muscle, as long as the week averages out.'
        : 'One day like this will not change your trend; the week’s average is what counts.';
    return {
      id: `high-${yesterday}`,
      kind: 'unusual',
      priority: 70,
      title: highest ? `${dayName(yesterday)} was your highest day in a month` : `${dayName(yesterday)} was well above your usual`,
      body: `${kcal(y.calories)}, ${kcal(y.calories - usual)} more than your usual ${kcal(usual)}.${top ? ` Biggest item: ${top.name} (${kcal(top.calories)}).` : ''} ${tail}`,
      action: { label: 'See Progress', to: 'progress' },
      visual: {
        heading: highest ? 'Highest in a month' : 'Above your usual',
        picture: { kind: 'compare', tone: 'primary', day: { name: dayName(yesterday), kcal: Math.round(y.calories) }, usualKcal: Math.round(usual) },
        line: i.goal === 'build_muscle' ? 'Fine for building muscle, if the week averages out.' : 'One day like this will not change your trend.',
      },
    };
  }

  if (y.count > 0 && y.calories < full) {
    const body =
      i.goal === 'build_muscle'
        ? 'Building muscle needs a surplus, and a day this light undoes it. If you missed something, add it.'
        : 'If you missed logging something, add it so your averages stay true. Days this low are left out of them as not full days.';
    return {
      id: `low-${yesterday}`,
      kind: 'unusual',
      priority: 60,
      title: `${dayName(yesterday)} looks light: ${kcal(y.calories)}`,
      body,
      action: { label: `Add to ${dayName(yesterday)}`, to: 'log-food', date: yesterday },
      visual: {
        heading: 'Light day',
        picture: { kind: 'compare', tone: 'primary', day: { name: dayName(yesterday), kcal: Math.round(y.calories) }, usualKcal: Math.round(usual) },
        line: i.goal === 'build_muscle' ? 'Building muscle needs the surplus. Missed something? Add it.' : 'Missed something? Add it so your averages stay true.',
      },
    };
  }
  return null;
}

function proteinLow(i: NudgeInput, today: string, byDate: Map<string, Macros & { count: number }>): Nudge | null {
  if (i.goals.protein <= 0) return null;
  const full = completeDayThreshold(i.goals.calories);
  const recent = [...byDate.entries()]
    .filter(([d, t]) => d < today && t.calories >= full)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 4);
  if (recent.length < 4) return null;
  const under = recent.filter(([, t]) => t.protein < 0.8 * i.goals.protein).length;
  if (under < 3) return null;
  const avg = mean(recent.map(([, t]) => t.protein));
  const foods = i.proteinFoods.slice(0, 3);
  const why = i.goal === 'build_muscle' || i.goal === 'recomp' ? ' Protein is what turns training into muscle.' : '';
  return {
    id: `protein-${weekKey(today)}`,
    kind: 'tip',
    priority: 55,
    title: 'Protein has been low',
    body: `${under} of your last 4 full days were under ${Math.round(0.8 * i.goals.protein)} g (average ${Math.round(avg)} g against ${Math.round(i.goals.protein)} g).${why}${foods.length ? ` Your best sources: ${foods.join(', ')}.` : ''}`,
    visual: {
      heading: 'Protein low',
      figure: { value: `${Math.round(avg)} g`, unit: `a day, goal ${Math.round(i.goals.protein)} g`, tone: 'protein' },
      picture: {
        kind: 'days',
        tone: 'protein',
        // The full days are not always in a row, so each is named.
        days: [...recent].reverse().map(([date, t]) => ({ date, mark: t.protein < 0.8 * i.goals.protein ? 'miss' : 'hit', label: dayShort(date) })),
      },
      line: foods.length ? `Best sources: ${foods.join(', ')}.` : undefined,
    },
  };
}

function weighInJump(i: NudgeInput, today: string): Nudge | null {
  const sorted = [...i.weights].sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = sorted[sorted.length - 1];
  if (!latest || daysBetween(latest.date, today) > 1) return null;
  const before = sorted.filter((w) => w.date < latest.date && w.date >= addDays(latest.date, -10));
  if (before.length < 3) return null;
  const usual = mean(before.map((w) => w.kg));
  const diff = latest.kg - usual;
  if (Math.abs(diff) < Math.max(1.2, 0.015 * usual)) return null;
  const up = diff > 0;
  const kgs = before.map((w) => w.kg);
  return {
    id: `jump-${latest.date}`,
    kind: 'unusual',
    priority: 65,
    title: `Weight ${up ? 'up' : 'down'} ${Math.abs(diff).toFixed(1)} kg on ${dayName(latest.date)}`,
    body: `${formatKg(latest.kg)} against about ${formatKg(usual)} over the days before. A change this fast is almost always water: ${up ? 'salt, carbs, a late meal or a hard workout' : 'less salt or carbs, or sweating'}. Your trend uses every weigh-in, so one reading barely moves it.`,
    action: { label: 'See Progress', to: 'progress' },
    visual: {
      heading: `${dayName(latest.date)}’s weigh-in`,
      figure: {
        value: latest.kg.toFixed(1),
        unit: 'kg',
        // Water, not progress: never drawn as a step toward the goal, whichever way it went.
        change: {
          direction: up ? 'up' : 'down',
          amount: `${Math.abs(diff).toFixed(1)} kg`,
          towardGoal: false,
          spoken: `${up ? 'Up' : 'Down'} ${Math.abs(diff).toFixed(1)} kilograms on the days before`,
        },
      },
      // What the chip is measured from, drawn: the weigh-ins before as a band, this one as a dot outside it.
      picture: { kind: 'reading', tone: 'primary', lowKg: Math.min(...kgs), highKg: Math.max(...kgs), kg: latest.kg, label: dayShort(latest.date) },
      line: 'Almost always water. Your trend barely moves.',
    },
  };
}

function noWeighIn(i: NudgeInput, today: string): Nudge | null {
  if (!i.goal || i.weights.length === 0) return null;
  const last = i.weights.reduce((a, w) => (w.date > a ? w.date : a), '');
  const gap = daysBetween(last, today);
  if (gap < 7) return null;
  return {
    id: `noweigh-${weekKey(today)}`,
    kind: 'tip',
    priority: 40,
    title: `No weigh-in for ${gap} days`,
    body: 'The weekly check-in and your burn estimate run on weigh-ins. Two or three a week is enough.',
    action: { label: 'Log weight', to: 'log-weight' },
    visual: {
      heading: 'No weigh-in',
      figure: { value: String(gap), unit: 'days' },
      picture: { kind: 'days', tone: 'primary', days: lastDays(today, 10, (d) => i.weights.some((w) => w.date === d)) },
      line: 'Two or three a week keep your check-ins running.',
    },
  };
}

function noWorkout(i: NudgeInput, today: string): Nudge | null {
  if (i.goal !== 'build_muscle' && i.goal !== 'recomp') return null;
  const dates = [...new Set(i.exercises.map((x) => x.date))].sort();
  const last = dates[dates.length - 1];
  if (!last) return null;
  const gap = daysBetween(last, today);
  const month = dates.filter((d) => d >= addDays(last, -28)).length;
  if (gap < 5 || month < 4) return null;
  return {
    id: `noworkout-${last}`,
    kind: 'tip',
    priority: 50,
    title: `No workout since ${dayName(last)}`,
    body: `That is ${plural(gap, 'day')}. Muscle grows from regular training, 2 to 4 sessions a week. If you trained and did not log it, add it.`,
    action: { label: 'Log exercise', to: 'log-exercise' },
    visual: {
      heading: 'No workout',
      figure: { value: String(gap), unit: 'days' },
      picture: { kind: 'days', tone: 'tertiary', days: lastDays(today, 10, (d) => dates.includes(d)) },
      line: 'Muscle grows from 2 to 4 sessions a week.',
    },
  };
}

function paceOff(i: NudgeInput, today: string): Nudge | null {
  if ((i.goal !== 'build_muscle' && i.goal !== 'lose_fat') || i.paceKg <= 0) return null;
  const since = addDays(today, -29);
  // `weights` may come in any order; the fit reads the first and the last as the span it covers.
  const rate = weightRate(i.weights.filter((w) => w.date >= since && w.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1)));
  if (!rate.ready || !rate.clear) return null;
  const r = rate.kgPerWeek;
  const pace = i.paceKg;
  let title: string | null = null;
  let body = '';
  let heading = '';
  let line = '';
  if (i.goal === 'build_muscle') {
    if (r > 2 * pace + 0.1) {
      title = 'Gaining faster than planned';
      body = `Your weight is rising ${r.toFixed(2)} kg a week against your ${pace} kg goal. Past that pace most of the extra is fat; the next check-in will trim your calories.`;
      heading = 'Gaining fast';
      line = 'Past this pace most of it is fat; the check-in will trim.';
    } else if (r < -0.1) {
      title = 'Weight going down while building muscle';
      body = `It is falling ${Math.abs(r).toFixed(2)} kg a week. Muscle needs a surplus; the next check-in will add calories, or eat a little more now.`;
      heading = 'Weight falling';
      line = 'Muscle needs a surplus: eat a little more now.';
    }
  } else if (r > 0.1) {
    title = 'Weight going up while losing fat';
    body = `It is rising ${r.toFixed(2)} kg a week. Check for food not logged (oils, drinks, snacks); the next check-in will adjust your calories.`;
    heading = 'Weight rising';
    line = 'Check for food not logged: oils, drinks, snacks.';
  } else if (r < -(2 * pace + 0.1)) {
    title = 'Losing faster than planned';
    body = `${Math.abs(r).toFixed(2)} kg a week against your ${pace} kg goal. Losing this fast costs muscle; eat a little more and keep protein high.`;
    heading = 'Losing fast';
    line = 'This fast costs muscle: eat a little more, keep protein high.';
  }
  if (!title) return null;
  const goalKgPerWeek = i.goal === 'build_muscle' ? pace : -pace;
  return {
    id: `pace-${weekKey(today)}`,
    kind: 'unusual',
    priority: 45,
    title,
    body,
    action: { label: 'See Progress', to: 'progress' },
    visual: { heading, picture: { kind: 'pace', tone: 'primary', kgPerWeek: r, goalKgPerWeek }, line },
  };
}

/**
 * What a new best gained over the old one, for its chip: the weight when the reps are the same, the
 * reps when the weight is, and otherwise the old set it beat.
 */
function bestChange(now: { kg: number; reps: number }, best: { kg: number; reps: number }): NonNullable<NonNullable<NudgeVisual['figure']>['change']> {
  const kg = Math.round((now.kg - best.kg) * 100) / 100;
  const reps = now.reps - best.reps;
  const amount = now.reps === best.reps && kg > 0 ? `${kg} kg` : now.kg === best.kg && reps > 0 ? `${plural(reps, 'rep')}` : `from ${best.kg} kg × ${best.reps}`;
  const spoken = amount.startsWith('from') ? `Up ${amount}` : `Up ${amount} on your best of ${best.kg} kg × ${best.reps}`;
  return { direction: 'up', amount, towardGoal: true, spoken };
}

/** New bests and stalls on lifts logged with a weight and reps. */
function lifts(i: NudgeInput, today: string): Nudge[] {
  const out: Nudge[] = [];
  const sessions = new Map<string, { name: string; date: string; kg: number; reps: number; e1rm: number }[]>();
  for (const x of i.exercises) {
    if (!x.name || !x.loadKg || !x.reps || x.loadKg <= 0 || x.reps <= 0) continue;
    const key = normalName(x.name);
    const list = sessions.get(key) ?? [];
    list.push({ name: x.name, date: x.date, kg: x.loadKg, reps: x.reps, e1rm: oneRepMax(x.loadKg, x.reps) });
    sessions.set(key, list);
  }
  for (const list of sessions.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.e1rm - b.e1rm));
    const latest = list[list.length - 1];
    if (daysBetween(latest.date, today) > 1) continue;
    const earlier = list.filter((s) => s.date < latest.date);
    if (earlier.length === 0) continue;
    const best = earlier.reduce((a, s) => (s.e1rm > a.e1rm ? s : a));
    if (latest.e1rm >= best.e1rm + 0.5) {
      out.push({
        id: `best-${normalName(latest.name)}-${latest.date}`,
        kind: 'win',
        priority: 75,
        title: `New best: ${latest.name}`,
        body: `${latest.kg} kg × ${latest.reps}, up from ${best.kg} kg × ${best.reps}. Next time try ${latest.kg + 2.5} kg × ${latest.reps}, or one more rep.`,
        visual: {
          heading: 'New best',
          figure: { value: `${latest.kg} kg × ${latest.reps}`, unit: latest.name, change: bestChange(latest, best), tone: 'tertiary' },
          line: `Next time try ${latest.kg + 2.5} kg × ${latest.reps}, or one more rep.`,
        },
      });
      continue;
    }
    const last3 = list.slice(-3);
    const before3 = list.slice(0, -3);
    if (last3.length === 3 && before3.length > 0) {
      const top = Math.max(...before3.map((s) => s.e1rm));
      if (Math.max(...last3.map((s) => s.e1rm)) <= top) {
        out.push({
          id: `stall-${normalName(latest.name)}-${latest.date}`,
          kind: 'tip',
          priority: 45,
          title: `${latest.name} has stalled`,
          body: 'No better set in your last 3 sessions. Try a lighter week, a different rep range, or more protein and sleep.',
          visual: {
            heading: 'Stalled',
            figure: { value: `${latest.kg} kg × ${latest.reps}`, unit: latest.name, tone: 'tertiary' },
            line: 'No better set in 3 sessions: try a lighter week.',
          },
        });
      }
    }
  }
  return out;
}

function wins(i: NudgeInput, today: string, yesterday: string, byDate: Map<string, Macros & { count: number }>): Nudge[] {
  const out: Nudge[] = [];
  const streak = loggingStreak(i.loggedDates, today);
  const milestones = [7, 14, 21, 30, 50, 75, 100, 150, 200, 365];
  if (milestones.includes(streak.current)) {
    const body = 'Logging every day is what makes your averages and check-ins true.';
    const shown = Math.min(streak.current, STREAK_DOTS);
    const logged = new Set(i.loggedDates);
    // The run, oldest first, and today as an open ring when it is not logged yet.
    const days = lastDays(today, shown + (logged.has(today) ? 0 : 1), (d) => logged.has(d)).map((d) =>
      d.mark === 'today' && logged.has(today) ? { ...d, mark: 'hit' as const } : d,
    );
    out.push({
      id: `streak-${streak.current}-${today}`,
      kind: 'win',
      priority: 30,
      title: `${streak.current} days in a row`,
      body,
      // Primary, like the streak badge in Today's header once today is logged: a logging streak is about food.
      visual: { heading: `${streak.current}-day streak`, picture: { kind: 'days', tone: 'primary', days }, line: body },
    });
  }
  if (i.goals.protein > 0) {
    let run = 0;
    for (let d = yesterday; ; d = addDays(d, -1)) {
      const t = byDate.get(d);
      if (!t || t.protein < 0.9 * i.goals.protein) break;
      run += 1;
    }
    if (run === 5 || run === 10 || run === 20) {
      const body = 'Keep it there: steady protein is what lets your training build muscle.';
      out.push({
        id: `pstreak-${run}-${yesterday}`,
        kind: 'win',
        priority: 35,
        title: `Protein on target ${run} days running`,
        body,
        visual: {
          heading: `${run}-day protein streak`,
          // The run up to yesterday, every day of it on target, and today still open.
          picture: { kind: 'days', tone: 'protein', days: lastDays(today, run + 1, () => true) },
          line: body,
        },
      });
    }
  }
  return out;
}

/** Everything worth saying today, most important first. `dismissed` ids are left out. */
export function findNudges(i: NudgeInput, dismissed: ReadonlySet<string> = new Set()): Nudge[] {
  const today = i.today;
  const yesterday = addDays(today, -1);
  const byDate = new Map(i.days.map((d) => [d.date, d] as const));
  const all = [
    missedDay(i, yesterday, byDate),
    unusualDay(i, yesterday, byDate),
    proteinLow(i, today, byDate),
    weighInJump(i, today),
    noWeighIn(i, today),
    noWorkout(i, today),
    paceOff(i, today),
    ...lifts(i, today),
    ...wins(i, today, yesterday, byDate),
  ].filter((n): n is Nudge => n !== null && !dismissed.has(n.id));
  return all.sort((a, b) => b.priority - a.priority);
}
