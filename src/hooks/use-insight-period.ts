import { useSyncExternalStore } from 'react';

import { isInsightPeriod, type InsightPeriod } from '@/lib/insights';

/**
 * The period the Progress tab shows: 7, 30 or 90 days. It lives outside the screen, so it is
 * remembered for as long as the app is open (leaving the tab and coming back keeps it), and it
 * starts at a month each time the app starts: the view the tab is built around.
 */
let period: InsightPeriod = 30;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getPeriod = (): InsightPeriod => period;

/** Switch the period. Anything that is not 7, 30 or 90 is ignored. */
export function setInsightPeriod(next: unknown): void {
  if (!isInsightPeriod(next) || next === period) return;
  period = next;
  listeners.forEach((listener) => listener());
}

export function useInsightPeriod(): InsightPeriod {
  return useSyncExternalStore(subscribe, getPeriod, getPeriod);
}
