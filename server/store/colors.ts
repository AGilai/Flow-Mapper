// The component colour assignment of an environment, stored in envs.colors ({component: slot}). Slots are kept for good: a component
// deleted and added again gets its old slot back (a deleted component's slot is not freed, so colours never move under people's eyes).

import type { DB } from '../db/connection.ts';
import { assignColors } from '../../core/colors.ts';

export function colorsOf(db: DB, env: string): Record<string, number> {
  const r = db.prepare('SELECT colors FROM envs WHERE name = ?').get(env) as { colors: string } | undefined;
  return r ? JSON.parse(r.colors || '{}') : {};
}

/** Give each named component a slot if it has none (in order), then store. `seed` first: a copy keeps its source's slots. */
export function assignColorsIn(db: DB, env: string, items: { name: string; kind?: string }[], seed: Record<string, number> = {}): Record<string, number> {
  // A copy keeps its source's slots, except where two of the copied components share one (the source had more than 8): those get new slots.
  const names = new Set(items.map((i) => i.name)), taken = new Set<number>(), kept: Record<string, number> = {};
  for (const [k, s] of Object.entries(seed)) if (names.has(k) && !taken.has(s)) { kept[k] = s; taken.add(s); }
  const cur = colorsOf(db, env), merged = { ...kept, ...cur };
  const next = assignColors(merged, items);
  if (JSON.stringify(next) !== JSON.stringify(cur)) db.prepare('UPDATE envs SET colors = ? WHERE name = ?').run(JSON.stringify(next), env);
  return next;
}

/** Every component of the environment (backfills environments from before the assignment existed, in the order they were first stored). */
export function ensureColors(db: DB, env: string, seed: Record<string, number> = {}): Record<string, number> {
  const rows = db.prepare('SELECT service AS name, kind FROM snapshots WHERE env = ? ORDER BY rowid').all(env) as { name: string; kind: string }[];
  return assignColorsIn(db, env, rows, seed);
}
