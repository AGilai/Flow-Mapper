// The sticky header of a lane (one card per lifeline) and the lifelines of its body.

import { s } from '../dom.js';
import { chName } from './flow-chain.js';
import { LINE_H, colorOf } from './flow-draw-layout.js';

export function drawHead({ columns, heads, boxH, HEAD, width, colX, isCh, headBox }) {
  return s('svg', { width, height: HEAD, class: 'seq-head', role: 'presentation' }, columns.map((c, i) =>
    s('g', { class: `seq-part k-${c.kind}${c.fan ? ' fan' : ''}`, 'data-p': i, style: isCh(c) || c.transport ? `--mc:${colorOf(c.transport)}` : null, transform: `translate(${colX.get(c) - headBox(c) / 2},8)`, tabindex: c.fan ? 0 : null, role: c.fan ? 'button' : null },
      s('rect', { width: headBox(c), height: boxH, rx: 8 }), s('rect', { class: 'stripe', width: 4, height: boxH, rx: 2 }),
      heads[i].name.map((t, k) => s('text', { x: 12, y: 18 + k * LINE_H, class: 'name' }, t)),
      isCh(c) ? headChip(c, heads[i].name.length * LINE_H + 5) : heads[i].sub.map((t, k) => s('text', { x: 12, y: 18 + heads[i].name.length * LINE_H + 1 + k * 13, class: 'sub' }, t)),
      s('title', {}, c.folded ? `${c.folded.length} more queues: ${c.folded.map(chName).join(', ')}. Click to show them all.` : c.fan?.open ? `${c.label}. Click to fold the healthy queues again.` : c.label))));
  function headChip(c, y) { // the transport of a topic or queue, as a chip; a big fan-out adds its fold control
    const w = c.sub.length * 6.4 + 12;
    return [s('rect', { class: 'tchip', x: 12, y: y + 4, width: w, height: 16, rx: 4 }), s('text', { class: 'tchipt', x: 18, y: y + 16 }, c.sub),
      c.fan ? s('text', { class: 'fanbtn', x: 12 + w + 6, y: y + 16 }, c.folded ? 'show ▸' : 'fold ▴') : null];
  }
}

/** The vertical line of each lifeline. */
export const drawLifelines = ({ columns, colX, height, isCh }) => columns.map((c) => s('line', { class: isCh(c) ? 'lifeline ch' : 'lifeline', style: isCh(c) ? `--mc:${colorOf(c.transport)}` : null, x1: colX.get(c), x2: colX.get(c), y1: 0, y2: height }));
