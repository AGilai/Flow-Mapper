// The step markers of the Loader's rule change (0.38.1, #82 comment 225): "can fail: <error>" next to a step's label, "only when <guard>" under
// its arrow with a thin gutter line across a run of steps that share the guard, and the same two in the step details panel. No dropdowns.
// The words and the run grouping are flow-markers-pure.js; this file draws them.

import { s, h } from '../dom.js';
import { canFailTag, canFailTip, onlyWhenTag, onlyWhenTip, guardRuns } from './flow-markers-pure.js';
import { labelWidth } from './flow-cols.js';
import { svgChip, chipW } from './flow-draw-prims.js';

export const GUTTER_X = 26; // right of the arm markers (x 4-22), left of the first lifeline
const STEP_TYPES = new Set(['call', 'hop', 'unresolved', 'store', 'icall']);

/** markerRuns(events) -> { byMsg: Map(msg -> { first, row }), lines: [{ row0, row1, guard, tip }] }: the runs of consecutive steps with one guard. Rows without a step (returns, captions, notes) do not break a run. */
export function markerRuns(events) {
  const steps = events.map((e, row) => ({ e, row })).filter(({ e }) => STEP_TYPES.has(e.type) && e.msg);
  const runs = guardRuns(steps.map(({ e }) => e.msg.onlyWhen?.guard ?? null)), byMsg = new Map(), lines = [];
  steps.forEach(({ e, row }, i) => {
    const r = runs[i];
    if (!r) return;
    byMsg.set(e.msg, { first: r.first, row });
    if (r.first) lines.push({ row0: row, row1: steps[r.end].row, guard: e.msg.onlyWhen.guard, tip: onlyWhenTip(e.msg.onlyWhen) });
  });
  return { byMsg, lines };
}

/** The extra width a "can fail" tag asks of the gap its arrow crosses (the short form, once each side of the centred label). */
export const failNeed = (msg) => (msg?.canFail?.length ? 2 * (chipW('can fail') + 6) : 0);

/** The "can fail" tag at the right of a step's label; the full "can fail: <error>" when it fits before the arrow end, else "can fail" / "can fail (2)". */
export function failTag(msg, x1, x2, y0, label) {
  if (!msg?.canFail?.length) return null;
  const l = msg.canFail, full = canFailTag(l), short = l.length > 1 ? full : 'can fail', mid = (x1 + x2) / 2, lw = label ? labelWidth(Array.isArray(label) ? label.join(' ') : label) : 0;
  const left = label ? mid + lw / 2 + 10 : mid - chipW(short) / 2, text = left + chipW(full) <= Math.max(x1, x2) - 14 ? full : short;
  return svgChip(text, left + chipW(text) / 2, y0 - 24, 'cf', canFailTip(l));
}

/** The chips an internal-call row shows after its "internal" tag, from x: can fail, and only when (first step of a run). */
export function inlineMarks(msg, x, y0, maxX, first) {
  const out = [];
  if (msg?.canFail?.length) { const t = canFailTag(msg.canFail), w = chipW(t); if (x + w < maxX) { out.push(svgChip(t, x + w / 2, y0 - 13, 'cf', canFailTip(msg.canFail))); x += w + 6; } }
  if (msg?.onlyWhen && first) { const room = Math.floor((maxX - x - 16) / 6.1), t = onlyWhenTag(msg.onlyWhen, room); if (room >= 12) out.push(svgChip(t, x + chipW(t) / 2, y0 - 13, 'ow', onlyWhenTip(msg.onlyWhen))); }
  return out;
}

/** The thin gutter line across each run (lines from markerRuns; y: row -> baseline, top: row -> top). */
export const gutterLines = (lines, top) => (lines.length ? s('g', { class: 'owlines', role: 'presentation' }, lines.map((l) => s('line', { class: 'owline', x1: GUTTER_X, x2: GUTTER_X, y1: top[l.row0] + 6, y2: top[l.row1 + 1] - 6 }, s('title', {}, l.tip)))) : null);

/** The step details panel card: each can-fail entry (when, error, file:line) and the only-when guard. null when the step has neither. */
export function markersCard(m) {
  if (!m.canFail?.length && !m.onlyWhen) return null;
  const src = (o) => (o?.source?.file ? `${o.source.file}${o.source.line ? `:${o.source.line}` : ''}` : null);
  return h('section.ep-card.ep-markers', { 'data-qa': 'step-markers' }, h('header', h('h3', 'Conditions'), h('span.ep-meta', m.canFail?.length ? h('span.pill.gap', m.canFail.length > 1 ? `can fail (${m.canFail.length})` : 'can fail') : null)),
    h('div.ep-pad.stack', { style: { gap: 'var(--s2)' } },
      m.onlyWhen ? h('div', h('span.ep-label', 'Only when'), h('div', h('span.key', m.onlyWhen.guard)), src(m.onlyWhen) ? h('div.xs.muted.mono', src(m.onlyWhen)) : null, h('p.ep-note', 'This step is in the only arm that leads to a flow: it happens only when the guard holds.')) : null,
      ...(m.canFail ?? []).map((c) => h('div', h('span.ep-label', 'Can fail'), h('div', h('span.key', c.error)), c.when ? h('div.small', `When: ${c.when}`) : null, src(c) ? h('div.xs.muted.mono', src(c)) : null))));
}
