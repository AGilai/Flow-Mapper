// "Back to the main flow" from a sub-flow, pure. A sub-flow is any tab opened from another one: an async consumer (`queue/handler@origin`),
// a full flow started from there (`full:...@origin`), or a zoom-in / "open the async flow" tab (`service/ingress!intra`, `fn:...`), which carries no origin
// in its key, so the view remembers it: `from` is a Map key -> { key, step } filled when a tab is opened from the active one. No DOM.

import { originOf } from './flow-tabs-state.js';

/** The tab a flow was opened from, with the step to land on: { key, step } | null. A remembered opening wins; a key with an origin is the fallback (no step). */
export function backTarget(key, from) {
  const f = from?.get(key);
  if (f && f.key && f.key !== key) return { key: f.key, step: f.step >= 1 ? f.step : null };
  const o = key ? originOf(key) : null;
  return o ? { key: o, step: null } : null;
}

/** Remember that `key` was opened from `parent` at `step` (a new Map; opening a tab from itself or from nothing changes nothing). */
export function noteOpened(from, key, parent, step) {
  if (!key || !parent || key === parent) return from;
  const next = new Map(from);
  next.set(key, { key: parent, step: step >= 1 ? step : null });
  return next;
}
