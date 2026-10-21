// The band row above the lifeline heads (0.27.1): a grey band over each run of heads that belong together, with an icon and a label.
// Today the runs are the collections of one data store ("mongodb: users-db", flow-stores-pure.js bandsOf). Phase 3b reuses drawBands for the
// subsystem bands over component heads (frame 12c): hand it runs of { from, to, label, icon? } and the same geometry. Also the store icon and the
// legend line for the read / write line weights.

import { h, s } from '../dom.js';
import { productImage } from './flow-draw-icons.js';

export const BAND_H = 26; // the row the bands take above the heads
export const STORE_X = 32; // x of a store head's text: its icon comes first

const ICON = 'M2 3.2v7.6c0 1.1 2.2 2 5 2s5-.9 5-2V3.2M2 7c0 1.1 2.2 2 5 2s5-.9 5-2';
/** The data-store (cylinder) icon, 14px, at x y. `stack`: a second one behind it (a folded head). */
export const storeIcon = (x, y, stack = false) => s('g', { class: 'sicon', transform: `translate(${x} ${y})`, 'aria-hidden': 'true' },
  stack ? s('g', { transform: 'translate(4 4)', opacity: 0.5 }, s('ellipse', { cx: 7, cy: 3.2, rx: 5, ry: 2 }), s('path', { d: ICON })) : null,
  s('ellipse', { cx: 7, cy: 3.2, rx: 5, ry: 2 }), s('path', { d: ICON }));

/** drawBands(bands, { colX, headBox, columns }) -> svg nodes. bands: [{ from, to, label }] (column indexes, first to last). */
const GAP = 6, clip = (t, n) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
export const drawBands = (bands, { colX, headBox, columns }) => (bands ?? []).map((b) => {
  const a = columns[b.from], z = columns[b.to], x = colX.get(a) - headBox(a) / 2 + GAP / 2, w = colX.get(z) + headBox(z) / 2 - x - GAP / 2, room = Math.floor((w - 36) / 6.6); // a small gap between neighbouring bands; the label ends in an ellipsis when it does not fit (the title has it all)
  return s('g', { class: 'band', transform: `translate(${x} 4)` }, s('rect', { width: w, height: 22, rx: 4 }), productImage('store', a.storeKind, 8, 5, 12) ?? storeIcon(8, 4), room >= 3 ? s('text', { x: 28, y: 15 }, clip(b.label, room)) : null, s('title', {}, b.label));
});

const sample = (write) => s('svg', { width: 40, height: 10, 'aria-hidden': 'true' }, s('line', { class: `lg-line${write ? ' w' : ''}`, x1: 0, x2: 33, y1: 5, y2: 5 }), s('path', { class: 'lg-head', d: 'M40 5 33 1.5V8.5z' }));
/** The legend of the data-store arrows: a read is a thin line with a dashed return, a write a heavier line with none. */
export const storeLegend = () => h('div.store-legend', { 'data-qa': 'store-legend' },
  h('span', sample(false), h('b', 'Read'), ' thin line, dashed return'), h('span', sample(true), h('b', 'Write'), ' heavier line, no return'));
