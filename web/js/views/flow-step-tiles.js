// Step tiles and the halo of the current step, drawn over a lane (0.20.0) from the geometry renderLane returns: x per lifeline, y per row.
// A tile sits at the start of its arrow; the current one is solid, and a halo in the arrow's transport colour surrounds that arrow.
// Not the async number tiles (.numtile at the end of a queue arrow): other class, other place, never the same spot.

import { s } from '../dom.js';
import { colorOf, NEST, BAR } from './flow-draw-layout.js';

const H = 16, tw = (n) => Math.max(20, String(n).length * 7 + 12);

/** Where a step's arrow starts and ends: { x1, x2, dir } in lane pixels (x1 is the start, just outside the bar it leaves). */
export function arrowSpan(step, { columns, geometry }) {
  const e = step.event, X = (c) => geometry.x[columns.indexOf(c)];
  if (e.type === 'store') { const x = X(e.bar.col) + e.bar.level * NEST + BAR / 2; return { x1: x, x2: x + 96, dir: 1 }; }
  const from = e.type === 'unresolved' ? e.bar.col : e.from, to = e.type === 'unresolved' ? e.col : e.to;
  const xf = X(from), xt = X(to), dir = Math.sign(xt - xf) || 1;
  const bar = e.type === 'unresolved' ? e.bar : e.fromBar;
  return { x1: bar ? xf + bar.level * NEST + dir * BAR / 2 : xf + (e.fork ? 6 : 0), x2: xt, dir };
}

/**
 * drawStepTiles(res, built, steps, onPick(n)) -> { setCurrent(n), rowEl(n) }
 * res: what renderLane returned; built: what buildLane returned (its columns); steps: stepsOf(built).
 */
export function drawStepTiles(res, built, steps, onPick) {
  const halo = s('rect', { class: 'stephalo', rx: 9, height: 38, visibility: 'hidden', 'pointer-events': 'none' });
  const tiles = new Map(), spans = new Map();
  const g = s('g', { class: 'steptiles', 'aria-hidden': 'true' }, halo, ...steps.map((st) => {
    const sp = arrowSpan(st, { columns: built.columns, geometry: res.geometry }), w = tw(st.n), cx = sp.x1 + sp.dir * (w / 2 + 3), y = res.geometry.y[st.row];
    spans.set(st.n, sp);
    const t = s('g', { class: 'steptile', 'data-step': st.n },
      s('rect', { x: cx - w / 2, y: y - 6, width: w, height: H, rx: 4 }), s('text', { x: cx, y: y + 6, 'text-anchor': 'middle' }, st.n), s('title', {}, `Step ${st.n}: ${st.label}`));
    t.addEventListener('click', (ev) => { ev.stopPropagation(); onPick(st.n); });
    tiles.set(st.n, t);
    return t;
  }));
  res.body.append(g);
  let cur = 0;
  return {
    setCurrent(n) {
      tiles.get(cur)?.classList.remove('cur');
      cur = n;
      const st = steps[n - 1], sp = spans.get(n);
      tiles.get(n)?.classList.add('cur');
      if (!st || !sp) { halo.setAttribute('visibility', 'hidden'); return; }
      const x = Math.min(sp.x1, sp.x2) - 8, y = res.geometry.y[st.row];
      halo.setAttribute('x', x); halo.setAttribute('y', y - 22); halo.setAttribute('width', Math.abs(sp.x2 - sp.x1) + 16);
      halo.setAttribute('style', `--mc:${colorOf(st.transport)}`); halo.setAttribute('visibility', 'visible');
    },
    rowEl: (n) => res.body.querySelector(`[data-e="${steps[n - 1]?.row}"]`),
  };
}
