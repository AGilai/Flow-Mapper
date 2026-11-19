// The legend of the arrows (frame 33c): the data-store Read / Write pair (only when the lane has data-store arrows), then the three arrow kinds:
// sync (filled head), async (open head + the bolt on its number), return (dashed, open head, "↩N" names the call it answers).
// One static element: flow-draw.js puts a placeholder in the lane (data-stores tells whether it has stores), flow-tab-view.js shows this one in the caption bar or as a chip.

import { h, s } from '../dom.js';

const BOLT = 'M2.6 0 L-2.2 5.4 H0.4 L-1 10 L3.4 4 H0.8 Z';
const sample = (write) => s('svg', { width: 40, height: 10, 'aria-hidden': 'true' }, s('line', { class: `lg-line${write ? ' w' : ''}`, x1: 0, x2: 33, y1: 5, y2: 5 }), s('path', { class: 'lg-head', d: 'M40 5 33 1.5V8.5z' }));
const kind = (cls) => s('svg', { class: 'lg-k', width: 34, height: 12, viewBox: '0 0 34 12', 'aria-hidden': 'true' },
  s('line', { class: `lg-kl${cls === 'ret' ? ' d' : ''}`, x1: 0, x2: cls === 'sync' ? 24 : 29, y1: 6, y2: 6 }),
  cls === 'sync' ? s('path', { class: 'lg-kh f', d: 'M30 6 21 1.8v8.4z' }) : s('path', { class: 'lg-kh', d: 'M23 1.5 30 6 23 10.5' }));
const bub = (text, bolt) => s('svg', { class: 'lg-b', width: bolt ? 30 : 26, height: 16, viewBox: `0 0 ${bolt ? 30 : 26} 16`, 'aria-hidden': 'true' },
  s('rect', { x: 0.6, y: 0.6, width: (bolt ? 30 : 26) - 1.2, height: 14.8, rx: 7.4 }), s('text', { x: bolt ? 10 : 13, y: 11.4, 'text-anchor': 'middle' }, text), bolt ? s('path', { class: 'bolt', d: BOLT, transform: 'translate(18 2.5)' }) : null);

/** flowLegend(stores = true) -> the legend element (class store-legend: the flow tab finds it by that name). */
export const flowLegend = (stores = true) => h('div.store-legend', { 'data-qa': 'store-legend', 'data-stores': stores ? '1' : '0' },
  h('span.lg-rw', { title: 'Read: a thin line, dashed return' }, sample(false), h('b', 'Read'), h('span.lg-x', ' thin line, dashed return')),
  h('span.lg-rw', { title: 'Write: a heavier line, no return' }, sample(true), h('b', 'Write'), h('span.lg-x', ' heavier line, no return')),
  h('span.lg-first', { title: 'Sync: the caller waits for the answer' }, kind('sync'), h('b', 'Sync')),
  h('span', { title: 'Async: the caller does not wait. Never dashed.' }, kind('async'), h('b', 'Async')), h('span', { title: 'The bolt marks the number of an async call' }, bub('3', true)),
  h('span', { title: 'Return: the answer to a sync call' }, kind('ret'), h('b', 'Return')), h('span', { title: 'A return names the call it answers' }, bub('↩4'), h('span.lg-t', 'answers call 4')));
