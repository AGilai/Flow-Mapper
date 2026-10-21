// The marks of the open design environment (GET /marks): what is new / changed / removed per anchor.
// `createMarks(payload)` is pure (anchor lookup, field map, ghosts); `loadMarks()` fetches once per (env, draft, compare) and caches;
// `invalidateMarks()` after every draft edit, apply or discard. A sealed environment gets the empty store.

import { api } from '../api.js';
import { state, isDesign } from '../state.js';

const EMPTY = { against: 'baseline', draft: null, source: null, baselineAt: null, marks: {}, ghosts: {}, counts: {} };
const listeners = new Set();

/** `changes`: the draft's changes (GET /changes items) when a draft is open in Edit: `inDraft(anchor)` says an item was added by the draft. */
export function createMarks(p = EMPTY, changes = []) {
  const marks = p.marks ?? {}, ghosts = p.ghosts ?? {}, refs = p.refs ?? {}, added = new Set(changes.filter((c) => c.change === 'added').map((c) => c.anchor));
  const fieldMarks = (item) => {
    const out = new Map(), pre = `${item}#`;
    for (const [a, m] of Object.entries(marks)) if (a.startsWith(pre)) out.set(a.slice(pre.length), m);
    return out;
  };
  return {
    payload: p, against: p.against, source: p.source, baselineAt: p.baselineAt, counts: p.counts ?? {},
    empty: !Object.keys(marks).length && !Object.keys(ghosts).length,
    markOf: (anchor) => marks[anchor] ?? null,
    /** References (0.25.0): `refOf('ing:<s>/<id>')` -> {service, ingress, bindKey, source} | null; `componentRefs(svc)` -> {refs, endpoints} | null; `originOf(ing)` -> {from, at, imported, inDraft?} | null (an endpoint that came with its behaviour). */
    refOf: (anchor) => refs.endpoints?.[anchor] ?? null,
    componentRefs: (svc) => refs.components?.[`svc:${svc}`] ?? null,
    originOf: (anchor) => refs.origins?.[anchor] ?? null,
    inDraft: (anchor) => added.has(anchor),
    /** Anchors the draft removed: [{anchor, label}] (from /changes). */
    removedInDraft: (prefix) => changes.filter((c) => c.change === 'removed' && c.anchor.startsWith(prefix)),
    /** Removed items whose anchor starts with `prefix` (e.g. `egr:orders-svc/`): [{anchor, label, service?, type?}] in anchor order. */
    ghostsUnder: (prefix) => Object.entries(ghosts).filter(([a]) => a.startsWith(prefix)).map(([anchor, g]) => ({ anchor, ...g })),
    /** Field marks of one DTO / schema / event item: Map<fieldPath, MarkInfo> (a removed field is marked here; it is not in the content). */
    fieldMarks,
    /** Components with a service-level mark (of `kind`, or any): [{service, mark, what?}]. */
    components: (kind) => Object.entries(marks).filter(([a, m]) => a.startsWith('svc:') && (!kind || m.mark === kind)).map(([a, m]) => ({ service: a.slice(4), ...m })),
  };
}

const cache = new Map();
let current = createMarks();
/** The marks the page was drawn with (set by loadMarks): for components that cannot be handed the store, like the JSON viewer. */
export const marksNow = () => current;
const keyOf = () => `${state.env}|${state.draft ?? ''}|${state.compare}|${state.draft && state.mode === 'edit' ? 'e' : ''}`;
const changesOf = () => (state.draft && state.mode === 'edit' ? api.draftChanges(state.env, state.draft).then((c) => c.items, () => []) : Promise.resolve([]));

/** The marks store for the current env, draft and compare. Never throws: a failed load reads as no marks (the page still renders).
 *  Comparing with a source that is gone falls back to the baseline. */
export async function loadMarks() {
  if (!isDesign()) return (current = createMarks());
  const key = keyOf();
  if (!cache.has(key)) {
    cache.set(key, Promise.all([api.marks(state.env, state.compare).catch(async () => {
      if (state.compare !== 'source') return null;
      state.compare = 'baseline';
      return api.marks(state.env, 'baseline').catch(() => null);
    }), changesOf()]).then(([p, c]) => createMarks(p ?? EMPTY, c)));
  }
  current = await cache.get(key);
  return current;
}

/** Drop what was loaded (a draft edit, apply or discard changed it) and tell whoever listens. */
export function invalidateMarks() { cache.clear(); listeners.forEach((fn) => fn()); }
export const onMarks = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
