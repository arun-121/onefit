import type { Meal } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day as YYYY-MM-DD (not UTC). */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

/** Local midnight for a YYYY-MM-DD key. */
export function dateKeyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
  const d = dateKeyToDate(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Start (inclusive) and end (exclusive) of a local day, as Date objects. */
export function dayRange(key: string): { start: Date; end: Date } {
  const start = dateKeyToDate(key);
  const end = dateKeyToDate(addDays(key, 1));
  return { start, end };
}

/** Whole calendar days from one day key to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  // Rounded, because a daylight-saving change makes one local day 23 or 25 hours long.
  return Math.round((dateKeyToDate(to).getTime() - dateKeyToDate(from).getTime()) / 86_400_000);
}

/** True for a real calendar day written as YYYY-MM-DD (so not 2026-02-30). */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return toDateKey(dateKeyToDate(value)) === value;
}

/** Monday-first position in the week: 0 for Monday, 6 for Sunday. */
export function weekdayIndex(key: string): number {
  return (dateKeyToDate(key).getDay() + 6) % 7;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDayLabel(key: string, now: Date = new Date()): string {
  const today = todayKey(now);
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  const d = dateKeyToDate(key);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** A date inside a sentence: "23 Dec", with the year added when it is not this year. */
export function formatShortDate(key: string, now: Date = new Date()): string {
  const d = dateKeyToDate(key);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function formatTime(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Which meal a log at this time most likely belongs to. */
export function mealForTime(d: Date = new Date()): Meal {
  const minutes = d.getHours() * 60 + d.getMinutes();
  if (minutes >= 4 * 60 && minutes < 10 * 60 + 30) return 'breakfast';
  if (minutes >= 10 * 60 + 30 && minutes < 15 * 60 + 30) return 'lunch';
  if (minutes >= 15 * 60 + 30 && minutes < 18 * 60) return 'snack';
  if (minutes >= 18 * 60 && minutes < 23 * 60) return 'dinner';
  return 'snack';
}

/** A representative clock time for a meal, used when an entry is logged for a past day. */
export const MEAL_DEFAULT_HOUR: Record<Meal, number> = {
  breakfast: 8,
  lunch: 13,
  dinner: 20,
  snack: 16,
};
