// Pure helpers for the sequence view: which arrows end in an "open the async flow" dot, and where
// the extra vertical gaps between async sub-flows go. No DOM, so tests can import it.

/** The consumer flow an async delivery opens: { service, ingress } or null (not a delivery, broken, unhandled, no target). */
export function asyncFlowOf(m) {
  if (m.kind !== 'deliver' || m.broken || m.unhandled || m.gap || !m.target?.service || !m.target?.ingress) return null;
  return { service: m.target.service, ingress: m.target.ingress };
}

/**
 * Rows that get an extra half-row of space above them (a set of row numbers):
 *  - the first row of each delivery's subtree when it is not drawn right under its delivery, as after a fan-out
 *    (deliveries first, then each consumer's subtree in order);
 *  - the first row of a repeat delivery ("↩ step N").
 * Never row 0.
 */
export function gapRows(msgs, rows) {
  const gaps = new Set();
  const firstOfRow = (i) => i === 0 || rows[i - 1] !== rows[i];
  msgs.forEach((m, i) => {
    if (!asyncFlowOf(m)) return;
    if (m.repeatOf) {
      if (rows[i] > 0) gaps.add(rows[i]);
      return;
    }
    const j = msgs.findIndex((x, k) => k > i && x.from === m.to && x.depth === m.depth + 1 && !x.delivery);
    if (j > i + 1 && firstOfRow(j) && rows[j] > 0) gaps.add(rows[j]);
  });
  return gaps;
}

/** Cumulative gap count per row 0..count: `out[r]` gaps lie above row r (inclusive). */
export function gapsAbove(gaps, count) {
  const out = [];
  for (let r = 0, n = 0; r <= count; r++) { if (gaps.has(r)) n++; out[r] = n; }
  return out;
}

export const FLOW_COLORS = 8; // tokens --flow-1 .. --flow-8 in tokens.css

/**
 * Async sub-flows: one per delivery that is expanded (not a repeat) and has messages below it.
 * `i` is the delivery's index, `start`..`end` the message indexes of its subtree, `color` 1..8 in delivery order
 * (stable for a given trace), `level` how many other sub-flows enclose it (0 = top level).
 * `all` is the unfiltered trace (repeatOf counts steps in it); defaults to `msgs`.
 * Returns { spans, colorOf, spanOf }: the colour of every dot (a repeat takes the colour of the flow it points to)
 * and the span a dot jumps to (Map of message index -> span), if its flow has a subtree.
 */
export function flowSpans(msgs, all = msgs) {
  const spans = [];
  msgs.forEach((m, i) => {
    if (!asyncFlowOf(m) || m.repeatOf) return;
    const start = msgs.findIndex((x, k) => k > i && x.from === m.to && x.depth === m.depth + 1 && !x.delivery);
    spans.push({ i, start, end: -1, depth: m.depth, color: (spans.length % FLOW_COLORS) + 1, level: 0 });
  });
  // A subtree runs while messages are deeper than its delivery, up to the start of a sibling's subtree (same delivery depth).
  const siblingStarts = new Set(spans.filter((sp) => sp.start > sp.i).map((sp) => sp.start));
  for (const sp of spans) {
    if (sp.start <= sp.i) continue;
    sp.end = sp.start;
    while (sp.end + 1 < msgs.length && msgs[sp.end + 1].depth > sp.depth && !(siblingStarts.has(sp.end + 1) && spans.some((o) => o.start === sp.end + 1 && o.depth === sp.depth))) sp.end++;
  }
  const byDelivery = new Map(spans.map((sp) => [sp.i, sp]));
  const real = spans.filter((sp) => sp.start > sp.i);
  for (const sp of real) sp.level = real.filter((o) => o !== sp && o.start <= sp.start && o.end >= sp.end).length;
  const colorOf = new Map(), spanOf = new Map();
  msgs.forEach((m, i) => {
    if (!asyncFlowOf(m)) return;
    const own = m.repeatOf ? byDelivery.get(msgs.indexOf(all[m.repeatOf - 1])) : byDelivery.get(i);
    if (!own) return;
    colorOf.set(i, own.color);
    if (own.start > own.i) spanOf.set(i, own);
  });
  return { spans: real, colorOf, spanOf };
}
