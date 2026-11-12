/// <reference types="jest" />
import { DEFAULT_WEIGHT_KG, estimateBurn, formatMinutes } from '../exercise';
import { burnedForBudget } from '../nutrition';

describe('estimateBurn', () => {
  it('uses net MET × weight × hours', () => {
    // Moderate run: (9.8 − 1) × 70 kg × 0.5 h = 308
    expect(estimateBurn('run', 'moderate', 30, 70)).toBe(308);
    // Light walk: (2.8 − 1) × 80 × 1 = 144
    expect(estimateBurn('walk', 'light', 60, 80)).toBe(144);
  });

  it('falls back to a default weight and never goes negative', () => {
    expect(estimateBurn('yoga', 'light', 60, 0)).toBe(Math.round(1.5 * DEFAULT_WEIGHT_KG));
    expect(estimateBurn('walk', 'moderate', -10, 70)).toBe(0);
  });

  it('scales with intensity', () => {
    const light = estimateBurn('cycle', 'light', 45, 70);
    const hard = estimateBurn('cycle', 'hard', 45, 70);
    expect(hard).toBeGreaterThan(light);
  });
});

describe('formatMinutes', () => {
  it('formats minutes and hours', () => {
    expect(formatMinutes(30)).toBe('30 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(95)).toBe('1 h 35 min');
  });
});

describe('burnedForBudget', () => {
  it('always counts logged workouts, and Health Connect activity only when opted in', () => {
    expect(burnedForBudget(300, 150, false)).toBe(300);
    expect(burnedForBudget(300, 150, true)).toBe(450);
  });
});
