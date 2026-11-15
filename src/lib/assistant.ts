/**
 * The Assistant tab: a chat with a language model that knows the owner's own logs. This file is
 * the pure part: the summary of the data the model is given, the rules it answers by, and the
 * clean-up of its reply. The figures come from the same Progress cards the app shows, so the
 * assistant never has a number the app would not stand behind; a card that is not ready is passed
 * on as its reason, and the model is told to say what to log rather than guess.
 */
import { exerciseTitle } from './exercise';
import type { Insights } from './insights';
import { ACTIVITY_LABELS, formatKcal, GOAL_LABELS, goalRateKg, MIN_CALORIE_TARGET, type Profile } from './nutrition';
import { percentText } from './progress-view';
import type { Entry, Exercise, Macros, SavedFood, WeightEntry } from './types';
import { MEAL_LABELS } from './types';
import { formatKg } from './weight';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Epoch ms. */
  at: number;
  /** An answer that failed; shown as an error and never sent back to the model. */
  error?: boolean;
}

export interface AssistantInput {
  /** Local date and time now, written out ("Thursday 13 November 2026, 16:40"). */
  nowText: string;
  goals: Macros;
  profile: Profile | null;
  weightGoalKg: number | null;
  /** The 30-day Progress cards. */
  insights: Insights;
  todayEntries: readonly Entry[];
  todayExercises: readonly Exercise[];
  /** Today's calorie budget: the goal plus the workouts that count. */
  todayBudget: number;
  /** Food totals by day, newest first, for the last two weeks. */
  recentDays: readonly ({ date: string } & Macros)[];
  recentWeights: readonly Pick<WeightEntry, 'date' | 'kg'>[];
  /** The foods that brought the most protein over 30 days. */
  proteinFoods: readonly { name: string; protein: number; count: number }[];
  /** Saved foods, most used first, with the portion they were saved at. */
  savedFoods: readonly SavedFood[];
  /** What Heads up noticed today (see `nudges.ts`). */
  noticed?: readonly { title: string; body: string }[];
}

const kcal = (n: number): string => `${formatKcal(n)} kcal`;
const g = (n: number): string => `${Math.round(n)} g`;
const macrosText = (m: Macros): string => `${kcal(m.calories)}, ${g(m.protein)} protein, ${g(m.carbs)} carbs, ${g(m.fat)} fat`;

