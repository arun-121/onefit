/// <reference types="jest" />
import { CHECK_IN_MAX_STEP_KCAL, checkInScale, weeklyCheckIn, type CheckInInput } from '../check-in';
import type { MaintenanceCard } from '../insights';

const maintenance = (kcal: number, confidence: 'rough' | 'fair' | 'good' = 'good') =>
  ({ ready: true, kcal, low: kcal - 100, high: kcal + 100, rangeText: `Likely between ${kcal - 100} and ${kcal + 100} kcal`, confidence }) as unknown as MaintenanceCard;

const base: CheckInInput = {
  today: '2026-11-13',
  lastCheckInDate: '2026-11-06',
  maintenance: maintenance(2600),
  profile: { sex: 'male', age: 30, heightCm: 175, weightKg: 80, activity: 'moderate', goal: 'lose_fat', rateKg: 0.5 },
  currentKg: 80,
  goals: { calories: 2100, protein: 160, carbs: 200, fat: 58 },
};

describe('weeklyCheckIn', () => {
  it('works the target out from the measured burn and the goal', () => {
    const c = weeklyCheckIn(base)!;
    // 2,600 burned minus 550 for 0.5 kg a week.
    expect(c.targets.calories).toBe(2050);
    expect(c.change).toBe(-50);
    expect(c.title).toBe('Weekly check-in: 2,050 kcal a day');
    expect(c.body).toMatch(/^From your food and weigh-ins, you burn about 2,600 kcal a day \(likely between/);
    expect(c.body).toMatch(/To lose 0\.5 kg a week, eat about 2,050 kcal: 50 kcal less than now/);
  });

  it('moves at most one step a week', () => {
    const c = weeklyCheckIn({ ...base, maintenance: maintenance(3400) })!;
    expect(c.capped).toBe(true);
    expect(c.change).toBe(CHECK_IN_MAX_STEP_KCAL);
    expect(c.body).toMatch(/next week's check-in can go further\.$/);
  });

  it('says on track when the targets still fit', () => {
    const c = weeklyCheckIn({ ...base, goals: { ...base.goals, calories: 2060 } })!;
    expect(c.onTrack).toBe(true);
    expect(c.title).toBe('Weekly check-in: on track');
  });

  it('builds muscle on a surplus over the measured burn', () => {
    const c = weeklyCheckIn({ ...base, profile: { ...base.profile!, goal: 'build_muscle', rateKg: 0.25 }, goals: { ...base.goals, calories: 2800 } })!;
    expect(c.targets.calories).toBe(2880);
    expect(c.body).toMatch(/To gain 0\.25 kg a week/);
  });

  it('waits a week, a goal, a weigh-in and a fair estimate', () => {
    expect(weeklyCheckIn({ ...base, lastCheckInDate: '2026-11-10' })).toBeNull();
    expect(weeklyCheckIn({ ...base, lastCheckInDate: null })).not.toBeNull();
    expect(weeklyCheckIn({ ...base, profile: null })).toBeNull();
    expect(weeklyCheckIn({ ...base, currentKg: null })).toBeNull();
    expect(weeklyCheckIn({ ...base, maintenance: maintenance(2600, 'rough') })).toBeNull();
    expect(weeklyCheckIn({ ...base, maintenance: { ready: false, reason: 'x' } })).toBeNull();
  });

  it('carries the numbers its card draws: the burn range, the targets before, and one short line', () => {
    const c = weeklyCheckIn(base)!;
    expect(c).toMatchObject({ burnLow: 2500, burnHigh: 2700, confidence: 'good', current: base.goals });
    expect(c.line).toBe('To lose 0.5 kg a week.');
    expect(weeklyCheckIn({ ...base, maintenance: maintenance(3400) })!.line).toBe('To lose 0.5 kg a week, one 250 kcal step a week.');
    // On track, the card's chip says the target still fits, so the line only says what it is for; the body keeps the whole sentence.
    const onTrack = weeklyCheckIn({ ...base, goals: { ...base.goals, calories: 2060 } })!;
    expect(onTrack.line).toBe('To lose 0.5 kg a week.');
    expect(onTrack.body).toMatch(/target still fits\.$/);
  });
});

describe('checkInScale', () => {
  it('spans the burn range and both targets in whole hundreds, with room at each end', () => {
    const c = weeklyCheckIn(base)!;
    // 2,050 to 2,700, padded by 15% of that or 100, whichever is more.
    expect(checkInScale(c)).toEqual({ min: 1900, max: 2800 });
    const scale = checkInScale({ burnLow: 2450, burnHigh: 2750, targets: { ...base.goals, calories: 2050 }, current: { ...base.goals, calories: 2200 } });
    for (const v of [2050, 2200, 2450, 2750]) {
      expect(v).toBeGreaterThan(scale.min);
      expect(v).toBeLessThan(scale.max);
    }
  });
});
