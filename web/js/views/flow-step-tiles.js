// Step tiles and the halo of the current step, drawn over a lane (0.20.0) from the geometry renderLane returns: x per lifeline, y per row.
// A tile sits at the start of its arrow; the current one is solid ink (always), and the highlight band (when on) sits behind its row.
// Not the async number tiles (.numtile at the end of a queue arrow, square with a ↓): steps are round pills, so the two never look alike.

import { s } from '../dom.js';
import { NEST, BAR } from './flow-draw-layout.js';

const H = 16, tw = (n) => Math.max(20, String(n).length * 7 + 12);
const blocked = (st) => !!st.event?.msg?.blocked; // #85: a blocked step's tile is an amber "!" bubble, not a number

/** Where a step's arrow starts and ends: { x1, x2, dir } in lane pixels (x1 is the start, just outside the bar it leaves). */
export function arrowSpan(step, { columns, geometry }) {
  const e = step.event, X = (c) => geometry.x[columns.indexOf(c)];
  const from = e.type === 'unresolved' ? e.bar.col : e.from, to = e.type === 'unresolved' ? e.col : e.to;
  const xf = X(from), xt = X(to), dir = Math.sign(xt - xf) || 1;
  const bar = e.type === 'unresolved' ? e.bar : e.fromBar;
  return { x1: bar ? xf + bar.level * NEST + dir * BAR / 2 : xf + (e.fork ? 6 : 0), x2: xt, dir };
}

/**
 * drawStepTiles(res, built, steps, onPick(n, event), onEdit(n)) -> { setCurrent(n), setRange(from, to) | setRange(null), rowSpan(n) -> { top, bottom }, rowEl(n), span(n) -> { x1, x2 } (lane pixels) }
 * 0.34.0: `setRange` lays the same band over a range of steps (a hovered or chosen comment bracket); `rowSpan` is where a step's row is, for the brackets in the gutter.
 * res: what renderLane returned; built: what buildLane returned (its columns); steps: stepsOf(built).
 */
export function drawStepTiles(res, built, steps, onPick, onEdit = null, hl = () => true) {
  // 0.32.5: the current step's row is a soft filled band (no border), the first thing in the body so frames, arrows and text sit over it
  const band = s('rect', { class: 'stepband', x: 0, visibility: 'hidden', 'pointer-events': 'none', 'aria-hidden': 'true' }), rband = s('rect', { class: 'stepband', x: 0, visibility: 'hidden', 'pointer-events': 'none', 'aria-hidden': 'true' });
  const tiles = new Map(), spans = new Map(), grps = new Map();
  const g = s('g', { class: 'steptiles' }, ...steps.map((st) => {
    const sp = arrowSpan(st, { columns: built.columns, geometry: res.geometry }), w = blocked(st) ? 18 : tw(st.n), cx = sp.x1 + sp.dir * (w / 2 + 3), y = res.geometry.y[st.row];
    spans.set(st.n, sp);
    const t = s('g', { class: `steptile${blocked(st) ? ' blk' : ''}`, 'data-step': st.n, 'aria-hidden': 'true' },
      s('rect', { x: cx - w / 2, y: y - 6, width: w, height: blocked(st) ? 18 : H, rx: blocked(st) ? 9 : H / 2 }), s('text', { x: cx, y: y + (blocked(st) ? 7 : 6), 'text-anchor': 'middle' }, blocked(st) ? '!' : st.n), s('title', {}, `Step ${st.n}${blocked(st) ? ' (blocked)' : ''}: ${st.label}`));
    t.addEventListener('click', (ev) => { ev.stopPropagation(); onPick(st.n, ev); });
    tiles.set(st.n, t);
    if (!onEdit) return t;
    // 0.30.0: a pencil next to the tile opens the step editor; shown on hover, on the current step, and always on touch (flow-walk.css)
    const px = cx + sp.dir * (w / 2 + 15), pen = s('g', { class: 'steppen', role: 'button', 'aria-label': `Edit step ${st.n}` },
      s('rect', { x: px - 10, y: y - 6, width: 20, height: H, rx: 5 }), s('path', { d: `M${px - 4} ${y + 6.5}h2.3l5.2-5.2-2.3-2.3-5.2 5.2z`, class: 'pp' }), s('title', {}, `Edit step ${st.n}`));
    const open = (ev) => { ev.stopPropagation(); ev.preventDefault?.(); onEdit(st.n); };
    pen.addEventListener('click', open); // keyboard: the key E, or Edit step on the bar
    const grp = s('g', { class: 'stepgrp', 'data-step': st.n }, t, pen);
    tiles.set(st.n, t); grps.set(st.n, grp);
    return grp;
  }));
  res.body.append(g);
  // after the column fills (fold bands) so the yellow reads as one band across the row, before frames, lifelines, arrows and text
  const under = [...res.body.querySelectorAll(':scope > .sq-band')].pop() ?? res.body.querySelector(':scope > defs'); if (under) under.after(band); else res.body.prepend(band);
  band.after(rband);
  let cur = 0;
  return {
    setCurrent(n) {
      tiles.get(cur)?.classList.remove('cur'); grps.get(cur)?.classList.remove('cur');
      cur = n;
      const st = steps[n - 1], sp = spans.get(n);
      tiles.get(n)?.classList.add('cur'); grps.get(n)?.classList.add('cur');
      const top = res.geometry.top;
      if (!hl() || !st || !sp || top?.[st.row] == null || top[st.row + 1] == null) { band.setAttribute('visibility', 'hidden'); return; }
      band.setAttribute('y', top[st.row]); band.setAttribute('height', top[st.row + 1] - top[st.row]); band.setAttribute('width', res.geometry.width); band.setAttribute('visibility', 'visible');
    },
    rowSpan(n) { const st = steps[n - 1], top = res.geometry.top; return st && top?.[st.row] != null && top[st.row + 1] != null ? { top: top[st.row], bottom: top[st.row + 1] } : null; },
    setRange(from, to) {
      const a = from == null ? null : this.rowSpan(from), b = to == null ? null : this.rowSpan(to);
      if (!a || !b) { rband.setAttribute('visibility', 'hidden'); return; }
      rband.setAttribute('y', a.top); rband.setAttribute('height', b.bottom - a.top); rband.setAttribute('width', res.geometry.width); rband.setAttribute('visibility', 'visible');
    },
    span: (n) => spans.get(n) ?? null,
    rowEl: (n) => res.body.querySelector(`[data-e="${steps[n - 1]?.row}"]`),
  };
}
