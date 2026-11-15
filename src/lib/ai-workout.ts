/**
 * Pure helpers for logging a workout by describing it ("bench press 4x10 at 60 kg, 20 min run"):
 * the prompt, the JSON schema Groq must follow, and validation of whatever comes back.
 *
 * The model reads the description and works out, for each exercise, how long it took and how hard
 * it was as a MET value from the Compendium of Physical Activities. The calories are then worked out
 * here from the MET, the minutes and the owner's weight (see `burnFromMet`), the same way for every
 * workout, so the model never hands back a calorie figure the app cannot explain.
 */
import { extractJson, newItemKey } from './ai-parse';
import { ACTIVITY_ORDER, burnFromMet, INTENSITY_ORDER, isActivity, isIntensity, type Activity, type Intensity } from './exercise';
import type { Confidence } from './types';

/** One exercise from a description, before it is logged. */
export interface WorkoutDraft {
  key: string;
  /** "Bench press", "Easy run". */
  name: string;
  /** What was done, in the owner's terms: "4 × 10 at 60 kg", "5 km". Empty when nothing more was said. */
  details: string;
  /** The nearest of the app's activities, for the icon, Progress and Health Connect. */
  activity: Activity;
  intensity: Intensity;
  minutes: number;
  /** Metabolic equivalent for this exercise at this effort. */
  met: number;
  sets: number | null;
  reps: number | null;
  loadKg: number | null;
  /** Active calories, from the MET, the minutes and the body weight. */
  calories: number;
  confidence: Confidence;
}

export interface ParsedWorkout {
  items: WorkoutDraft[];
  /** The main assumption to check (usually the time), or ''. */
  note: string;
}

const MAX_ITEMS = 20;
const MAX_MINUTES = 600;
/** The Compendium runs from about 1.3 (sitting) to 23 (running very fast). */
const MIN_MET = 1.3;
const MAX_MET = 23;

/** Strict JSON schema for Groq structured outputs (every property required, no extras). */
export const WORKOUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'note'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'details', 'activity', 'intensity', 'minutes', 'met', 'sets', 'reps', 'load_kg', 'confidence'],
        properties: {
          name: { type: 'string', description: 'Short exercise name, e.g. "Bench press", "Treadmill run"' },
          details: { type: 'string', description: 'What was done, e.g. "4 x 10 at 60 kg", "5 km", or ""' },
          activity: { type: 'string', enum: ACTIVITY_ORDER },
          intensity: { type: 'string', enum: INTENSITY_ORDER },
          minutes: { type: 'number', description: 'Time spent on this exercise including rest between sets' },
          met: { type: 'number', description: 'MET for this exercise at this effort, from the Compendium of Physical Activities' },
          sets: { type: ['number', 'null'] },
          reps: { type: ['number', 'null'], description: 'Reps per set' },
          load_kg: { type: ['number', 'null'], description: 'Weight lifted per rep in kg, or null' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
    note: { type: 'string', description: 'One short sentence on the main assumption to check, or ""' },
  },
} as const;

export function buildWorkoutPrompt(weightKg: number): string {
  return [
    'You are an exercise logging assistant inside a personal fitness tracker.',
    `The user weighs about ${Math.round(weightKg)} kg. Turn the workout they describe into a list of exercises.`,
    'Rules:',
    '- One item per distinct exercise. Keep the user\'s own words for the name where they are clear.',
    '- details: sets, reps, load, distance or pace as the user gave them, e.g. "4 x 10 at 60 kg", "5 km in 28 min". "" if nothing more.',
    '- minutes: the time the exercise took. Use the time the user gives. Otherwise estimate it: for strength work about',
    '  40 seconds per set of 10 reps plus the rest between sets (about 90 seconds, 2 to 3 minutes for heavy sets of 5 or fewer);',
    '  for distance work, from the distance at a typical pace for the effort described.',
    '- met: the MET value from the 2024 Compendium of Physical Activities for this exact activity and effort, averaged over the',
    '  minutes including rest. Resistance training is usually 3.5 (light, many reps) to 6 (heavy compound lifts); a 10 km/h run is about 9.8.',
    '- activity: the closest of walk, run, cycle, strength, yoga, swim, sport, other. intensity: light, moderate or hard.',
    '- sets, reps, load_kg: numbers when given, else null. For bodyweight exercises load_kg is null.',
    '- confidence: "high" when the time was given, "medium" when it was worked out from sets or distance, "low" when guessed.',
    '- note: one short sentence on the main assumption to check (usually the time), or "".',
    '- If the input is not exercise at all, return an empty items list and say so in note.',
    '- Respond with JSON only.',
  ].join('\n');
}

function positive(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toConfidence(v: unknown): Confidence {
  return v === 'low' || v === 'high' ? v : 'medium';
}

/** Validate and clean a model reply into workout items, with calories worked out for `weightKg`. */
export function parseWorkoutResponse(content: string, weightKg: number): ParsedWorkout {
  const data = extractJson(content) as { items?: unknown; note?: unknown } | null;
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items: WorkoutDraft[] = [];
  for (const raw of rawItems.slice(0, MAX_ITEMS)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const minutes = positive(r.minutes);
    const met = positive(r.met);
    if (!name || minutes === null || met === null) continue;
    const m = Math.min(MAX_MINUTES, Math.max(1, Math.round(minutes)));
    const metValue = Math.round(Math.min(MAX_MET, Math.max(MIN_MET, met)) * 10) / 10;
    const sets = positive(r.sets);
    const reps = positive(r.reps);
    items.push({
      key: newItemKey(),
      name,
      details: typeof r.details === 'string' ? r.details.trim() : '',
      activity: isActivity(r.activity) ? r.activity : 'other',
      intensity: isIntensity(r.intensity) ? r.intensity : 'moderate',
      minutes: m,
      met: metValue,
      sets: sets === null ? null : Math.round(sets),
      reps: reps === null ? null : Math.round(reps),
      loadKg: positive(r.load_kg),
      calories: burnFromMet(metValue, m, weightKg),
      confidence: toConfidence(r.confidence),
    });
  }
  const note = typeof data?.note === 'string' ? data.note.trim() : '';
  return { items, note };
}
