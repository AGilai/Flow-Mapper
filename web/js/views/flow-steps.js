// The numbered steps of a lane (0.20.0), pure. A step is one arrow that starts something, in run order: a call (into a service or to a
// plain lifeline), one row of a publish (the trunk, or a branch to a queue), a call that matches nothing, a data-store stub.
// Returns, middleware and internal-call pills, the AMQP "does not route" note and the frontier marker are not steps.
// Steps are numbered for the top lane only; the lanes of open async cards are not. The step's key is built from the message
// content (core/description.ts stepKeys), never from its row, so a redraw or an inserted arrow does not move a description.

// Pure web modules cannot import core/*.js in node tests (those are .ts there), so the caller hands over stepKeys.

const STEP_TYPES = new Set(['call', 'hop', 'unresolved', 'store']);
export const isStep = (e) => STEP_TYPES.has(e.type) && !!e.msg;

/** stepsOf(lane, stepKeys) -> [{ n (1-based), row, event, key, label, from, to, transport }]. from / to: display names ("pop-edge", "orders-queue"). */
export function stepsOf(lane, stepKeys) {
  const evs = lane.events.filter(isStep);
  const keys = stepKeys(evs.map((e) => e.msg));
  return evs.map((e, i) => ({ n: i + 1, row: e.row, event: e, key: keys[i], label: labelOf(e), ...ends(e), transport: e.type === 'hop' ? e.transport : e.tr ?? e.msg.transport ?? null }));
}

const name = (c) => (c?.service ?? c?.label ?? '?');
function labelOf(e) {
  if (e.type === 'store') return `${e.verb} ${e.name}`;
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
