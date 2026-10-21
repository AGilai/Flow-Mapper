// Helpers for the pure diff tests: the mini system as ItemRows and small ways to change a copy of it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ItemRow } from '../core/item-rows.ts';
import { diffEnv, type DiffOpts } from '../core/diff/index.ts';

export const mini = (): ItemRow[] => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/diff/mini.json'), 'utf8'));
export const row = (rows: ItemRow[], service: string, list: string, key: string): ItemRow => rows.find((r) => r.service === service && r.list === list && r.key === key)!;
export const without = (rows: ItemRow[], service: string, list: string, key: string) => rows.filter((r) => r !== row(rows, service, list, key));
export const withRow = (rows: ItemRow[], r: ItemRow) => [...rows.filter((x) => !(x.service === r.service && x.list === r.list && x.key === r.key)), r];
export const diff = (base: ItemRow[], cur: ItemRow[], opts: Partial<DiffOpts> = {}) => diffEnv(base, cur, { against: 'baseline', ...opts });
export const mut = (rows: ItemRow[], service: string, list: string, key: string, f: (d: any) => void): ItemRow[] => {
  const copy = structuredClone(rows), r = row(copy, service, list, key);
  f(r.data);
  return copy;
};
export const marksOf = (m: ReturnType<typeof diff>) => Object.fromEntries(Object.entries(m.marks).map(([a, x]) => [a, x.mark]));
