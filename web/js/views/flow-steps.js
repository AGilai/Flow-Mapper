// The numbered steps of a lane (0.20.0), pure. A step is one arrow that starts something, in run order: a call (into a service or to a
// plain lifeline), one row of a publish (the trunk, or a branch to a queue), a call that matches nothing, a data-store stub.
// Returns, middleware and internal-call pills, the AMQP "does not route" note and the frontier marker are not steps.
// Steps are numbered for the top lane only; the lanes of open async cards are not. The step's key is built from the message
// content (core/description.ts stepKeys), never from its row, so a redraw or an inserted arrow does not move a description.

// Pure web modules cannot import core/*.js in node tests (those are .ts there), so the caller hands over stepKeys.

const STEP_TYPES = new Set(['call', 'hop', 'unresolved', 'store']);
export const isStep = (e) => STEP_TYPES.has(e.type) && !!e.msg;

/** stepsOf(lane, stepKeys, all) -> [{ n (1-based), row, event, key, label, from, to, transport }]. from / to: display names ("pop-edge", "orders-queue"). */
export function stepsOf(lane, stepKeys, all = null) {
  const evs = lane.events.filter(isStep);
  // `~2` for a repeat is counted over ALL the trace's messages (`all`), so hiding stores or deep calls never moves a description to another arrow.
  const byMsg = new Map(), full = all ? stepKeys(all) : [];
  full.forEach((k, i) => byMsg.set(all[i], k));
  const own = stepKeys(evs.map((e) => e.msg)), keys = evs.map((e, i) => byMsg.get(e.msg) ?? own[i]);
  return evs.map((e, i) => ({ n: i + 1, row: e.row, event: e, key: keys[i], label: labelOf(e), ...ends(e), transport: e.type === 'hop' ? e.transport : e.tr ?? e.msg.transport ?? null }));
}

const name = (c) => (c?.service ?? c?.label ?? '?');
function labelOf(e) {
  if (e.type === 'store') return e.verb; // the target is the end of the arrow: shown once, in the ends
  return Array.isArray(e.label) ? e.label.join(' ') : e.label;
}
function ends(e) {
  if (e.type === 'store') return { from: name(e.bar.col), to: e.name };
  if (e.type === 'unresolved') return { from: name(e.bar.col), to: 'unresolved' };
  return { from: name(e.from), to: name(e.to) };
}

/** The step drawn on a lane row (or null). */
export const stepAtRow = (steps, row) => steps.find((s) => s.row === row) ?? null;
/** The step a stored key belongs to (kept across redraws), or null. */
export const stepByKey = (steps, key) => steps.find((s) => s.key === key) ?? null;

/** The columns at the two ends of a step's arrow: [from, to]; a store stub or a missing target has no component column at the far end. */
export const stepCols = (e) => (e.type === 'store' || e.type === 'unresolved' ? [e.bar.col, null] : [e.from, e.to]);
