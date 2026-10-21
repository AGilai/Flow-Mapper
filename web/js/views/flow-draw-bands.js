// The band rows above the lifeline heads (0.27.1): a grey band over each run of heads that belong together, with an icon and a label.
// Two kinds of run: the collections of one data store ("mongodb: users-db", flow-stores-pure.js bandsOf) and, since 0.28.1, the subsystem bands over
// component heads (frame 12c, flow-bands.js). With both, the subsystem row is on top and the store row under it. Also the store icon and the
// legend line for the read / write line weights.

import { h, s } from '../dom.js';
import { productImage } from './flow-draw-icons.js';
import { subIcon, GLYPH } from '../icons.js';

export const BAND_H = 26; // the row each kind of band takes above the heads
export const STORE_X = 32; // x of a store head's text: its icon comes first

const ICON = 'M2 3.2v7.6c0 1.1 2.2 2 5 2s5-.9 5-2V3.2M2 7c0 1.1 2.2 2 5 2s5-.9 5-2';
/** The data-store (cylinder) icon, 14px, at x y. `stack`: a second one behind it (a folded head). */
export const storeIcon = (x, y, stack = false) => s('g', { class: 'sicon', transform: `translate(${x} ${y})`, 'aria-hidden': 'true' },
  stack ? s('g', { transform: 'translate(4 4)', opacity: 0.5 }, s('ellipse', { cx: 7, cy: 3.2, rx: 5, ry: 2 }), s('path', { d: ICON })) : null,
  s('ellipse', { cx: 7, cy: 3.2, rx: 5, ry: 2 }), s('path', { d: ICON }));

/**
 * drawBands(bands, { colX, headBox, columns, groups, onAdd }) -> svg nodes. bands: [{ from, to, label, row?, sub?, icon?, mark?, key? }] (column indexes, first to last).
 * A store band shows the store's logo and name; a subsystem band (`sub`) its icon, label and a spark when the subsystem is new, grey, never a component colour.
 * `groups`: the Squeeze folds (a band may end at one). `onAdd(key)`: in Edit with a draft a "+" ends a subsystem band (opens the component form with that subsystem).
 */
const GAP = 6, clip = (t, n) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
export const drawBands = (bands, { colX, headBox, columns, groups = [], onAdd = null }) => (bands ?? []).map((b) => {
  const side = (i, dir) => { const g = groups.find((f) => f.cols.includes(i)); return g ? (dir < 0 ? g.x : g.x + g.w) : colX.get(columns[i]) + (dir * headBox(columns[i])) / 2; };
  const a = columns[b.from], x = side(b.from, -1) + GAP / 2, w = side(b.to, 1) - x - GAP / 2, y = 4 + (b.row ?? 0) * BAND_H; // a small gap between neighbouring bands
  if (b.sub) return subBand(b, x, y, w, onAdd);
  const room = Math.floor((w - 36) / 6.6); // the label ends in an ellipsis when it does not fit (the title has it all)
  // With a product logo the logo names the kind, so the visible text drops the "<kind>: " prefix and keeps the store name.
  const logo = productImage('store', a.storeKind, 8, 5, 12), text = logo && b.label.startsWith(`${a.storeKind}: `) ? b.label.slice(a.storeKind.length + 2) : b.label;
  return s('g', { class: 'band', transform: `translate(${x} ${y})` }, s('rect', { width: w, height: 22, rx: 4 }), logo ?? storeIcon(8, 4), room >= 3 ? s('text', { x: 28, y: 15 }, clip(text, room)) : null, s('title', {}, b.label));
});

/** A subsystem band: icon (none: the name only), label, the New spark, and in Edit a "+" at its end. */
function subBand(b, x, y, w, onAdd) {
  const ic = b.icon ? subIcon(b.icon, 16) : null, left = ic ? 28 : 10, isNew = b.mark === 'new';
  const add = onAdd && w >= 90 ? s('g', { class: 'band-add', 'data-qa': 'band-add', 'data-key': b.key, transform: `translate(${w - 20} 2)`, tabindex: 0, role: 'button', 'aria-label': `Add a component to ${b.label}` },
    s('rect', { width: 18, height: 18, rx: 4 }), s('path', { d: 'M9 5v8M5 9h8' }), s('title', {}, `Add a component to ${b.label}`)) : null;
  const room = Math.floor((w - left - (isNew ? 22 : 8) - (add ? 22 : 0)) / 6.8), shown = clip(b.label, Math.max(room, 1));
  if (ic) { ic.setAttribute('x', 8); ic.setAttribute('y', 3); }
  add?.addEventListener('click', (e) => { e.stopPropagation(); onAdd(b.key); });
  add?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onAdd(b.key); } });
  return s('g', { class: `band sub${isNew ? ' isnew' : ''}`, 'data-sub': b.key, transform: `translate(${x} ${y})` }, s('rect', { width: w, height: 22, rx: 4 }), ic,
    room >= 3 ? s('text', { x: left, y: 15 }, shown) : null,
    isNew && room >= 3 ? s('path', { class: 'band-spark', d: GLYPH.new.d, transform: `translate(${left + shown.length * 6.8 + 4} 5)` }) : null,
    add, s('title', {}, isNew ? `${b.label} (new subsystem)` : b.label));
}

const sample = (write) => s('svg', { width: 40, height: 10, 'aria-hidden': 'true' }, s('line', { class: `lg-line${write ? ' w' : ''}`, x1: 0, x2: 33, y1: 5, y2: 5 }), s('path', { class: 'lg-head', d: 'M40 5 33 1.5V8.5z' }));
/** The legend of the data-store arrows: a read is a thin line with a dashed return, a write a heavier line with none. */
export const storeLegend = () => h('div.store-legend', { 'data-qa': 'store-legend' },
  h('span', sample(false), h('b', 'Read'), ' thin line, dashed return'), h('span', sample(true), h('b', 'Write'), ' heavier line, no return'));
