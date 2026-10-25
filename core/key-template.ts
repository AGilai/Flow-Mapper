// #86: the key template of a Redis resource step. `details.keyTemplate` is the documented field; `details.keyPattern` is accepted as an
// alias (a harvester already sends it); keyTemplate wins. A value shaped `{unresolved:<reasons>}` is not a key: it names why the key is unknown. Pure.

import type { Step } from './types.ts';

const UNRESOLVED = /^\{unresolved:(.*)\}$/s;
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');

/** The key a step names and, when the value is the `{unresolved:a,b}` form, the reasons (then `key` is null). Neither field: no key, no reasons. */
export function keyTemplateOf(st: Pick<Step, 'details'>): { key: string | null; unresolved: string[] } {
  const raw = text(st.details?.keyTemplate) || text(st.details?.keyPattern);
  if (!raw) return { key: null, unresolved: [] };
  const m = UNRESOLVED.exec(raw);
  if (!m) return { key: raw, unresolved: [] };
  const reasons = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  return { key: null, unresolved: reasons.length ? reasons : ['unresolved'] };
}

/** The fields a resource step adds to its trace message: `keyTemplate`, `dbIndex`, `ttlSeconds`, `keyUnresolved`; absent ones are omitted. */
export function keyFieldsOn(st: Step) {
  const { key, unresolved } = keyTemplateOf(st);
  const d = st.details;
  return {
    ...(key ? { keyTemplate: key } : {}), ...(unresolved.length ? { keyUnresolved: unresolved } : {}),
    ...(typeof d?.dbIndex === 'number' ? { dbIndex: d.dbIndex } : {}), ...(typeof d?.ttlSeconds === 'number' ? { ttlSeconds: d.ttlSeconds } : {}),
  };
}
