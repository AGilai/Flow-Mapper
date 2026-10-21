// Status marks on the system map canvas: a spark (4-point star) top-right of a new node, a yellow ring with a dot on a changed one,
// and the words of what changed ("+1 endpoint") under it. One short twinkle when the map is first drawn (none with reduced motion).

import { GLYPH } from '../icons.js';
import { nodeRadius } from './graph-style.js';

const TWINKLE_MS = 900;
const paths = {};
const pathOf = (k) => (paths[k] ??= new Path2D(GLYPH[k].d));

/** The mark of a map node: nodes are `svc:<name>` and `ch:<key>` like the anchors. */
export const nodeMark = (marks, n) => marks?.markOf(n.id) ?? null;

/** createMarkLayer(marks) -> { draw(ctx, S, order, focus) -> true while the twinkle runs }. `marks`: a marks store (createMarks). */
export function createMarkLayer(marks, { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches } = {}) {
  let start = 0;
  return {
    draw(ctx, S, order, dimmed) {
      if (!marks || marks.empty) return false;
      const now = performance.now();
      if (!start) start = now;
      const t = reduced ? 1 : Math.min(1, (now - start) / TWINKLE_MS);
      const pop = reduced ? 1 : t < 0.55 ? 0.4 + (t / 0.55) * 0.85 : 1.25 - ((t - 0.55) / 0.45) * 0.25;
      const { theme, k, degree, toScreen, pos } = S;
      for (const n of order) {
        const info = nodeMark(marks, n);
        if (!info || info.mark === 'removed' || dimmed(n.id)) continue;
        const [x, y] = toScreen(pos.get(n.id)), r = nodeRadius(n, degree) * Math.max(0.5, Math.min(k, 1.25));
        if (info.mark === 'changed') { ctx.lineWidth = 2; ctx.strokeStyle = theme.newInk; ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, Math.PI * 2); ctx.stroke(); }
        const g = info.mark === 'new' ? 'new' : 'chg', size = 12 * (info.mark === 'new' ? pop : 1), cx = x + r * 0.85, cy = y - r * 0.85 - 3;
        ctx.save();
        ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(size / 12, size / 12);
        if (g === 'new') { ctx.fillStyle = theme.newc; ctx.strokeStyle = theme.newInk; ctx.lineWidth = 0.9; ctx.lineJoin = 'round'; ctx.fill(pathOf('new')); ctx.stroke(pathOf('new')); }
        else { ctx.fillStyle = theme.newInk; ctx.fill(pathOf('chg'), 'evenodd'); }
        ctx.restore();
        if (info.what && (k >= 0.7 || S.selected === n.id)) {
          const what = info.what.length > 44 ? `${info.what.slice(0, 43)}\u2026` : info.what;
          ctx.font = `600 10.5px ${theme.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          const w = ctx.measureText(what).width, ty = y + r + 5;
          ctx.fillStyle = theme.halo; ctx.fillRect(x - w / 2 - 2, ty - 1, w + 4, 14);
          ctx.fillStyle = theme.newInk; ctx.fillText(what, x, ty);
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        }
      }
      return t < 1;
    },
  };
}
