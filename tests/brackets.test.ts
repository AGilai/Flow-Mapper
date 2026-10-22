// 0.34.0: the pure parts of comment brackets: what the walk makes of a range now, the URL's steps=, picking a step by y, the gutter's column layout, and the
// Mermaid rect + Note blocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { rangeLook, rangeText, stepsParam, ordered, stepAtY } from '../web/js/comments/range.js';
// @ts-ignore
import { assignColumns, groupRanges, bubbleTops, BUBBLE_H, SLIDE } from '../web/js/brackets/layout.js';
// @ts-ignore
import { decodeCb, encodeCb } from '../web/js/views/step-details-pure.js';
import { rangeBlocks, RECT } from '../core/mermaid-ranges.ts';
import { clampRef } from '../core/notes.ts';

const nOf = (m: Record<string, number>) => (k: string) => m[k] ?? null;

test('rangeLook: both ends = the range in order; one end gone = a pin on the other; both gone = a plain comment', () => {
  assert.deepEqual(rangeLook({ from: 'a', to: 'b' }, nOf({ a: 4, b: 9 })), { kind: 'range', from: 4, to: 9 });
  assert.deepEqual(rangeLook({ from: 'a', to: 'b' }, nOf({ a: 9, b: 4 })), { kind: 'range', from: 4, to: 9 }, 'a reorder never flips it');
  assert.deepEqual(rangeLook({ from: 'a', to: 'b' }, nOf({ b: 7 })), { kind: 'pin', n: 7 });
  assert.deepEqual(rangeLook({ from: 'a', to: 'b' }, nOf({ a: 3, b: 3 })), { kind: 'pin', n: 3 });
  assert.equal(rangeLook({ from: 'a', to: 'b' }, nOf({})), null);
  assert.equal(rangeLook(null, nOf({})), null);
  assert.deepEqual([rangeText({ kind: 'range', from: 4, to: 9 }), rangeText({ kind: 'pin', n: 7 })], ['steps 4–9', 'step 7']);
});

test('steps= of the URL, ordered ends, the step under a y', () => {
  assert.deepEqual(stepsParam(new URLSearchParams('steps=4-9')), { from: 4, to: 9 });
  for (const bad of ['steps=9-4', 'steps=4-4', 'steps=a-b', 'steps=4', '']) assert.equal(stepsParam(new URLSearchParams(bad)), null, bad);
  assert.deepEqual(ordered(9, 4), { from: 4, to: 9 }); assert.equal(ordered(3, 3), null); assert.equal(ordered(null, 3), null);
  const rows = [{ n: 1, top: 0, bottom: 30 }, { n: 2, top: 30, bottom: 60 }, { n: 3, top: 80, bottom: 110 }];
  assert.deepEqual([stepAtY(rows, 10), stepAtY(rows, 45), stepAtY(rows, 66), stepAtY(rows, 75), stepAtY(rows, 500), stepAtY([], 5)], [1, 2, 2, 3, 3, null]);
});

test('columns: longer first, reuse after a range ends, at most 3 (2 at 760) and the rest "+n"', () => {
  const r = (id: string, from: number, to: number) => ({ id, from, to });
  const { placed, hidden } = assignColumns([r('A', 2, 5), r('B', 5, 9), r('C', 8, 11)], 3);
  assert.deepEqual(placed.map((p: any) => [p.id, p.col]), [['A', 0], ['B', 1], ['C', 0]], 'C starts after A ended: it takes column 0 again');
  assert.equal(hidden.length, 0);
  const four = assignColumns([r('A', 1, 10), r('B', 2, 9), r('C', 3, 8), r('D', 4, 7)], 3);
  assert.deepEqual([four.placed.length, four.hidden.map((h: any) => h.id)], [3, ['D']]);
  const two = assignColumns([r('A', 1, 10), r('B', 2, 9), r('C', 3, 8)], 2);
  assert.deepEqual([two.placed.length, two.hidden.map((h: any) => h.id)], [2, ['C']]);
  assert.deepEqual(assignColumns([r('X', 4, 6), r('Y', 4, 8)], 3).placed.map((p: any) => p.id), ['Y', 'X'], 'the longer one first');
});

