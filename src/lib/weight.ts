/**
 * Weigh-in rules and formatting. Pure (no native code) so it is easy to test.
 */
import type { WeightEntry } from './types';

/** Anything outside this range is a typing mistake or a broken reading, not a body weight. */
export const MIN_WEIGHT_KG = 20;
export const MAX_WEIGHT_KG = 400;
/** The weight sheet moves in steps of this size. */
export const WEIGHT_STEP_KG = 0.1;

export function isValidWeightKg(kg: unknown): kg is number {
  return typeof kg === 'number' && Number.isFinite(kg) && kg >= MIN_WEIGHT_KG && kg <= MAX_WEIGHT_KG;
}

/** Round to a number of decimals without the floating-point tail (72.30000000000001). */
export function roundKg(kg: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(kg * f) / f;
}

/** Keep a typed or stepped weight inside the allowed range, on the 0.1 kg grid. */
export function clampWeightKg(kg: number): number {
  if (!Number.isFinite(kg)) return MIN_WEIGHT_KG;
  return roundKg(Math.min(MAX_WEIGHT_KG, Math.max(MIN_WEIGHT_KG, kg)));
}

/** "78.4 kg" */
export function formatKg(kg: number): string {
  return `${roundKg(kg).toFixed(1)} kg`;
}

/** "Down 0.4 kg", "Up 1.2 kg" or "No change" for a difference in weight. */
export function formatKgChange(deltaKg: number): string {
  const rounded = roundKg(deltaKg);
  if (rounded === 0) return 'No change';
  return `${rounded < 0 ? 'Down' : 'Up'} ${Math.abs(rounded).toFixed(1)} kg`;
}

// ---------------------------------------------------------------- reading other apps' weigh-ins

/** A weight record made by another app (a smart scale, Google Fit), as read from Health Connect. */
export interface HealthWeightSample {
  recordId: string;
  /** When it was measured, in milliseconds since the epoch. */
  time: number;
  /** The local calendar day it was measured on. */
  date: string;
  kg: number;
}

export interface WeightImport {
  date: string;
  kg: number;
  recordId: string;
}

/**
 * Decide which of another app's weigh-ins to copy in. A day the user weighed in by hand is never
 * touched, a day whose imported weigh-in the user deleted stays deleted, and when another app has
 * several readings for a day the last one wins, the same rule as a second manual weigh-in.
 */
export function planWeightImport(
  existing: readonly Pick<WeightEntry, 'date' | 'kg' | 'source' | 'hcRecordId'>[],
  samples: readonly HealthWeightSample[],
  dismissedDates: readonly string[] = [],
): WeightImport[] {
  const current = new Map(existing.map((w) => [w.date, w]));
  const dismissed = new Set(dismissedDates);
  const latest = new Map<string, HealthWeightSample>();
  for (const s of samples) {
    if (!s.recordId || !isValidWeightKg(s.kg) || !Number.isFinite(s.time)) continue;
    const seen = latest.get(s.date);
    if (!seen || s.time >= seen.time) latest.set(s.date, s);
  }
  const plan: WeightImport[] = [];
  for (const s of latest.values()) {
    if (dismissed.has(s.date)) continue;
    const kg = roundKg(s.kg, 2);
    const have = current.get(s.date);
    if (have?.source === 'manual') continue;
    if (have && have.hcRecordId === s.recordId && Math.abs(have.kg - kg) < 0.005) continue;
    plan.push({ date: s.date, kg, recordId: s.recordId });
  }
  return plan.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
