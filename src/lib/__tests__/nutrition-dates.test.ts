/// <reference types="jest" />
import { addDays, dateKeyToDate, formatDayLabel, mealForTime, toDateKey } from '../dates';
import { bmr, calculateTargets, caloriesLeft, MIN_CALORIE_TARGET, sumMacros, type Profile } from '../nutrition';

const profile: Profile = { sex: 'male', age: 30, heightCm: 175, weightKg: 75, activity: 'moderate', goal: 'maintain' };

describe('nutrition', () => {
  it('computes Mifflin-St Jeor BMR', () => {
    // 10*75 + 6.25*175 - 5*30 + 5 = 1698.75
    expect(bmr(profile)).toBeCloseTo(1698.75);
    expect(bmr({ ...profile, sex: 'female' })).toBeCloseTo(1532.75);
  });

  it('derives calorie and macro targets that add up', () => {
    const t = calculateTargets(profile);
    expect(t.calories).toBe(2630); // 1698.75 * 1.55 = 2633 -> nearest 10
    expect(t.protein).toBe(120);
    const fromMacros = t.protein * 4 + t.carbs * 4 + t.fat * 9;
    expect(Math.abs(fromMacros - t.calories)).toBeLessThan(15);
  });

  it('never goes below the safety floor', () => {
    const tiny: Profile = { sex: 'female', age: 70, heightCm: 145, weightKg: 40, activity: 'sedentary', goal: 'lose' };
    expect(calculateTargets(tiny).calories).toBe(MIN_CALORIE_TARGET);
  });

  it('adds exercise calories only when opted in', () => {
    expect(caloriesLeft(2000, 1500, 300, false)).toBe(500);
    expect(caloriesLeft(2000, 1500, 300, true)).toBe(800);
  });

  it('sums macros', () => {
    expect(sumMacros([
      { calories: 100, protein: 1, carbs: 2, fat: 3 },
      { calories: 50, protein: 4, carbs: 5, fat: 6 },
    ])).toEqual({ calories: 150, protein: 5, carbs: 7, fat: 9 });
  });
});

describe('dates', () => {
  it('uses the local calendar day', () => {
    expect(toDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dateKeyToDate('2026-01-05').getDate()).toBe(5);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('labels today and yesterday', () => {
    const now = new Date(2026, 10, 9, 12);
    expect(formatDayLabel('2026-11-09', now)).toBe('Today');
    expect(formatDayLabel('2026-11-08', now)).toBe('Yesterday');
    expect(formatDayLabel('2026-11-03', now)).toBe('Tue, 3 Nov');
  });

  it('guesses the meal from the time of day', () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 9, h, m);
    expect(mealForTime(at(8))).toBe('breakfast');
    expect(mealForTime(at(13))).toBe('lunch');
    expect(mealForTime(at(16))).toBe('snack');
    expect(mealForTime(at(20))).toBe('dinner');
    expect(mealForTime(at(23, 30))).toBe('snack');
    expect(mealForTime(at(2))).toBe('snack');
  });
});
