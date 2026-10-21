// Assumed values (#47, 0.25.2): a value a harvester filled by a rule (client default, convention, name), not from code.
// The mirror of `unresolved`: same slots, same `what` / `detail` convention. Pure; shown, listed and counted, never resolved.

import type { Assumed } from './types.ts';

/** The field an entry is about: its `detail` path for what=detail (`details.dbIndex`), else `what` (`database`). */
export const assumedField = (a: Pick<Assumed, 'what' | 'detail'>) => (a.what === 'detail' ? a.detail?.trim() ?? '' : a.what);

/** Hover text: what the value rests on and why. */
export const assumedTitle = (a: Pick<Assumed, 'basis' | 'reason'>) => `Assumed, not read from code. Basis: ${a.basis}. ${a.reason}`;

/** The entry for one field path (`client.databases`, or a bare `what` such as `database`), if any. */
export const assumedFor = (list: Assumed[] | undefined, path: string) => (list ?? []).find((a) => assumedField(a) === path);

/** Entries whose path starts with `prefix`; `field` is the path after the prefix when it ends with a dot. */
export const assumedUnder = (list: Assumed[] | undefined, prefix: string) =>
  (list ?? []).filter((a) => assumedField(a).startsWith(prefix)).map((a) => ({ ...a, field: assumedField(a).slice(prefix.endsWith('.') ? prefix.length : 0) }));

/** Count per basis of a list (health). */
export const byBasis = (xs: { basis: string }[]) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x.basis]: (m[x.basis] ?? 0) + 1 }), {});

/** Check one entry of a hand-written list (key entries). Returns the problem, or null. */
export function assumedProblem(a: unknown): string | null {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 'each entry must be an object';
  const o = a as Record<string, unknown>;
  if (typeof o.what !== 'string' || !o.what.trim()) return 'what must be a non-empty string';
  if (!('value' in o)) return 'value is required (the value actually used)';
  if (typeof o.basis !== 'string' || !o.basis.trim()) return 'basis must be a non-empty string';
  if (typeof o.reason !== 'string' || !o.reason.trim()) return 'reason must be a non-empty string';
  if (o.detail !== undefined && typeof o.detail !== 'string') return 'detail must be a string';
  return null;
}
