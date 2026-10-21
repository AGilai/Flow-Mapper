// Activation bars and the middleware segments on top of them.

import { s } from '../dom.js';
import { isLongChain } from './flow-mw.js';
import { BAR, colorOf } from './flow-draw-layout.js';
import { cmpVar } from '../design/component-colors.js';

/** drawBars(layout, { selected, onBarTip }) -> { rects, segs }; each bar keeps its element as bar.el. */
export function drawBars({ bars, ys, barX, idx, folded }, { selected, onBarTip }) {
  const hidden = (b) => folded.has(idx.get(b.col)); // a bar inside a fold is not drawn
  const rects = bars.filter((b) => !hidden(b)).map((b) => {
    const y1 = ys[b.start] - 16, y2 = ys[b.end] + 14;
    const cc = cmpVar(b.service, b.col.serviceKind, b.col.slot); // tinted by its component, not by the call that reaches it
    const r = s('rect', { class: `act${cc ? ' cmp' : ''}${cc && b.level ? ' deep' : ''}${b.col.serviceKind === 'client-app' ? ' ca' : ''}${b.msg.reference ? ' ref' : ''}${selected === b.id ? ' selected' : ''}`, 'data-bar': b.id, x: barX(b, -1), y: y1, width: BAR, height: Math.max(20, y2 - y1), rx: 3, style: `--mc:${colorOf(b.transport)}${cc ? `;--cc:${cc}` : ''}`, tabindex: 0, role: 'button',
      'aria-label': `${b.service}: ${b.msg.label}. Press Enter to look inside` }, onBarTip ? null : s('title', {}, `${b.service}\n${b.msg.label}\nDouble-click to look inside`)); // onBarTip draws the popover instead
    b.el = r;
    return r;
  });
  const segs = bars.filter((b) => !hidden(b)).flatMap((b) => (b.mw?.spans ?? []).map((sp, k) => { // middleware segments: on top of the bar, from the bar's top down
    const y1 = k === 0 ? ys[b.start] - 16 : ys[sp.from] - 16, y2 = k + 1 < b.mw.spans.length ? ys[b.mw.spans[k + 1].from] - 16 : ys[sp.to] + 14, seg = b.mw.segs[k], fold = isLongChain(b.mw.chain);
    return s('rect', { class: `mwseg${selected === b.id ? ' selected' : ''}`, 'data-bar': b.id, 'data-mwfold': fold ? b.id : null, x: barX(b, -1), y: y1, width: BAR, height: Math.max(16, y2 - y1), rx: 3, tabindex: 0, role: 'button',
      'aria-label': `Middleware ${seg.label} in ${b.service}` }, s('title', {}, fold ? 'Click to expand or collapse the middleware chain' : `middleware: ${seg.label}\n${b.service}`));
  }));
  return { rects, segs };
}
