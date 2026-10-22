// Comment brackets (0.34.0, frame 20e): a comment on a range of 2+ steps draws a thin bracket in a left gutter beside the diagram, with a bubble that
// holds the number of comments. Up to 3 columns (2 at 760 px), then a "+n" chip. Hover or focus lays the soft yellow band (`--step-hl`) over the range;
// a click opens the Comments tab with that comment outlined. Resolved and deleted comments draw nothing, and neither does a comment on one step.
// The gutter is a zero-size sticky element before the lane (it stays at the left edge while the diagram scrolls sideways); the lane has 60 px of padding
// while the layer is on. Creating a range (shift-click, drag, keys) is select.js.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { rangeLook, rangeText } from '../comments/range.js';
import { assignColumns, groupRanges, bubbleTops, COL_W, GUTTER, GUTTER_NARROW } from './layout.js';
import { createSelect } from './select.js';

const narrow = () => { try { return matchMedia('(max-width: 760px)').matches; } catch { return false; } };

/**
 * createBrackets({ walk, factor(), on(), hl(), open(ids, range), create(from, to) }) -> { setComments(list), attach(laneBox), refresh(), pick(n, ev), extend(dir), width(), dispose() }
 * walk: the tab's step walk ({ steps(), rowSpan(n) -> { top, bottom } in lane pixels, hlRange(from, to) | hlRange(null), current(), picked(), go(n) }); factor(): the zoom scale.
 * list of setComments: [{ id, steps: { from, to } (keys), text }] of the comments that are open (not resolved, not deleted).
 */
export function createBrackets({ walk, factor = () => 1, on = () => true, hl = () => true, open, create }) {
  let list = [], box = null, shown = null;
  const gutter = h('div.cb-gutter', { 'data-qa': 'cb-gutter', 'aria-label': 'Comments on ranges of steps' });
  const width = () => (on() ? (narrow() ? GUTTER_NARROW : GUTTER) : 0);
  const nOf = (key) => walk.steps().find((s) => s.key === key)?.n ?? null;
  const svg = () => box?.querySelector('svg.seq-body');
  const y0 = () => { const v = svg(); return v && box ? v.getBoundingClientRect().top - box.getBoundingClientRect().top : 0; }; // where the body starts under the heads (the rects move together while scrolling)
  const span = (from, to) => { const a = walk.rowSpan(from), b = walk.rowSpan(to), z = factor(), o = y0(); return a && b ? { top: o + a.top * z, bottom: o + b.bottom * z } : null; };

  const sel = createSelect({ gutter, walk, factor, y0, rows: () => walk.steps().map((s) => ({ n: s.n, ...(walk.rowSpan(s.n) ?? { top: 0, bottom: 0 }) })), span, create, width, paint: () => paint() });

  function hover(r) { shown = r; walk.hlRange(r ? r.from : null, r ? r.to : null); gutter.querySelectorAll('.cb-band.rng').forEach((b) => b.remove()); if (r) { const s = span(r.from, r.to); if (s) gutter.prepend(h('div.cb-band.rng', { style: { top: `${s.top}px`, height: `${s.bottom - s.top}px`, width: `${width()}px` } })); } }
  const ranges = () => groupRanges(list.map((c) => ({ c, look: rangeLook(c.steps, nOf) })).filter((x) => x.look?.kind === 'range').map(({ c, look }) => ({ id: c.id, from: look.from, to: look.to, text: c.text })));

  function paint() {
    gutter.replaceChildren();
    gutter.style.setProperty('--cb-w', `${width()}px`);
    if (!box || !on() || !svg()) { sel.clear(); return; }
    if (hl() && walk.steps().length) { const c = span(walk.current(), walk.current()); if (c) gutter.append(h('div.cb-band', { style: { top: `${c.top}px`, height: `${c.bottom - c.top}px`, width: `${width()}px` } })); } // the current step's band runs through the gutter too
    const maxCols = narrow() ? 2 : 3, { placed, hidden } = assignColumns(ranges(), maxCols), geo = new Map();
    for (const r of [...placed, ...hidden]) { const s = span(r.from, r.to); if (s) geo.set(r.id, s); }
    const tops = bubbleTops(placed.filter((r) => geo.has(r.id)).map((r) => ({ id: r.id, col: r.col, y0: geo.get(r.id).top, y1: geo.get(r.id).bottom })));
    for (const r of placed) {
      const s = geo.get(r.id); if (!s) continue;
      const x = 6 + r.col * COL_W, label = `${r.n} comment${r.n === 1 ? '' : 's'} on ${rangeText({ kind: 'range', from: r.from, to: r.to })}`;
      const go = () => { hover({ from: r.from, to: r.to }); open?.(r.ids, r); };
      const enter = () => hover({ from: r.from, to: r.to }), leave = () => hover(null);
      const common = { type: 'button', title: `${r.text ? `${r.text}\n` : ''}${label}`, 'aria-label': label, 'data-qa': 'cb-bracket', on: { click: go, mouseenter: enter, mouseleave: leave, focus: enter, blur: leave } };
      gutter.append(h('button.cb-bk', { ...common, style: { left: `${x - 4}px`, top: `${s.top}px`, height: `${Math.max(8, s.bottom - s.top)}px` } }, h('i')),
        h('button.cb-bub', { ...common, 'data-qa': 'cb-bubble', tabindex: -1, 'aria-hidden': 'true', style: { left: `${x - 8}px`, top: `${tops.get(r.id) ?? s.top}px` } }, icon('comment'), String(r.n)));
    }
    for (const r of hidden) { // a fourth overlapping range: a dark "+n" chip at the top of its range
      const s = geo.get(r.id); if (!s) continue;
      gutter.append(h('button.cb-more', { type: 'button', title: `${r.n} more on ${rangeText({ kind: 'range', from: r.from, to: r.to })}`, 'aria-label': `${r.n} more comments on ${rangeText({ kind: 'range', from: r.from, to: r.to })}`, 'data-qa': 'cb-more',
        style: { left: `${6 + (maxCols - 1) * COL_W - 4}px`, top: `${s.top}px` }, on: { click: () => { hover({ from: r.from, to: r.to }); open?.(r.ids, r); }, mouseenter: () => hover({ from: r.from, to: r.to }), mouseleave: () => hover(null) } }, `+${r.n}`));
    }
    sel.paint();
    if (shown) hover(shown);
  }

  return {
    gutter,
    setComments(l) { list = l.filter((c) => c.steps?.from && c.steps?.to); paint(); },
    /** The lane was drawn again (its box was emptied): put the gutter back in front of it and the padding on. */
    attach(laneBox) { box = laneBox; laneBox.classList.toggle('cb-on', on()); laneBox.style.setProperty('--cb-w', `${width()}px`); if (on()) laneBox.prepend(gutter); else gutter.remove(); sel.bind(laneBox); paint(); },
    refresh() { box?.classList.toggle('cb-on', on()); box?.style.setProperty('--cb-w', `${width()}px`); if (box) { if (on() && gutter.parentNode !== box) box.prepend(gutter); else if (!on()) gutter.remove(); } paint(); },
    pick: (n, ev) => on() && sel.pick(n, ev), extend: (dir) => { if (on()) sel.extend(dir); }, width, hover, // layer off (harvested default): no gesture
    dispose: () => { sel.dispose(); gutter.remove(); },
  };
}
