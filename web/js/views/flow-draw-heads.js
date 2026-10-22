// The sticky header of a lane (one card per lifeline) and the lifelines of its body.

import { s } from '../dom.js';
import { chName } from './flow-chain.js';
import { LINE_H, colorOf } from './flow-draw-layout.js';
import { foldHeads } from './flow-draw-fold.js';
import { headMarkSvg } from './flow-marks-draw.js';
import { isDesign } from '../state.js';
import { colVar } from '../design/component-colors.js';
import { headRefSvg, headRefSub } from './flow-refs-draw.js';
import { runtimeFor, runtimeSvg } from '../design/service-info.js';
import { drawBands, storeIcon } from './flow-draw-bands.js';
import { headIcon, headIconOf, TEXT_X } from './flow-draw-icons.js';

export function drawHead({ columns, heads, boxH, HEAD, bandH, bands, width, colX, isCh, headBox, folded, groups, marks, refs, edit }) {
  const top = 8 + bandH, tx = (c) => (c.kind === 'resource' || headIconOf(c) ? TEXT_X : 12); // a store head, or one with a product icon, has it before the name
  return s('svg', { width, height: HEAD, class: 'seq-head', role: 'presentation' }, drawBands(bands, { colX, headBox, columns, groups, onAdd: edit?.onAddInBand }), foldHeads(groups, boxH, top), columns.map((c, i) => folded.has(i) ? null :
    s('g', { class: `seq-part k-${c.kind}${c.fan ? ' fan' : ''}${look(c).cls}`, 'data-p': i, style: look(c).style, transform: `translate(${colX.get(c) - headBox(c) / 2},${top})`, tabindex: c.fan ? 0 : null, role: c.fan ? 'button' : null },
      c.stack ? [s('rect', { class: 'stack', x: 8, y: 5, width: headBox(c), height: boxH, rx: 8, opacity: 0.55 }), s('rect', { class: 'stack', x: 4, y: 2.5, width: headBox(c), height: boxH, rx: 8, opacity: 0.8 })] : null,
      s('rect', { width: headBox(c), height: boxH, rx: 8 }), s('rect', { class: 'stripe', width: 4, height: boxH, rx: 2 }), headIcon(c) ?? (c.kind === 'resource' ? storeIcon(12, 10, c.stack) : null), headMarkSvg(marks, c, headBox(c)), headRefSvg(refs, c, headBox(c)), c.kind === 'service' ? runtimeSvg(runtimeFor(c.service, c.env), headBox(c) - (refs?.locked(c) ? 40 : 22), 5) : null,
      heads[i].name.map((t, k) => s('text', { x: tx(c), y: 18 + k * LINE_H, class: 'name' }, t)),
      isCh(c) ? headChip(c, heads[i].name.length * LINE_H + 5) : (c.kind === 'unresolved' && isDesign(c.env) ? ['not designed yet'] : headRefSub(refs, c, heads[i].sub)).map((t, k) => s('text', { x: tx(c), y: 18 + heads[i].name.length * LINE_H + 1 + k * 13, class: 'sub' }, t)),
      s('title', {}, c.trigger ? `${c.label}: a client app. Starts when: ${c.trigger}` : c.kind === 'resource' ? (c.stack ? `${c.label}: ${c.sub}` : `${c.label}\n${c.sub}`) : c.folded ? `${c.folded.length} more queues: ${c.folded.map(chName).join(', ')}. Click to show them all.` : c.fan?.open ? `${c.label}. Click to fold the healthy queues again.` : c.label))));
  function look(c) { // the component's colour (a service with a slot), a locked head (a reference), a client app
    const cc = colVar(c), mc = isCh(c) || c.transport ? `--mc:${colorOf(c.transport)}` : null;
    return { style: [mc, cc ? `--cc:${cc}` : null].filter(Boolean).join(';') || null, cls: `${cc ? ' cmp' : ''}${c.serviceKind === 'client-app' ? ' ca' : ''}${refs?.locked(c) ? ' locked' : ''}` };
  }
  function headChip(c, y) { // the transport of a topic or queue, as a chip; a big fan-out adds its fold control
    const w = c.sub.length * 6.4 + 12;
    return [s('rect', { class: 'tchip', x: 12, y: y + 4, width: w, height: 16, rx: 4 }), s('text', { class: 'tchipt', x: 18, y: y + 16 }, c.sub),
      c.fan ? s('text', { class: 'fanbtn', x: 12 + w + 6, y: y + 16 }, c.folded ? 'show ▸' : 'fold ▴') : null];
  }
}

/** The vertical line of each lifeline. */
export const drawLifelines = ({ columns, colX, height, isCh, folded }) => columns.map((c, i) => folded.has(i) ? null : s('line', { class: isCh(c) ? 'lifeline ch' : 'lifeline', style: isCh(c) ? `--mc:${colorOf(c.transport)}` : null, x1: colX.get(c), x2: colX.get(c), y1: 0, y2: height }));