function goalLine(input: AssistantInput): string {
  const p = input.profile;
  const goal = p
    ? `${GOAL_LABELS[p.goal]}${goalRateKg(p) > 0 ? ` at ${goalRateKg(p)} kg a week` : ''}`
    : 'not set (the targets calculator in Settings has not been used)';
  const target = input.weightGoalKg !== null ? formatKg(input.weightGoalKg) : 'none set';
  return [
    `Goal: ${goal}.`,
    `Daily targets: ${macrosText(input.goals)}.`,
    `Target weight: ${target}.`,
    p ? `Profile: ${p.sex}, ${p.age} years, ${p.heightCm} cm, ${formatKg(p.weightKg)}, ${ACTIVITY_LABELS[p.activity].toLowerCase()}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function todayLines(input: AssistantInput): string[] {
  const eaten = input.todayEntries.reduce<Macros>(
    (a, e) => ({ calories: a.calories + e.calories, protein: a.protein + e.protein, carbs: a.carbs + e.carbs, fat: a.fat + e.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  const lines = [
    `Today so far: ${input.todayEntries.length ? macrosText(eaten) : 'nothing logged'}. Budget ${kcal(input.todayBudget)}, so ${kcal(input.todayBudget - eaten.calories)} left and ${g(Math.max(0, input.goals.protein - eaten.protein))} protein to go.`,
  ];
  for (const e of input.todayEntries) {
    lines.push(`- ${MEAL_LABELS[e.meal]}: ${e.name} (${e.portion}): ${macrosText(e)}`);
  }
  for (const x of input.todayExercises) {
    lines.push(`- Workout: ${exerciseTitle(x)}${x.details ? ` (${x.details})` : ''}, ${x.minutes} min, ${x.intensity}, ${kcal(x.calories)}`);
  }
  return lines;
}

/** One line for a card: its figures, or why it has none yet. */
const card = <T,>(c: { ready: true } & T | { ready: false; reason: string }, ready: (c: T) => string): string =>
  c.ready ? ready(c) : `not ready: ${c.reason}`;

function periodLines(i: Insights): string[] {
  const lines: string[] = [`Last 30 days (${i.period.from} to ${i.period.to}):`];
  lines.push(`- Summary: ${card(i.headline, (h) => h.text)}`);
  lines.push(
    `- Weight: ${card(i.weight, (w) => {
      const parts = [`latest ${formatKg(w.latest.kg)} on ${w.latest.date}`, `current ${formatKg(w.currentKg)}`, `${w.weighIns} weigh-ins`];
      parts.push(w.rate.ready ? `trend ${w.rate.rateText}${w.rate.clear ? '' : ' (not clear yet)'}` : `trend not ready: ${w.rate.reason}`);
      if (w.goal) parts.push(w.goal.reached ? `target ${formatKg(w.goal.kg)} reached` : `${w.goal.toGoKg} kg to target ${formatKg(w.goal.kg)}`);
      parts.push(w.projection.text);
      return parts.join('; ');
    })}`,
  );
  lines.push(
    `- Calories: ${card(i.calories, (c) => {
      const avg = c.average.ready ? `average ${kcal(c.average.kcal)} a day on ${c.average.days} complete days against a goal of ${kcal(c.goal)}` : `no average: ${c.average.reason}`;
      return `${avg}; ${c.loggedDays} days logged, ${c.withinBudgetDays} within budget, ${c.overBudgetDays} over`;
    })}`,
  );
  lines.push(`- What they really burn (from intake and weight trend): ${card(i.maintenance, (m) => `${m.rangeText} (${m.confidence} confidence). ${m.note}`)}`);
  lines.push(
    `- Macros: ${card(i.macros, (m) => `averages on ${m.days} complete days: protein ${g(m.protein.average)} of ${g(m.protein.goal)}, carbs ${g(m.carbs.average)} of ${g(m.carbs.goal)}, fat ${g(m.fat.average)} of ${g(m.fat.goal)}; protein goal reached on ${m.proteinDays} of ${m.days} days`)}`,
  );
  lines.push(
    `- Exercise: ${card(i.exercise, (e) => {
      const top = e.top.map((a) => `${a.label} ${a.minutes} min`).join(', ');
      return `${e.workouts} workouts, ${e.minutes} min, ${kcal(e.calories)} on ${e.activeDays} days${e.perWeek ? `, ${e.perWeek.workouts} a week` : ''}${top ? `; ${top}` : ''}`;
    })}`,
  );
  lines.push(`- Logging: ${card(i.consistency, (c) => `${c.text} Streak ${c.streak.current} days, best ${c.streak.best}.`)}`);
  lines.push(
    `- Patterns: ${card(i.patterns, (p) => {
      const meals = p.meals.map((m) => `${m.label} ${percentText(m.share)} (${kcal(m.average)} a day)`).join(', ');
      const split = p.weekSplit.ready ? p.weekSplit.text : p.weekSplit.reason;
      const high = p.highestDay.ready ? p.highestDay.text : p.highestDay.reason;
      return `calories by meal: ${meals}. ${split} ${high}`;
    })}`,
  );
  lines.push(
    `- Foods with the most calories: ${card(i.topFoods, (t) => t.foods.map((f) => `${f.name} (${kcal(f.calories)}, ${f.count} times, ${percentText(f.share)})`).join('; '))}`,
  );
  return lines;
}

/** The owner's data, as the model is given it. */
export function assistantDigest(input: AssistantInput): string {
  const sections = [
    `Now: ${input.nowText}.`,
    goalLine(input),
    todayLines(input).join('\n'),
    periodLines(input.insights).join('\n'),
  ];
  if (input.noticed?.length) {
    sections.push(['What the app noticed today:', ...input.noticed.map((n) => `- ${n.title}: ${n.body}`)].join('\n'));
  }
  if (input.proteinFoods.length) {
    sections.push(`Top protein sources, 30 days: ${input.proteinFoods.map((f) => `${f.name} (${g(f.protein)}, ${f.count} times)`).join('; ')}.`);
  }
  if (input.recentDays.length) {
    sections.push(['Food by day, last 2 weeks (newest first):', ...input.recentDays.map((d) => `- ${d.date}: ${macrosText(d)}`)].join('\n'));
  }
  if (input.recentWeights.length) {
    sections.push(`Weigh-ins, last 2 weeks: ${input.recentWeights.map((w) => `${w.date} ${formatKg(w.kg)}`).join('; ')}.`);
  }
  if (input.savedFoods.length) {
    sections.push(
      ['Foods they log often (per saved portion):', ...input.savedFoods.map((f) => `- ${f.name}, ${f.portion}: ${macrosText(f)}`)].join('\n'),
    );
  }
  return sections.join('\n\n');
}

/** How the assistant answers. */
export function assistantSystemPrompt(digest: string): string {
  return `You are the owner's personal fitness assistant inside their own fitness tracker app. You answer questions about their food, weight, exercise and habits, and give practical next steps.

Rules:
- Use only the figures in the data below. Never invent a number. When something says "not ready", treat it as unknown and say what to log, and for how long, to find out.
- Answer in 2 to 5 short sentences, or up to 5 bullet points starting with "- ". Plain words. No headings, tables or bold.
- Use kcal, g and kg. Round sensibly.
- When suggesting food, prefer foods from their own list, with the portion and calories from it.
- Fit the advice to their goal. Be encouraging and honest; never shame.
- You are not a doctor. For pain, injury, illness, medication, pregnancy or disordered eating, say to see a professional. Never suggest eating under ${formatKcal(MIN_CALORIE_TARGET)} kcal a day.

The owner's data:
${digest}`;
}

/** The model's reply as plain text: markdown emphasis and headings dropped, bullets kept. */
export function cleanReply(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[ \t]*[*•][ \t]+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The last turns that are sent back with a question: answered ones, at most `max` messages. */
export function historyForModel(messages: readonly ChatMessage[], max = 10): { role: 'user' | 'assistant'; content: string }[] {
  return messages
    .filter((m) => !m.error)
    .slice(-max)
    .map((m) => ({ role: m.role, content: m.text }));
}

/** Questions offered before the first one is asked. */
export const STARTER_QUESTIONS = [
  'How am I doing this month?',
  'What should I eat for the rest of today?',
  'Where do my calories come from?',
  'How can I get more protein?',
  'Is my weight going the right way?',
  'What one thing should I change this week?',
] as const;