test('groupRanges: comments on the same range share a bracket with their count; bubbles slide down 17 px when they would touch', () => {
  const g = groupRanges([{ id: 1, from: 2, to: 5, text: 'a' }, { id: 2, from: 2, to: 5 }, { id: 3, from: 5, to: 9 }]);
  assert.deepEqual(g.map((x: any) => [x.id, x.n, x.ids]), [['2-5', 2, [1, 2]], ['5-9', 1, [3]]]);
  const tops = bubbleTops([{ id: 'A', col: 0, y0: 100, y1: 200 }, { id: 'B', col: 1, y0: 100, y1: 200 }, { id: 'C', col: 2, y0: 100, y1: 200 }]);
  assert.equal(tops.get('A'), 143); // (100+200)/2 - 7.5, rounded
  assert.equal(tops.get('B') - tops.get('A'), SLIDE);
  assert.equal(tops.get('C') - tops.get('B'), SLIDE);
  const short = bubbleTops([{ id: 'A', col: 0, y0: 10, y1: 30 }, { id: 'B', col: 1, y0: 10, y1: 30 }]);
  assert.ok(short.get('B') <= 30 - BUBBLE_H, 'a bubble never leaves its range');
});

test('the layer toggle: cb=1 / cb=0 in the URL, written only when it differs from the default of the environment', () => {
  assert.equal(decodeCb(new URLSearchParams('cb=1')), true); assert.equal(decodeCb(new URLSearchParams('cb=0')), false); assert.equal(decodeCb(new URLSearchParams('')), null);
  assert.equal(encodeCb(true, true), null); assert.equal(encodeCb(false, true), '0'); assert.equal(encodeCb(true, false), '1');
});

test('clampRef (Notes chips): what remains of a range when the flow lost steps', () => {
  assert.deepEqual(clampRef({ from: 4, to: 9 }, 12), { from: 4, to: 9, was: null });
  assert.deepEqual(clampRef({ from: 4, to: 9 }, 7), { from: 4, to: 7, was: { from: 4, to: 9 } });
  assert.equal(clampRef({ from: 8, to: 9 }, 7), null);
  assert.deepEqual(clampRef({ from: 8, to: 9 }, 0), { from: 8, to: 9, was: null }, 'steps not known yet: the reference stands');
});

test('mermaid rect blocks: a range around the written messages, nested ones inside, crossing ones left out', () => {
  const all = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5'];
  const kept = [{ index: 0, a: 'C', b: 'A' }, { index: 1, a: 'A', b: 'B' }, { index: 3, a: 'B', b: 'D' }, { index: 4, a: 'D', b: 'D' }, { index: 5, a: 'A', b: 'B' }]; // k2 is internal: not written
  const order = ['C', 'A', 'B', 'D'];
  const r = rangeBlocks(all, kept, order, [{ from: 'k1', to: 'k4', text: 'outer' }, { from: 'k2', to: 'k3', text: 'inner' }, { from: 'k3', to: 'k5', text: 'crosses' }, { from: 'zz', to: 'k1', text: 'unknown' }, { from: 'k0', to: 'k0', text: '' }]);
  assert.deepEqual(r.before.get(1), [RECT, '  Note over A,D: outer']);
  assert.deepEqual(r.before.get(2), [RECT, '  Note over B,D: inner'], 'k2 is not written: the inner range starts at the next written message');
  assert.deepEqual([r.after.get(2), r.after.get(3)], [['end'], ['end']], 'the inner ends at k3, the outer at k4');
  assert.equal(r.before.get(3), undefined, 'the crossing range is not written');
});
