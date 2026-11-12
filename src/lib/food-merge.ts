/**
 * Merging saved foods that turn out to be the same food. Needed whenever the identity rule in
 * foodKey() changes: rows saved under the old rule keep their old key until they're re-keyed,
 * and two of them may now share one key.
 */
import { foodKey } from './ai-parse';

export interface FoodIdentity {
  id: number;
  name: string;
  portion: string;
  pinned: boolean;
  useCount: number;
  lastUsedAt: number;
}

export interface FoodMergePlan {
  /** One row per food, with its current key and the combined usage of everything merged into it. */
  keep: { id: number; foodKey: string; pinned: boolean; useCount: number; lastUsedAt: number }[];
  /** Rows to delete because another row now stands for the same food. */
  remove: number[];
}

/**
 * Group rows by today's key. The most recently used row survives, because its name, portion and
 * numbers are the user's latest; it takes the group's total use count and stays pinned if any
 * row in the group was pinned.
 */
export function planFoodMerge(rows: readonly FoodIdentity[]): FoodMergePlan {
  const groups = new Map<string, FoodIdentity[]>();
  for (const row of rows) {
    const key = foodKey(row.name, row.portion);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const plan: FoodMergePlan = { keep: [], remove: [] };
  for (const [key, group] of groups) {
    const [keeper, ...rest] = [...group].sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.id - a.id);
    plan.keep.push({
      id: keeper.id,
      foodKey: key,
      pinned: group.some((r) => r.pinned),
      useCount: group.reduce((n, r) => n + r.useCount, 0),
      lastUsedAt: keeper.lastUsedAt,
    });
    plan.remove.push(...rest.map((r) => r.id));
  }
  return plan;
}
