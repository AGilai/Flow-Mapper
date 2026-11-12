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

/** One key of a step that touches several (#108): `details.keys[]` in key order. Absent fields are omitted. */
export interface KeyRef { keyIdx: number; keyTemplate?: string; dbIndex?: number; ttlSeconds?: number; keyVariants?: string[]; keyUnresolved?: string[] }

const variantsOf = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map(text).filter(Boolean))] : []);
const reasonsOf = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => text(typeof x === 'string' ? x : (x as any)?.reason)).filter(Boolean);

/**
 * #108: the keys one step touches, from `details.keys` (an array of `{keyIdx, keyTemplate?, dbIndex?, ttlSeconds?, keyVariants?, keyUnresolved?}`), in the order sent.
 * `keyIdx` defaults to the position; a `{unresolved:...}` template becomes `keyUnresolved`; an entry with nothing in it is dropped. No array: no keys.
 */
export function keyRefsOf(st: Pick<Step, 'details'>): KeyRef[] {
  const list = st.details?.keys;
  if (!Array.isArray(list)) return [];
  return list.flatMap((e: any, i: number): KeyRef[] => {
    if (!e || typeof e !== 'object') return [];
    const { key, unresolved } = keyTemplateOf({ details: { keyTemplate: e.keyTemplate, keyPattern: e.keyPattern } });
    const why = [...new Set([...unresolved, ...reasonsOf(e.keyUnresolved)])], vars = variantsOf(e.keyVariants);
    const r: KeyRef = { keyIdx: Number.isInteger(e.keyIdx) ? e.keyIdx : i, ...(key ? { keyTemplate: key } : {}), ...(Number.isInteger(e.dbIndex) ? { dbIndex: e.dbIndex } : {}),
      ...(typeof e.ttlSeconds === 'number' ? { ttlSeconds: e.ttlSeconds } : {}), ...(vars.length ? { keyVariants: vars } : {}), ...(why.length ? { keyUnresolved: why } : {}) };
    return key || why.length || vars.length || r.dbIndex != null || r.ttlSeconds != null ? [r] : [];
  });
}

/** Every key a step names, with the db and TTL of that key (its own, else the step's): the singular `details.keyTemplate` first, then each `details.keys[]` entry. A template named twice is one use. */
export function keyUsesOf(st: Pick<Step, 'details'>): { keyTemplate: string; dbIndex?: number; ttlSeconds?: number }[] {
  const d = st.details, own = keyTemplateOf(st).key, uses = new Map<string, { keyTemplate: string; dbIndex?: number; ttlSeconds?: number }>();
  const dbOf = (v: unknown) => (Number.isInteger(v) ? (v as number) : undefined), ttlOf = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const add = (keyTemplate: string, dbIndex?: number, ttlSeconds?: number) => { if (!uses.has(keyTemplate)) uses.set(keyTemplate, { keyTemplate, ...(dbIndex != null ? { dbIndex } : {}), ...(ttlSeconds != null ? { ttlSeconds } : {}) }); };
  if (own) add(own, dbOf(d?.dbIndex), ttlOf(d?.ttlSeconds));
  for (const k of keyRefsOf(st)) if (k.keyTemplate) add(k.keyTemplate, k.dbIndex ?? dbOf(d?.dbIndex), k.ttlSeconds ?? ttlOf(d?.ttlSeconds));
  return [...uses.values()];
}

/**
 * The fields a resource step adds to its trace message: `keyTemplate`, `dbIndex`, `ttlSeconds`, `keyUnresolved`, `keyVariants` and, for a multi-key step (#108), `keys`; absent ones are omitted.
 * The singular fields are what the step says itself, else `keys[0]`'s, so a reader that knows only them keeps working.
 */
export function keyFieldsOn(st: Step) {
  const { key, unresolved } = keyTemplateOf(st), keys = keyRefsOf(st), k0 = keys[0], d = st.details;
  const variants = variantsOf(d?.keyVariants), vars = variants.length ? variants : k0?.keyVariants ?? [];
  const tpl = key ?? (!unresolved.length ? k0?.keyTemplate : undefined), why = unresolved.length ? unresolved : k0?.keyUnresolved ?? [];
  const db = typeof d?.dbIndex === 'number' ? d.dbIndex : k0?.dbIndex, ttl = typeof d?.ttlSeconds === 'number' ? d.ttlSeconds : k0?.ttlSeconds;
  return {
    ...(tpl ? { keyTemplate: tpl } : {}), ...(why.length && !tpl ? { keyUnresolved: why } : {}), ...(vars.length ? { keyVariants: vars } : {}),
    ...(db != null ? { dbIndex: db } : {}), ...(ttl != null ? { ttlSeconds: ttl } : {}), ...(keys.length ? { keys } : {}),
  };
}
