/// <reference types="jest" />
import { assistantDigest, assistantSystemPrompt, cleanReply, historyForModel, type AssistantInput, type ChatMessage } from '../assistant';
import type { Insights } from '../insights';

const notReady = (reason: string) => ({ ready: false as const, reason });

const insights = {
  period: { days: 30, from: '2026-10-15', to: '2026-11-13' },
  headline: notReady('Log a few more days to see a summary.'),
  weight: notReady('Log your weight to see where it is heading.'),
  calories: notReady('Log your meals to see your average against your goal.'),
  maintenance: notReady('Needs 14 days of weigh-ins.'),
  macros: notReady('Needs 3 complete days.'),
  exercise: notReady('Log a workout.'),
  consistency: notReady('Log a meal.'),
  patterns: notReady('Needs 5 complete days.'),
  topFoods: { ready: true, totalCalories: 1000, foods: [{ name: 'Rice', calories: 600, count: 3, share: 0.6 }] },
} as unknown as Insights;

const input: AssistantInput = {
  nowText: 'Friday 13 November 2026 at 16:40',
  goals: { calories: 2500, protein: 140, carbs: 330, fat: 69 },
  profile: { sex: 'male', age: 30, heightCm: 170, weightKg: 70, activity: 'light', goal: 'build_muscle', rateKg: 0.25 },
  weightGoalKg: 75,
  insights,
  todayEntries: [
    { id: 1, date: '2026-11-13', meal: 'breakfast', name: 'Eggs', portion: '2 eggs', calories: 140, protein: 12, carbs: 1, fat: 10, source: 'text', createdAt: 0, hcRecordId: null },
  ],
  todayExercises: [],
  todayBudget: 2500,
  recentDays: [{ date: '2026-11-12', calories: 2100, protein: 90, carbs: 250, fat: 70 }],
  recentWeights: [{ date: '2026-11-12', kg: 70.2 }],
  proteinFoods: [{ name: 'Chicken', protein: 120, count: 3 }],
  savedFoods: [],
};

describe('assistantDigest', () => {
  const digest = assistantDigest(input);

  it('gives the goal, targets and today', () => {
    expect(digest).toContain('Goal: Build muscle at 0.25 kg a week.');
    expect(digest).toContain('Target weight: 75.0 kg.');
    expect(digest).toContain('Today so far: 140 kcal, 12 g protein, 1 g carbs, 10 g fat. Budget 2,500 kcal, so 2,360 kcal left and 128 g protein to go.');
    expect(digest).toContain('- Breakfast: Eggs (2 eggs): 140 kcal');
  });

  it('passes on a card that is not ready as its reason, never as a figure', () => {
    expect(digest).toContain('- Weight: not ready: Log your weight to see where it is heading.');
    expect(digest).toContain('- What they really burn (from intake and weight trend): not ready: Needs 14 days of weigh-ins.');
  });

  it('includes foods, protein sources, days and weigh-ins', () => {
    expect(digest).toContain('Rice (600 kcal, 3 times, 60%)');
    expect(digest).toContain('Top protein sources, 30 days: Chicken (120 g, 3 times).');
    expect(digest).toContain('- 2026-11-12: 2,100 kcal, 90 g protein');
    expect(digest).toContain('2026-11-12 70.2 kg');
  });

  it('is wrapped in rules that forbid made-up numbers and keep the floor', () => {
    const prompt = assistantSystemPrompt(digest);
    expect(prompt).toMatch(/Never invent a number/);
    expect(prompt).toMatch(/under 1,200 kcal/);
    expect(prompt.endsWith(digest)).toBe(true);
  });
});

describe('cleanReply', () => {
  it('drops markdown emphasis and headings and keeps bullets', () => {
    expect(cleanReply('## Plan\n**Eat** more protein.\n* Eggs\n\n\n\n* Dal')).toBe('Plan\nEat more protein.\n- Eggs\n\n- Dal');
  });
});

describe('historyForModel', () => {
  it('leaves out failed answers and keeps the last turns', () => {
    const m = (role: ChatMessage['role'], text: string, error?: boolean): ChatMessage => ({ role, text, at: 0, ...(error ? { error } : {}) });
    const history = historyForModel([m('user', 'a'), m('assistant', 'b'), m('user', 'c'), m('assistant', 'oops', true)], 2);
    expect(history).toEqual([
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);
  });
});
