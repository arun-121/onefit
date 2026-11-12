/// <reference types="jest" />
import { foodKey, portionLabel } from '../ai-parse';
import { planFoodMerge, type FoodIdentity } from '../food-merge';

const food = (id: number, name: string, portion: string, extra: Partial<FoodIdentity> = {}): FoodIdentity => ({
  id,
  name,
  portion,
  pinned: false,
  useCount: 1,
  lastUsedAt: id * 1000,
  ...extra,
});

describe('foodKey with generic portions', () => {
  it('treats "one serving" wordings and a blank portion as the same food', () => {
    const plain = foodKey('Black coffee', '');
    for (const portion of ['1 serving', 'One serving', 'a serving', 'serving', '1 portion', '1', ' 1 Serving. ']) {
      expect(foodKey('Black coffee', portion)).toBe(plain);
    }
  });

  it('keeps real portions apart', () => {
    expect(foodKey('Rice', '1 cup')).not.toBe(foodKey('Rice', '2 cups'));
    expect(foodKey('Rice', '1 cup')).not.toBe(foodKey('Rice', ''));
    expect(foodKey('Rice', '2 servings')).not.toBe(foodKey('Rice', '1 serving'));
  });

  it('labels only meaningful portions', () => {
    expect(portionLabel('1 serving')).toBe('');
    expect(portionLabel('')).toBe('');
    expect(portionLabel(' 1 bowl ')).toBe('1 bowl');
  });
});

describe('planFoodMerge', () => {
  it('merges foods that are the same under the current key', () => {
    const plan = planFoodMerge([
      food(1, 'Black coffee', '', { useCount: 3, pinned: true }),
      food(2, 'Black coffee', '1 serving', { useCount: 2 }),
      food(3, 'Oats with banana', '1 bowl', { useCount: 4 }),
    ]);
    expect(plan.remove).toEqual([1]);
    expect(plan.keep).toContainEqual({ id: 2, foodKey: foodKey('Black coffee', ''), pinned: true, useCount: 5, lastUsedAt: 2000 });
    expect(plan.keep).toContainEqual({ id: 3, foodKey: foodKey('Oats with banana', '1 bowl'), pinned: false, useCount: 4, lastUsedAt: 3000 });
  });

  it('keeps the most recently used row, whatever its id', () => {
    const plan = planFoodMerge([
      food(1, 'Tea', '1 serving', { lastUsedAt: 9000 }),
      food(2, 'Tea', '', { lastUsedAt: 5000 }),
    ]);
    expect(plan.keep.map((k) => k.id)).toEqual([1]);
    expect(plan.remove).toEqual([2]);
  });

  it('leaves distinct foods alone and gives every survivor a key', () => {
    const rows = [food(1, 'Rice', '1 cup'), food(2, 'Rice', '2 cups'), food(3, 'Dal', '')];
    const plan = planFoodMerge(rows);
    expect(plan.remove).toEqual([]);
    expect(plan.keep.map((k) => k.id).sort()).toEqual([1, 2, 3]);
    expect(new Set(plan.keep.map((k) => k.foodKey)).size).toBe(3);
  });

  it('handles an empty table', () => {
    expect(planFoodMerge([])).toEqual({ keep: [], remove: [] });
  });
});
