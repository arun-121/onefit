import { useEffect, useState, useSyncExternalStore } from 'react';

import { todayKey } from '@/lib/dates';
import { getVersion, subscribe } from '@/lib/db';
import { getHealthGrants, readDayActivity, type DayActivity } from '@/lib/health';

/** Re-renders whenever the database changes. */
export function useDbVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

function sameKeys(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

/**
 * Run a synchronous SQLite query and re-run it whenever the data changes.
 * `deps` are the query's own inputs (e.g. the date).
 */
export function useLiveQuery<T>(query: () => T, deps: readonly unknown[]): T {
  // The query reads external mutable data (SQLite), so the React Compiler must not cache its result.
  'use no memo';
  const version = useDbVersion();
  const key = [version, ...deps];
  const [cache, setCache] = useState(() => ({ key, value: query() }));
  if (!sameKeys(cache.key, key)) {
    // Data or inputs changed: re-query during render (React's "adjust state on prop change" pattern).
    const value = query();
    setCache({ key, value });
    return value;
  }
  return cache.value;
}

/** Today's date key; re-evaluated whenever data changes or the app returns to the foreground. */
export function useToday(): string {
  'use no memo';
  useDbVersion();
  return todayKey();
}

/** Steps and active calories for a day from Health Connect, or null when off or unavailable. */
export function useDayActivity(date: string, enabled: boolean): DayActivity | null {
  const version = useDbVersion();
  const [activity, setActivity] = useState<DayActivity | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await readDayActivity(date, await getHealthGrants());
        if (!cancelled) setActivity(result);
      } catch {
        if (!cancelled) setActivity(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, enabled, version]);
  return enabled ? activity : null;
}
