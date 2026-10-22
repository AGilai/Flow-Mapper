// Step details on the arrows (0.30.0): the title (bold) above a step's arrow and its description (one line, cut with the full text in the tooltip) below it.
// Room for them is reserved by the layout (flow-draw-layout.js: `det.parts`); here only the text is drawn, centred between the two lifelines like the API label.

import { s } from '../dom.js';

const CH = 6.3; // 11.5px text
const clip = (t, n) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);

/** Ends of a step's arrow as lifelines (null when a row has no plain two-lifeline arrow). */
function ends(e) {
  if (e.type === 'unresolved' || e.type === 'store') return [(e.fromBar ?? e.bar)?.col, e.col];
  return [e.from, e.to];
}

/** detailTexts(layout, { parts, text }, onEdit(key, n)) -> one <g> with the title and description lines of every step that shows them. */
export function detailTexts({ colX, ys, idx, folded }, { parts, text }, onEdit) {
  const kids = [];
  for (const [e, p] of parts) {
    if (!p.title && !p.desc) continue;
    const [a, b] = ends(e), t = text.get(e);
    if (!a || !b || !colX.has(a) || !colX.has(b) || folded.has(idx.get(a)) || folded.has(idx.get(b))) continue; // inside a fold there is no room
    const xa = colX.get(a), xb = colX.get(b), cx = (xa + xb) / 2, room = Math.floor((Math.abs(xb - xa) - 36) / CH);
    if (room < 6) continue;
    const y = ys[e.row];
    const line = (cls, str, yy) => {
      const el = s('text', { class: `sdt ${cls}`, x: cx, y: yy, 'text-anchor': 'middle', 'data-step': t.n }, clip(str, room), s('title', {}, str));
      if (onEdit) el.addEventListener('dblclick', (ev) => { ev.stopPropagation(); onEdit(t.key, t.n); });
      return el;
    };
    if (p.title) kids.push(line('t', t.title, p.api ? y - 24 : y - 7));
    if (p.desc) kids.push(line('d', t.desc, p.api || p.title ? y + 15 : y - 7));
  }
  return s('g', { class: 'sdets' }, ...kids);
}
