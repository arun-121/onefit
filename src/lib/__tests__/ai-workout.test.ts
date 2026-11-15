/// <reference types="jest" />
import { buildWorkoutPrompt, parseWorkoutResponse } from '../ai-workout';
import { burnFromMet, exerciseDetailLine, exerciseTitle } from '../exercise';

describe('parseWorkoutResponse', () => {
  const reply = JSON.stringify({
    items: [
      { name: 'Bench press', details: '4 x 10 at 60 kg', activity: 'strength', intensity: 'hard', minutes: 12, met: 5, sets: 4, reps: 10, load_kg: 60, confidence: 'medium' },
      { name: 'Treadmill run', details: '20 min', activity: 'run', intensity: 'moderate', minutes: 20, met: 9.8, sets: null, reps: null, load_kg: null, confidence: 'high' },
      { name: '', minutes: 10, met: 3 },
      { name: 'Plank', details: '', activity: 'dance', intensity: 'extreme', minutes: 0, met: 3.8 },
    ],
    note: 'Times for the lifts are estimated from your sets.',
  });

  it('works the calories out from the MET, the minutes and the weight', () => {
    const { items, note } = parseWorkoutResponse(reply, 80);
    expect(items.map((i) => i.name)).toEqual(['Bench press', 'Treadmill run']);
    // (5 - 1) x 80 kg x 12/60 h = 64
    expect(items[0]).toMatchObject({ details: '4 x 10 at 60 kg', activity: 'strength', sets: 4, reps: 10, loadKg: 60, calories: 64 });
    expect(items[1]).toMatchObject({ activity: 'run', sets: null, loadKg: null, calories: burnFromMet(9.8, 20, 80) });
    expect(note).toBe('Times for the lifts are estimated from your sets.');
  });

  it('keeps a MET and minutes inside sensible bounds and unknown labels at safe defaults', () => {
    const { items } = parseWorkoutResponse(
      JSON.stringify({ items: [{ name: 'Mystery', details: '', activity: 'dance', intensity: 'extreme', minutes: 2000, met: 99, sets: '3', reps: null, load_kg: null }] }),
      70,
    );
    expect(items[0]).toMatchObject({ activity: 'other', intensity: 'moderate', minutes: 600, met: 23, sets: 3, confidence: 'medium' });
  });

  it('reads JSON wrapped in a code fence', () => {
    expect(parseWorkoutResponse('```json\n{"items":[],"note":"Not exercise."}\n```', 70)).toEqual({ items: [], note: 'Not exercise.' });
  });
});

describe('workout prompt and titles', () => {
  it('tells the model the weight and asks for MET and minutes, not calories', () => {
    const p = buildWorkoutPrompt(78.4);
    expect(p).toContain('weighs about 78 kg');
    expect(p).toMatch(/Compendium of Physical Activities/);
    expect(p).not.toMatch(/calories:/);
  });

  it('names a workout by what it was called, else by its activity', () => {
    expect(exerciseTitle({ activity: 'strength', name: 'Bench press' })).toBe('Bench press');
    expect(exerciseTitle({ activity: 'strength', name: '' })).toBe('Strength');
    expect(exerciseDetailLine({ details: '4 x 10 at 60 kg', minutes: 12, intensity: 'hard' })).toBe('4 x 10 at 60 kg, 12 min');
    expect(exerciseDetailLine({ minutes: 30, intensity: 'moderate' })).toBe('30 min, moderate');
  });
});
