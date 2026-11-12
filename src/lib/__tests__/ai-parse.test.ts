/// <reference types="jest" />
import { applySavedFoods, buildSystemPrompt, extractJson, foodKey, parseMealResponse } from '../ai-parse';
import type { SavedFood } from '../types';

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"items":[],"note":""}')).toEqual({ items: [], note: '' });
  });

  it('ignores think blocks and code fences', () => {
    const reply = '<think>let me see</think>\n```json\n{"items":[],"note":"ok"}\n```';
    expect(extractJson(reply)).toEqual({ items: [], note: 'ok' });
  });

  it('finds JSON surrounded by prose', () => {
    expect(extractJson('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
  });

  it('throws when there is no JSON', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('parseMealResponse', () => {
  it('cleans numbers, rounds and keeps valid items', () => {
    const reply = JSON.stringify({
      items: [
        { name: ' Scrambled eggs ', portion: '2 large', calories: 182.6, protein: '12.34', carbs: 1.9, fat: 13.1, confidence: 'high' },
        { name: '', portion: '1', calories: 10, protein: 0, carbs: 0, fat: 0, confidence: 'low' },
        { name: 'Toast', portion: '1 slice', calories: -5, protein: 'abc', carbs: 14, fat: 1, confidence: 'weird' },
      ],
      note: 'Assumed butter was used.',
    });
    const parsed = parseMealResponse(reply);
    expect(parsed.note).toBe('Assumed butter was used.');
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({ name: 'Scrambled eggs', calories: 183, protein: 12.3, confidence: 'high' });
    expect(parsed.items[1]).toMatchObject({ name: 'Toast', calories: 0, protein: 0, carbs: 14, confidence: 'medium' });
    expect(parsed.items[0].key).not.toBe(parsed.items[1].key);
  });

  it('handles a missing items array', () => {
    expect(parseMealResponse('{"note":"That is not food."}')).toEqual({ items: [], note: 'That is not food.' });
  });
});

describe('applySavedFoods', () => {
  const saved: SavedFood[] = [
    { id: 1, name: 'Black coffee', portion: '1 mug', calories: 5, protein: 0.3, carbs: 0, fat: 0, pinned: false, useCount: 4, lastUsedAt: 0 },
  ];

  it('uses the saved values when name and portion match', () => {
    const items = [
      { key: 'a', name: 'black coffee', portion: '1 Mug', calories: 2, protein: 0, carbs: 0, fat: 0, confidence: 'medium' as const },
      { key: 'b', name: 'Black coffee', portion: '2 mugs', calories: 4, protein: 0, carbs: 0, fat: 0, confidence: 'medium' as const },
    ];
    const out = applySavedFoods(items, saved);
    expect(out[0]).toMatchObject({ name: 'Black coffee', portion: '1 mug', calories: 5, confidence: 'high' });
    expect(out[1]).toEqual(items[1]);
  });
});

describe('foodKey', () => {
  it('ignores case, punctuation and extra spaces', () => {
    expect(foodKey('  Peanut-Butter  Toast!', '1 Slice')).toBe(foodKey('peanut butter toast', '1 slice'));
  });
});

describe('buildSystemPrompt', () => {
  it('lists the user saved foods', () => {
    const prompt = buildSystemPrompt([{ name: 'Oats', portion: '1 bowl', calories: 310, protein: 11, carbs: 52, fat: 6.25 }]);
    expect(prompt).toContain('Oats (1 bowl): 310 kcal, P 11 g, C 52 g, F 6.3 g');
  });

  it('omits the saved foods section when there are none', () => {
    expect(buildSystemPrompt([])).not.toContain('saved foods');
  });
});
