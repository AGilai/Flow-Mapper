// The subsystems of the open environment (GET /subsystems, with `?draft=` through api.js): the settings rows in order and the components in each.
// `createSubsystems(payload)` is pure (`subOf`, `info`, `list`); `loadSubsystems()` fetches once per (env, draft) and caches until a draft edit,
// an apply or a discard (the marks store tells: `onMarks`). Never throws: a failed load reads as no subsystems.

import { api } from '../api.js';
import { state } from '../state.js';
import { onMarks } from './marks-store.js';

const EMPTY = { levels: ['Subsystem', 'Component'], subsystems: [], notSet: [] };

/** createSubsystems(payload) -> { levels, list(), info(key), subOf(service), has, assigned, notSet }. `has`: the environment has subsystems; `assigned`: some component is in one. A component has ONE subsystem (0.28.0): the key of the box that lists it, '' for none. */
export function createSubsystems(p = EMPTY) {
  const list = p.subsystems ?? [], of = new Map(), of2 = new Map(), names2 = new Map();
  for (const s of list) {
    for (const c of s.components ?? []) { of.set(c.name, s.key); if (c.sub) of2.set(c.name, `${s.key}/${c.sub}`); }
    for (const x of s.subs ?? []) names2.set(x.key, x.label);
  }
  return {
    payload: p, levels: p.levels?.length ? p.levels : EMPTY.levels, notSet: p.notSet ?? [], has: list.length > 0, assigned: list.some((s) => s.components?.length > 0),
    list: () => list,
    info: (key) => list.find((s) => s.key === key) ?? null,
    subOf: (service) => of.get(service) ?? '',
    /** 0.50.0: the second level of a component's groupPath as a full key (`platform/gcp`), '' for none; `subLabel`: its registered name, else the segment. */
    subOf2: (service) => of2.get(service) ?? '',
    subLabel: (key) => names2.get(key) ?? key.split('/')[1] ?? key,
    labelOf: (key) => list.find((s) => s.key === key)?.label ?? key,
  };
}

const cache = new Map();
onMarks(() => cache.clear());
const keyOf = (env) => `${env}|${env === state.env ? state.draft ?? '' : ''}`; // the open draft belongs to the page's env only

/** The subsystems store for the current env and draft, or (given another env, 0.36.0) that env's committed state. */
export async function loadSubsystems(env = state.env) {
  const key = keyOf(env);
  if (!cache.has(key)) cache.set(key, api.subsystems(env).then(createSubsystems, () => createSubsystems()));
  return cache.get(key);
}
export const invalidateSubsystems = () => cache.clear();
