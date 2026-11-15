/// <reference types="jest" />
import { coachTip, proteinFoods, type CoachInput } from '../coach';
import type { SavedFood } from '../types';

const food = (id: number, name: string, calories: number, protein: number): SavedFood => ({
  id,
  name,
  portion: '1 serving',
  calories,
  protein,
  carbs: 10,
  fat: 5,
  pinned: false,
  useCount: 10 - id,
  lastUsedAt: 0,
});

const foods = [
  food(1, 'Chicken breast', 250, 46),
  food(2, 'Greek yogurt', 150, 17),
  food(3, 'Biryani', 700, 25),
  food(4, 'Banana', 105, 1),
];

const base: CoachInput = {
  hour: 14,
  eaten: { calories: 1200, protein: 50, carbs: 150, fat: 40 },
  budget: 2200,
  proteinGoal: 140,
  goal: 'lose_fat',
  entryCount: 3,
  foods,
};

describe('coachTip', () => {
  it('names the protein left and the saved foods that fit, densest first', () => {
    const tip = coachTip(base)!;
    expect(tip.title).toBe('90 g of protein to go');
    expect(tip.body).toMatch(/^1,000 kcal left\. These from your foods fit:$/);
    expect(tip.suggestions.map((f) => f.name)).toEqual(['Chicken breast', 'Greek yogurt', 'Biryani']);
  });

  it('leaves out foods bigger than what is left', () => {
    expect(proteinFoods(foods, 300).map((f) => f.name)).toEqual(['Chicken breast', 'Greek yogurt']);
  });

  it('suggests common protein foods when none of the saved ones fit', () => {
    const tip = coachTip({ ...base, foods: [food(4, 'Banana', 105, 1)] })!;
    expect(tip.suggestions).toEqual([]);
    expect(tip.body).toMatch(/Greek yogurt fit best\.$/);
  });

  it('is kind about a day over budget, in the words of the goal', () => {
    expect(coachTip({ ...base, eaten: { ...base.eaten, calories: 2500 } })).toMatchObject({ title: '300 kcal over today', suggestions: [] });
    expect(coachTip({ ...base, goal: 'build_muscle', eaten: { ...base.eaten, calories: 2500 } })!.body).toMatch(/surplus/);
  });

  it('asks for the surplus in the evening when building muscle', () => {
    const tip = coachTip({ ...base, goal: 'build_muscle', hour: 19, eaten: { ...base.eaten, protein: 135 } })!;
    expect(tip.title).toBe('1,000 kcal left to eat');
    expect(tip.suggestions.length).toBeGreaterThan(0);
    // The full protein bar says protein is in; the line says only what the bar cannot.
    expect(tip).toMatchObject({ kind: 'surplus', figure: { value: '1,000 kcal', unit: 'left to eat' }, protein: { eaten: 135, goal: 140 } });
    expect(tip.line).toBe('Building muscle needs the surplus too.');
  });

  it('says protein is reached once it is', () => {
    expect(coachTip({ ...base, eaten: { ...base.eaten, protein: 141 } })!.title).toBe('Protein goal reached');
  });

  it('starts the morning with the protein goal, and asks for a log later in the day', () => {
    expect(coachTip({ ...base, hour: 8, entryCount: 0, eaten: { calories: 0, protein: 0, carbs: 0, fat: 0 } })!.title).toBe(
      '140 g of protein today',
    );
    expect(coachTip({ ...base, hour: 15, entryCount: 0, eaten: { calories: 0, protein: 0, carbs: 0, fat: 0 } })!.title).toBe(
      'Nothing logged yet today',
    );
  });

  it('gives the card its figure, the protein bar and the calories left', () => {
    const tip = coachTip(base)!;
    expect(tip).toMatchObject({
      kind: 'protein',
      figure: { value: '90 g', unit: 'protein to go' },
      protein: { eaten: 50, goal: 140 },
      kcalLeft: 1000,
      // The chips are the answer, so there is no line on a lose-fat day.
      line: null,
    });
    expect(coachTip({ ...base, goal: 'recomp' })!.line).toBe('Protein is what turns your training into muscle.');
    expect(coachTip({ ...base, foods: [] })!.line).toMatch(/fit best\.$/);
  });

  it('says a day over budget as a figure and a short line, without a protein bar', () => {
    const over = coachTip({ ...base, eaten: { ...base.eaten, calories: 2500 } })!;
    expect(over).toMatchObject({ kind: 'over', figure: { value: '300 kcal', unit: 'over today' }, protein: null, kcalLeft: -300 });
    expect(over.line).toBe('Your weekly average is what moves your weight.');
  });

  it('keeps every short line to about one line on a phone', () => {
    const tips = [
      coachTip(base),
      coachTip({ ...base, foods: [] }),
      coachTip({ ...base, goal: 'build_muscle', eaten: { ...base.eaten, calories: 2500 } }),
      coachTip({ ...base, goal: 'maintain', eaten: { ...base.eaten, calories: 2500 } }),
      coachTip({ ...base, goal: 'build_muscle', hour: 19, eaten: { ...base.eaten, protein: 135 } }),
      coachTip({ ...base, eaten: { ...base.eaten, protein: 141 } }),
      coachTip({ ...base, hour: 8, entryCount: 0, eaten: { calories: 0, protein: 0, carbs: 0, fat: 0 } }),
      coachTip({ ...base, hour: 15, entryCount: 0, eaten: { calories: 0, protein: 0, carbs: 0, fat: 0 } }),
    ];
    for (const t of tips) expect((t!.line ?? '').length).toBeLessThanOrEqual(66);
    expect(tips[5]).toMatchObject({ kind: 'protein-done', figure: { value: '141 g', unit: 'protein, goal reached' }, protein: { eaten: 141, goal: 140 } });
  });
});
