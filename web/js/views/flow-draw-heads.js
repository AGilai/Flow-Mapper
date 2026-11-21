// The sticky header of a lane (one card per lifeline) and the lifelines of its body.

import { s } from '../dom.js';
import { chName } from './flow-chain.js';
import { LINE_H, colorOf, INT_H } from './flow-draw-layout.js';
import { foldHeads } from './flow-draw-fold.js';
import { sparkSvg } from '../components/status-mark.js';
import { headMarkSvg } from './flow-marks-draw.js';
import { isDesign } from '../state.js';
import { callerOf, colVar, isCustom } from '../design/component-colors.js';
import { familyOf } from '../design/family-colours.js';
import { headRefSvg, headRefSub } from './flow-refs-draw.js';
import { runtimeFor, runtimeSvg } from '../design/service-info.js';
import { drawBands, storeIcon } from './flow-draw-bands.js';
import { externalCls, externalTag } from './flow-draw-external.js';
import { headIcon, headIconOf, TEXT_X } from './flow-draw-icons.js';
import { isLarge, LG_SHIFT } from './flow-head-large.js';
import { isStoreHead, headLabel, HEAD_TIP } from './store-panel-pure.js';
import { hasMore, headCardable } from './head-card-pure.js';

export function drawHead({ storeOn, columns, heads, boxH, HEAD, bandH, bands, width, colX, isCh, headBox, folded, groups, marks, refs, edit, internal }) {
  const queueSrc = (c) => c.kind === 'source' && c.transport, top = 8 + bandH, tx = (c) => (isLarge(c) ? headBox(c) / 2 : c.kind === 'resource' || headIconOf(c) ? TEXT_X : 12), dy = (c) => (isLarge(c) ? LG_SHIFT : 0), mid = (c) => (isLarge(c) ? 'middle' : null); // CR #148: a head with its own icon centres its text under a large logo // a store head, or one with a product icon, has it before the name
  return s('svg', { width, height: HEAD, class: 'seq-head', role: 'presentation' }, drawBands(bands, { colX, headBox, columns, groups, onAdd: edit?.onAddInBand }), foldHeads(groups, boxH, top, (g) => { const r = marks?.fold?.(g.cols.map((k) => columns[k])); return r ? sparkSvg(g.w - 2, 3, r.info.mark, 12) : null; }), columns.map((c, i) => folded.has(i) ? null :
    s('g', { class: `seq-part k-${c.kind}${c.fan ? ' fan' : ''}${look(c).cls}${storeOn && isStoreHead(c) ? ' store-hd' : ''}`, 'data-p': i, style: look(c).style, transform: `translate(${colX.get(c) - headBox(c) / 2},${top})`, ...(storeOn && isStoreHead(c) ? { tabindex: 0, role: 'button', 'aria-pressed': 'false', 'aria-label': headLabel(c), 'data-store': c.group, 'data-coll': c.collection ?? '', 'data-stack': c.stack ? '1' : '0', 'data-kind': c.storeKind } : { tabindex: c.fan || c.service ? 0 : null, role: c.fan || c.service ? 'button' : null, 'aria-label': c.service && !c.fan ? `${c.label}. Show details` : null }) },
      storeOn && isStoreHead(c) ? s('rect', { class: 'sp-ring', x: -4, y: -4, width: headBox(c) + 8, height: boxH + 8, rx: 11 }) : null,
      c.stack ? [s('rect', { class: 'stack', x: 8, y: 5, width: headBox(c), height: boxH, rx: 8, opacity: 0.55 }), s('rect', { class: 'stack', x: 4, y: 2.5, width: headBox(c), height: boxH, rx: 8, opacity: 0.8 })] : null,
      s('rect', { width: headBox(c), height: boxH, rx: 8 }), s('rect', { class: 'stripe', width: 4, height: boxH, rx: 2 }), c.kind === 'service' && isCustom(c.service, c.env ?? state.env) ? s('rect', { class: 'cust-dia', x: headBox(c) - 5, y: -4, width: 9, height: 9, transform: `rotate(45 ${headBox(c) - 0.5} 0.5)`, 'data-qa': 'custom-colour' }, s('title', {}, 'custom colour, not from the family')) : null, headIcon(c, headBox(c)) ?? (c.kind === 'resource' ? storeIcon(12, 10, c.stack) : null), headMarkSvg(marks, c, headBox(c)), headRefSvg(refs, c, headBox(c)), c.kind === 'service' ? runtimeSvg(runtimeFor(c.service, c.env), headBox(c) - (refs?.locked(c) ? 40 : 22), 5) : null,
      heads[i].name.map((t, k) => s('text', { x: tx(c), y: 18 + dy(c) + k * LINE_H, class: 'name', 'text-anchor': mid(c) }, t)),
      isCh(c) || queueSrc(c) ? headChip(c, heads[i].name.length * LINE_H + 5 + dy(c), headBox(c)) : (c.kind === 'unresolved' && isDesign(c.env) ? ['not designed yet'] : headRefSub(refs, c, heads[i].sub)).map((t, k) => s('text', { x: tx(c), y: 18 + dy(c) + heads[i].name.length * LINE_H + 1 + k * 13, class: 'sub', 'text-anchor': mid(c) }, t)),
      externalTag(c, headBox(c), boxH), internal && c.kind === 'service' && !c.external ? (internal.simple ? hiddenBadge(c, internal) : internalCtl(c, internal.state(c.service))) : null,
      storeOn && isStoreHead(c) ? s('path', { class: 'sp-aff', d: `M${headBox(c) - 19} 15h10M${headBox(c) - 19} 20h10M${headBox(c) - 19} 25h6` }) : null,
      hasMore(c) ? moreBtn(c) : null,
      headCardable(c) ? null : s('title', {}, c.trigger ? `${c.label}: a client app. Starts when: ${c.trigger}` : c.callers ? `${c.callers.length === 1 ? 'Client app' : `${c.callers.length} client apps`} that call this entry: ${c.callers.join(', ')}` : c.kind === 'resource' ? (c.stack ? `${c.label}: ${c.sub}` : `${c.label}\n${c.sub}`) + (storeOn && isStoreHead(c) ? `\n${HEAD_TIP}` : '') : c.folded ? `${c.folded.length} more queues: ${c.folded.map(chName).join(', ')}. Click to show them all.` : c.fan?.open ? `${c.label}. Click to fold the healthy queues again.` : c.label))));
  /** "N hidden" (0.44.0, #90): the Simple view's badge under a service head, in the pill's place: the internal steps the view left out. Click or Enter opens External with that service opened. */
  function hiddenBadge(c, internal) {
    const n = internal.hidden(c.service);
    if (!n) return null;
    const loading = internal.state(c.service) === 'loading', text = loading ? '⟳ loading…' : `${n} hidden`, w = text.length * 6.2 + 16, x = headBox(c) / 2 - w / 2, tip = `${n} internal ${n === 1 ? 'step' : 'steps'} hidden - open in External`;
    return s('g', { class: 'hid-bdg', 'data-int': c.service, 'data-qa': 'hidden-badge', tabindex: 0, role: 'button', 'aria-label': `${n} hidden internal steps of ${c.label}. Open in External`, transform: `translate(${x},${boxH + 3})` },
      s('rect', { class: 'pill', width: w, height: INT_H, rx: INT_H / 2 }), s('rect', { class: 'ring', x: -2, y: -2, width: w + 4, height: INT_H + 4, rx: INT_H / 2 + 2 }), s('text', { x: w / 2, y: INT_H - 4, 'text-anchor': 'middle' }, text), s('title', {}, tip));
  }
  /** "⊕ internal" (0.38.0): the lazy control under a service head: loads that service's internal calls; "⟳ loading…", then "⊖ internal" to fold them again. Shown on hover or focus, always on touch (CSS). */
  function internalCtl(c, st) {
    const text = st === 'loading' ? '⟳ loading…' : st === 'open' ? '⊖ internal' : '⊕ internal', w = text.length * 6.2 + 14, x = headBox(c) / 2 - w / 2;
    return s('g', { class: `int-ctl ${st}`, 'data-int': c.service, tabindex: 0, role: 'button', 'aria-label': st === 'open' ? `Hide the internal calls of ${c.label}` : `Show the internal calls of ${c.label}`, 'aria-busy': st === 'loading' ? 'true' : null, transform: `translate(${x},${boxH + 3})` },
      s('rect', { width: w, height: INT_H, rx: INT_H / 2 }), s('text', { x: w / 2, y: INT_H - 4, 'text-anchor': 'middle' }, text), s('title', {}, st === 'open' ? 'Hide the internal calls of this service' : 'Load the calls inside this service'));
  }
  /** #149: the ⋮ button at the right edge of a component head (under the mark badge and the runtime glyph): the menu with Show details, Zoom in and Open. Shown on hover or focus, always on touch (CSS). */
  function moreBtn(c) {
    const x = headBox(c) - 20;
    return s('g', { class: 'head-more', 'data-more': c.service, tabindex: 0, role: 'button', 'aria-haspopup': 'menu', 'aria-label': `More actions for ${c.label}`, transform: `translate(${x},18)` },
      s('rect', { class: 'hit', width: 24, height: 24, rx: 12 }), s('circle', { class: 'bg', cx: 12, cy: 12, r: 9 }), [7.5, 12, 16.5].map((y) => s('circle', { class: 'dot', cx: 12, cy: y, r: 1.5 })), s('title', {}, 'More actions'));
  }
  function look(c) { // the component's colour (a service with a slot), a locked head (a reference), a client app
    const cc = colVar(c), mc = isCh(c) || c.transport ? `--mc:${colorOf(c.transport)}` : null;
    return { style: [mc, cc ? `--cc:${cc}` : null].filter(Boolean).join(';') || null, cls: `${cc ? ' cmp' : ''}${c.serviceKind === 'client-app' ? ' ca' : ''}${refs?.locked(c) ? ' locked' : ''}${headIconOf(c)?.[0] === 'own' ? ' has-ci' : ''}${externalCls(c)}` };
  }
  function headChip(c, y, bw) { // the transport of a topic or queue, as a chip; a big fan-out adds its fold control
    const label = queueSrc(c) ? c.transport : c.sub, w = label.length * 6.4 + 12; // #102: a queue-started flow's trigger head shows the transport chip like the channel column
    const x0 = isLarge(c) && !c.fan && (c.owner || !isCh(c)) ? Math.round((bw - w) / 2) : 12; // a large head centres the chip under its name (kept left when the fold control or the no-owner note sits beside it)
    return [s('rect', { class: 'tchip', x: x0, y: y + 4, width: w, height: 16, rx: 4 }), s('text', { class: 'tchipt', x: x0 + 6, y: y + 16 }, label),
      c.fan ? s('text', { class: 'fanbtn', x: x0 + w + 6, y: y + 16 }, c.folded ? 'show ▸' : 'fold ▴') : null,
      isCh(c) && !c.owner && !c.fan ? s('text', { class: 'noown', x: x0 + w + 8, y: y + 16, 'data-qa': 'no-owner' }, isDesign(c.env) ? 'no owner yet' : 'no owner', s('title', {}, `${c.label} is declared by no component. Declare it in the owning component's channels (link health lists it).`)) : null]; // #104: a gap, not a design choice
  }
}

/** The vertical line of each lifeline. */
export const drawLifelines = ({ columns, colX, height, isCh, folded }) => columns.map((c, i) => { // frame 31: in Colour by Domain a component's line is its domain's colour
  const fam = isCh(c) ? (c.owner ? familyOf(c.env ?? state.env, c.owner)?.dom : null) : c.kind === 'service' ? familyOf(c.env ?? state.env, c.service)?.dom : callerOf(c) ? familyOf(c.env ?? state.env, callerOf(c))?.dom : null; // #140: a channel takes its declaring component's domain colour
  return folded.has(i) ? null : s('line', { class: isCh(c) ? `lifeline ch${fam ? ' fam' : ''}` : fam ? 'lifeline fam' : 'lifeline', 'data-p': i, style: isCh(c) ? `--mc:${colorOf(c.transport)}${fam ? `;--fam:${fam}` : ''}` : fam ? `--fam:${fam}` : null, x1: colX.get(c), x2: colX.get(c), y1: 0, y2: height }); });
