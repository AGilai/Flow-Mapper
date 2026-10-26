// The numbered steps of a lane (0.20.0), pure. A step is one arrow that starts something, in run order: a call (into a service or to a
// plain lifeline), one row of a publish (the trunk, or a branch to a queue), a call that matches nothing, a data-store stub.
// Returns, middleware and internal-call pills, the AMQP "does not route" note and the frontier marker are not steps.
// Steps are numbered for the top lane only; the lanes of open async cards are not. The step's key is built from the message
// content (core/description.ts stepKeys), never from its row, so a redraw or an inserted arrow does not move a description.

import { stepLabel } from './flow-stores-pure.js';

// Pure web modules cannot import core/*.js in node tests (those are .ts there), so the caller hands over stepKeys.

const STEP_TYPES = new Set(['call', 'hop', 'unresolved', 'store', 'icall']); // icall (0.38.0): a call inside a service, drawn only when the view holds the internal calls
export const isStep = (e) => STEP_TYPES.has(e.type) && !!e.msg && !e.msg.unfoldOf; // 0.44.0: the copies an `unfold` draws under a repeat marker are sub-steps (7.1, 7.2), not numbered steps

/** The step number the lane draws for a message index `repeatOf` (1-based, over the trace's messages without `unfoldOf` copies): the lane numbers only what it draws, so an undrawn leaf note
 *  before it shifts the two apart (#92). Falls back to `repeatOf` when the target is not a drawn step. `events`: lane.events. */
export function drawnStep(events, messages, repeatOf) {
  const target = messages.filter((m) => !m.unfoldOf)[repeatOf - 1], i = events.filter(isStep).findIndex((e) => e.msg === target);
  return target && i >= 0 ? i + 1 : repeatOf;
}

/** stepsOf(lane, stepKeys, all) -> [{ n (1-based), row, event, key, label, from, to, transport }]. from / to: display names ("pop-edge", "orders-queue"). */
export function stepsOf(lane, stepKeys, all = null) {
  const evs = lane.events.filter(isStep);
  // `~2` for a repeat is counted over ALL the trace's messages (`all`), so hiding stores or deep calls never moves a description to another arrow.
  // 0.38.0: a message of a trace view carries its `key` (stamped once on the canonical trace: choosing an arm or the detail never re-keys); only a trace without keys is keyed here.
  const byMsg = new Map(), full = all && !all.every((m) => m.key) ? stepKeys(all) : [];
  full.forEach((k, i) => byMsg.set(all[i], k));
  const own = evs.every((e) => e.msg.key) ? [] : stepKeys(evs.map((e) => e.msg)), keys = evs.map((e, i) => e.msg.key ?? byMsg.get(e.msg) ?? own[i]);
  return evs.map((e, i) => ({ n: i + 1, row: e.row, event: e, key: keys[i], ...(e.msg.dbGroup ? { keys: e.msg.dbGroup.members } : {}), label: labelOf(e), ...ends(e), transport: e.type === 'hop' ? e.transport : e.tr ?? e.msg.transport ?? null }));
}

const name = (c) => (c?.service ?? c?.label ?? '?');
function labelOf(e) {
  if (e.type === 'store') return stepLabel(e.msg); // the full operation and collection, so a folded store's step stays readable
  return Array.isArray(e.label) ? e.label.join(' ') : e.label;
}
function ends(e) {
  if (e.type === 'store') return { from: name(e.bar.col), to: e.col.store }; // the store; the collection is in the label
  if (e.type === 'unresolved') return { from: name(e.bar.col), to: 'unresolved' };
  return { from: name(e.from), to: name(e.to) };
}

/** The step drawn on a lane row (or null). */
export const stepAtRow = (steps, row) => steps.find((s) => s.row === row) ?? null;
/** The step a stored key belongs to (kept across redraws), or null. */
export const stepByKey = (steps, key) => steps.find((s) => s.key === key || s.keys?.includes(key)) ?? null; // a collapsed DB group (0.38.0) stands for every operation in it

/** The columns at the two ends of a step's arrow: [from, to]; a missing target has no component column at the far end. */
export const stepCols = (e) => (e.type === 'unresolved' ? [e.bar.col, null] : [e.from, e.to]);
