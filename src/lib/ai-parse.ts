/**
 * Pure helpers for the AI meal parser: the prompt, the JSON schema Groq must follow,
 * and validation of whatever comes back. No network or native code here so it is easy to test.
 */
import type { Confidence, DraftItem, FoodItem, SavedFood } from './types';

export interface ParsedMeal {
  items: DraftItem[];
  /** Anything the model wants the user to double-check. Empty when there is nothing to say. */
  note: string;
}

const MAX_ITEMS = 30;

/** Strict JSON schema for Groq structured outputs (every property required, no extras). */
export const MEAL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'note'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'portion', 'calories', 'protein', 'carbs', 'fat', 'confidence'],
        properties: {
          name: { type: 'string', description: 'Short food name, e.g. "Scrambled eggs"' },
          portion: { type: 'string', description: 'Amount eaten, e.g. "2 large", "1 cup (240 ml)", "150 g"' },
          calories: { type: 'number', description: 'kcal for the whole portion' },
          protein: { type: 'number', description: 'grams for the whole portion' },
          carbs: { type: 'number', description: 'grams for the whole portion' },
          fat: { type: 'number', description: 'grams for the whole portion' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
    note: {
      type: 'string',
      description: 'One short sentence on assumptions the user should check, or empty string',
    },
  },
} as const;

export function buildSystemPrompt(knownFoods: readonly FoodItem[]): string {
  const lines = [
    'You are a nutrition logging assistant inside a personal calorie tracker.',
    'Turn what the user ate into a list of food items with calories and macros for the portion they actually ate.',
    'Rules:',
    '- One item per distinct food or drink. Split combined dishes only when the parts are clearly separate (e.g. "rice and curry" is two items).',
    '- If no amount is given, assume one typical single-person serving and say so in the portion, e.g. "1 serving (~250 g)".',
    '- Include cooking fats, sauces, sugar and milk in drinks when mentioned or clearly visible.',
    '- Calories must roughly equal protein*4 + carbs*4 + fat*9.',
    '- confidence is "low" when the portion or the dish is a guess, "high" for packaged or exactly measured food.',
    '- note: one short sentence about the main assumption to check, or "" if none.',
    '- If the input is not food at all, return an empty items list and explain in note.',
    '- Respond with JSON only.',
  ];
  if (knownFoods.length > 0) {
    lines.push(
      '',
      "The user's own saved foods (their corrected values). When the user mentions one of these, use these numbers, scaled to the amount they ate:",
      ...knownFoods.map(
        (f) =>
          `- ${f.name} (${f.portion || 'serving'}): ${Math.round(f.calories)} kcal, P ${round1(f.protein)} g, C ${round1(f.carbs)} g, F ${round1(f.fat)} g`,
      ),
    );
  }
  return lines.join('\n');
}

/** Lowercase, strip punctuation, collapse whitespace. Used to match foods by name and portion. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "1 serving", "one portion", "1" and blank all mean "the usual amount". */
const GENERIC_PORTION = /^(?:(?:1|one|a|an)\s*)?(?:serving|portion|x)?$/;

/** A portion worth showing or telling foods apart by; '' when it only says "one serving". */
export function portionLabel(portion: string): string {
  // normalize() keeps dots (for "1.5 cups"), so drop a trailing full stop before testing.
  return GENERIC_PORTION.test(normalize(portion).replace(/[.\s]+$/, '')) ? '' : portion.trim();
}

/**
 * A saved food's identity: its name plus a meaningful portion. "Rice, 1 cup" and "Rice, 2 cups"
 * are different foods; "Black coffee" and "Black coffee, 1 serving" are the same one.
 */
export function foodKey(name: string, portion: string): string {
  return `${normalize(name)}|${normalize(portionLabel(portion))}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toConfidence(v: unknown): Confidence {
  return v === 'low' || v === 'high' ? v : 'medium';
}

/** Pull the first JSON object out of a model reply, tolerating <think> blocks and code fences. */
export function extractJson(content: string): unknown {
  const cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('The AI reply did not contain JSON.');
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

let keySeq = 0;
export function newItemKey(): string {
  keySeq += 1;
  return `item-${Date.now().toString(36)}-${keySeq}`;
}

/** Validate and clean a model reply into items the review screen can show. */
export function parseMealResponse(content: string): ParsedMeal {
  const data = extractJson(content) as { items?: unknown; note?: unknown } | null;
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items: DraftItem[] = [];
  for (const raw of rawItems.slice(0, MAX_ITEMS)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name) continue;
    items.push({
      key: newItemKey(),
      name,
      portion: typeof r.portion === 'string' ? r.portion.trim() : '',
      calories: Math.round(toNumber(r.calories)),
      protein: round1(toNumber(r.protein)),
      carbs: round1(toNumber(r.carbs)),
      fat: round1(toNumber(r.fat)),
      confidence: toConfidence(r.confidence),
    });
  }
  const note = typeof data?.note === 'string' ? data.note.trim() : '';
  return { items, note };
}

/**
 * When an item matches a food the user has saved (same name and portion),
 * use the user's own numbers instead of the AI estimate.
 */
export function applySavedFoods(items: DraftItem[], saved: readonly SavedFood[]): DraftItem[] {
  if (saved.length === 0) return items;
  const byKey = new Map(saved.map((f) => [foodKey(f.name, f.portion), f]));
  return items.map((item) => {
    const match = byKey.get(foodKey(item.name, item.portion));
    if (!match) return item;
    return {
      ...item,
      name: match.name,
      portion: match.portion,
      calories: match.calories,
      protein: match.protein,
      carbs: match.carbs,
      fat: match.fat,
      confidence: 'high',
    };
  });
}
