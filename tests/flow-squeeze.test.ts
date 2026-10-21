// 0.20.1: Squeeze, the pure part (web/js/views/flow-squeeze.js) and how the lane layout uses it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { FOLD_W, FOLD_COMPACT, COL_NARROW, planSqueeze, planFold, foldGroups, displayCols, foldedInside, foldKey, eventCols, groupOf, firstStepCols, colsOfEvent } from '../web/js/views/flow-squeeze.js';
// @ts-ignore
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { layoutLane } from '../web/js/views/flow-draw-layout.js';
// @ts-ignore
import { isStep } from '../web/js/views/flow-steps.js';

// a lane of n columns, 100 px each plus 20 px of margin; a fold column costs FOLD_W
const widthOf = (n: number) => (folded: Set<number>) => 20 + (n - folded.size) * 100 + foldGroups(n, folded).length * FOLD_W;
const plan = (n: number, ends: number[], fit: number, caller = 0) => [...planFold({ n, ends, fit, widthOf: widthOf(n), caller })].sort((a, b) => a - b);

test('squeeze: nothing folds when the lane fits, or when there is no limit', () => {
  assert.deepEqual(plan(5, [1, 2], 520), []);
  assert.deepEqual(plan(5, [1, 2], 0), []);
  assert.deepEqual(plan(5, [3, 4], 1000), []);
});

test('squeeze: columns between the caller and the step fold into one run', () => {
  // 7 columns = 720; fit 600. Step 5 -> 6: 1..4 sit between the caller and the step
  assert.deepEqual(plan(7, [5, 6], 600), [1, 2, 3, 4]);
  assert.equal(foldGroups(7, new Set([1, 2, 3, 4])).length, 1);
});

test('squeeze: the caller and both ends of the step are never folded', () => {
  for (const ends of [[2, 4], [1, 5], [6, 3], [0, 6]]) {
    const folded = plan(7, ends, 300);
    for (const c of [0, ...ends]) assert.ok(!folded.includes(c), `${c} kept for ${ends}`);
  }
});

test('squeeze: a step between neighbours folds the columns beyond, farthest first', () => {
  // step 0 -> 1 of 8 columns (820); fit 520: nothing between, so fold from the far right until it fits
  assert.deepEqual(plan(8, [0, 1], 520), [4, 5, 6, 7]);
  // one column less to fold: fit 620 needs 3 folds of the far end (820 - 300 + 100 = 620)
  assert.deepEqual(plan(8, [0, 1], 620), [5, 6, 7]);
});

test('squeeze: multiple groups when the step ends are apart', () => {
  // 10 columns (1020), step 3 -> 6, fit 720: 1,2 and 4,5 fold first; 7..9 then fold farthest first (9, then 8) until it fits
  const folded = new Set(plan(10, [3, 6], 720));
  assert.deepEqual(foldGroups(10, folded).map((x: any) => x.cols), [[1, 2], [4, 5], [8, 9]]);
  assert.ok(widthOf(10)(folded) <= 720);
  assert.deepEqual(foldGroups(10, new Set(plan(10, [3, 6], 650))).map((x: any) => x.cols), [[1, 2], [4, 5], [7, 8, 9]], 'a tighter room folds the whole tail');
});

test('squeeze: the current step at the far right keeps the caller and folds the middle', () => {
  assert.deepEqual(plan(9, [7, 8], 450), [1, 2, 3, 4, 5, 6]);
  const folded = new Set(plan(9, [7, 8], 450));
  assert.deepEqual(displayCols(9, folded).map((d: any) => (d.fold ? 'f' : d.cols[0])), [0, 'f', 7, 8]);
});

test('squeeze: further folds go farthest from the step first', () => {
  // 9 columns, step 3 -> 4: 1,2 fold first. Distances from {3,4}: 5->1, 6->2, 7->3, 8->4, so 8 goes first, then 7, then 6
  assert.deepEqual(plan(9, [3, 4], 820), [1, 2]);
  assert.deepEqual(plan(9, [3, 4], 800), [1, 2, 7, 8], '8 alone saves nothing (a fold costs a column), so 7 joins it');
  assert.deepEqual(plan(9, [3, 4], 700), [1, 2, 6, 7, 8]);
  // with a column wider than a fold the order shows: after 1,2 the farthest (8) folds first, then 7
  const wide = (f: Set<number>) => 20 + (9 - f.size) * 120 + foldGroups(9, f).length * FOLD_W;
  assert.deepEqual([...planFold({ n: 9, ends: [3, 4], fit: 950, widthOf: wide })].sort((a, b) => a - b), [1, 2, 8]);
  assert.deepEqual([...planFold({ n: 9, ends: [3, 4], fit: 930, widthOf: wide })].sort((a, b) => a - b), [1, 2, 7, 8]);
  // ends 1 and 3 of 6: 2 sits between them and folds; 4 and 5 fold from the far end
  assert.deepEqual(plan(6, [1, 3], 420), [2, 4, 5]);
});

test('squeeze: a step inside a fold (both ends folded) is found by foldedInside', () => {
  const groups = foldGroups(8, new Set([2, 3, 4, 6]));
  assert.equal(foldedInside([3, 4], groups), 0, 'a step from 3 to 4 runs inside the first fold');
  assert.equal(foldedInside([3], groups), 0);
  assert.equal(foldedInside([4, 6], groups), -1, 'two different folds are not one');
  assert.equal(foldedInside([1, 3], groups), -1, 'a visible end');
  assert.equal(foldedInside([], groups), -1);
  assert.equal(groupOf(groups, 6), 1);
  assert.equal(groupOf(groups, 5), -1);
});

test('squeeze: narrow widths fold everything it may, and give up gracefully', () => {
  // 6 columns, step 2 -> 3, fit 100: caller, 2 and 3 are kept, so only 1, 4, 5 fold
  assert.deepEqual(plan(6, [2, 3], 100), [1, 4, 5]);
  // a lane with nothing to fold (3 columns, all kept) is left alone
  assert.deepEqual(plan(3, [1, 2], 100), []);
  // fewer than 3 columns never fold
  assert.deepEqual(plan(2, [1], 50), []);
});

test('squeeze: a plan wider than the unfolded lane is dropped', () => {
  // folding one narrow column into a fold column costs more than it saves
  const w = (f: Set<number>) => 500 + f.size * 10 + foldGroups(5, f).length * FOLD_W;
  assert.equal(planFold({ n: 5, ends: [1, 2], fit: 400, widthOf: w }).size, 0);
});

test('squeeze: no step (empty ends) keeps only the caller and folds from the far end', () => {
  const folded = plan(6, [], 420);
  assert.ok(!folded.includes(0) && folded.includes(5));
});

test('squeeze: foldGroups, displayCols and foldKey', () => {
  const f = new Set([1, 2, 5]);
  assert.deepEqual(foldGroups(7, f), [{ from: 1, to: 2, cols: [1, 2] }, { from: 5, to: 5, cols: [5] }]);
  assert.deepEqual(displayCols(7, f).map((d: any) => (d.fold ? `f${d.cols.join('')}` : String(d.cols[0]))), ['0', 'f12', '3', '4', 'f5', '6']);
  assert.equal(foldKey(new Set([5, 1, 2])), '1,2,5');
  assert.equal(foldKey(new Set()), '');
});

// ---- on a real lane ----
const g = buildIndex(sampleModel());
const t = trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full', maxMessages: 800 })!;
const lane = buildLane(t.messages, { scope: t.scope, participants: t.participants });
const steps = lane.events.filter(isStep);

test('squeeze layout: no squeeze, or a lane that fits, is drawn exactly as before', () => {
  const full = layoutLane(lane, 0).width;
  assert.equal(layoutLane(lane, full + 50, { keep: [0, 1] }).folded.size, 0);
  assert.equal(layoutLane(lane, 300).folded.size, 0, 'Squeeze off (no sq): today, a horizontal scroll');
  assert.deepEqual(layoutLane(lane, 0, { keep: [0, 1] }).groups, []);
});

test('squeeze layout: a narrow room folds, keeps the step ends, and shrinks the lane', () => {
  const full = layoutLane(lane, 0).width, keep = colsOfEvent(lane, steps[1]);
  const L = layoutLane(lane, 700, { keep });
  assert.ok(L.folded.size > 0 && L.width < full);
  for (const c of [0, ...keep]) assert.ok(!L.folded.has(c));
  // every fold run is one x; its columns share it; an arrow into it stops at its edge
  for (const gr of L.groups) for (const c of gr.cols) assert.equal(L.xs[c], gr.x);
  const bar = L.bars.find((b: any) => L.folded.has(L.idx.get(b.col)));
  if (bar) { assert.equal(L.barX(bar, -1), L.colX.get(bar.col)); assert.equal(L.barX(bar, 1), L.colX.get(bar.col) + L.foldW); }
  // visible columns keep their order, left to right, and clear each fold
  const vis = L.columns.map((_: any, i: number) => i).filter((i: number) => !L.folded.has(i));
  for (let k = 1; k < vis.length; k++) assert.ok(L.xs[vis[k]] > L.xs[vis[k - 1]]);
});

test('squeeze layout: plan(keep) answers for another step without drawing', () => {
  const L = layoutLane(lane, 700, { keep: colsOfEvent(lane, steps[0]) });
  const later = colsOfEvent(lane, steps[steps.length - 1]);
  const next = L.plan(later);
  for (const c of later) assert.ok(!next.folded.has(c));
  assert.notEqual(next.key, L.sig, 'walking to the last step folds differently');
});

test('squeeze: eventCols reads the lifelines of every row type, firstStepCols the first step', () => {
  const idx = new Map(lane.columns.map((c: any, i: number) => [c, i]));
  const first = steps[0];
  assert.deepEqual(eventCols(first, idx), firstStepCols(lane));
  for (const e of lane.events) assert.ok(eventCols(e, idx).every((i: number) => i >= 0 && i < lane.columns.length));
  const ret = lane.events.find((e: any) => e.type === 'return');
  assert.equal(eventCols(ret, idx).length >= 1, true);
});

// ---- the fallback stages: the step's two ends win over context ----
// toy lane: columns of 100 (70 when narrowed), a fold costs foldW
const sw = (n: number) => (f: Set<number>, o: { foldW: number; narrow: boolean }) => 20 + (n - f.size) * (o.narrow ? 70 : 100) + foldGroups(n, f).length * o.foldW;
const stage = (n: number, ends: number[], fit: number) => planSqueeze({ n, ends, fit, widthOf: sw(n) });

test('squeeze stages: nothing to do when it fits', () => {
  const r = stage(6, [1, 2], 700);
  assert.equal(r.folded.size, 0); assert.equal(r.key, ''); assert.equal(r.stage, -1);
});

test('squeeze stages: 0 keeps the caller', () => {
  const r = stage(6, [1, 2], 430); // fold 3..5: 20 + 300 + 100
  assert.equal(r.stage, 0); assert.ok(r.fits); assert.ok(!r.folded.has(0)); assert.equal(r.foldW, FOLD_W);
});

test('squeeze stages: 1 folds the caller too', () => {
  // ends 3,4: caller kept = 20+300+2 folds (1-2, 5) = 520; caller folded = 20+300+1 fold (0-2) = 420
  const r = stage(6, [3, 4], 430);
  assert.equal(r.stage, 1); assert.ok(r.fits);
  assert.deepEqual([...r.folded].sort(), [0, 1, 2], 'the caller joins the leftmost fold');
  assert.equal(foldGroups(6, r.folded)[0].cols.join(), '0,1,2');
  assert.ok(!r.folded.has(3) && !r.folded.has(4), 'both ends stay');
});

test('squeeze stages: 2 makes the folds compact', () => {
  const r = stage(6, [3, 4], 390); // two folds of 100 = 420 do not fit, two of 60 = 340 do
  assert.equal(r.stage, 2); assert.ok(r.fits); assert.equal(r.foldW, FOLD_COMPACT); assert.equal(r.narrow, false);
});

test('squeeze stages: 3 narrows the kept columns', () => {
  const r = stage(6, [3, 4], 300); // compact folds still 340; with 70-wide columns 20 + 140 + 120 = 280
  assert.equal(r.stage, 3); assert.ok(r.fits); assert.equal(r.narrow, true); assert.equal(r.foldW, FOLD_COMPACT);
  assert.ok(COL_NARROW < 132);
});

test('squeeze stages: nothing fits -> the last stage, fits false (the lane scrolls)', () => {
  const r = stage(6, [3, 4], 100);
  assert.equal(r.fits, false); assert.equal(r.stage, 3); assert.ok(r.folded.size > 0);
  assert.ok(!r.folded.has(3) && !r.folded.has(4));
});

test('squeeze stages: on a real lane both ends stay unfolded and the lane never grows in a tighter room', () => {
  const keep = colsOfEvent(lane, steps[7]), full = layoutLane(lane, 0).width;
  const ls = [900, 640, 520, 420].map((fit) => layoutLane(lane, fit, { keep }));
  for (const L of ls) { for (const c of keep) assert.ok(!L.folded.has(c)); assert.ok(L.width < full); }
  for (let i = 1; i < ls.length; i++) assert.ok(ls[i].width <= ls[i - 1].width);
  assert.ok(ls[3].foldW <= FOLD_W);
});

// ---- scroll target when it still scrolls ----
// @ts-ignore
import { scrollLeftFor } from '../web/js/views/flow-walk.js';
test('scrollLeftFor: both ends in view when they fit, else the source end', () => {
  assert.equal(scrollLeftFor({ from: 100, to: 400, left: 0, view: 500 }), 0, 'already in view: no move');
  assert.equal(scrollLeftFor({ from: 100, to: 400, left: 300, view: 500 }), 84, 'the left end was cut: bring it in');
  assert.equal(scrollLeftFor({ from: 700, to: 1000, left: 0, view: 500 }), 516, 'the right end was out of view');
  assert.equal(scrollLeftFor({ from: 100, to: 1200, left: 600, view: 500 }), 84, 'too wide: the source end (leftward start)');
  assert.equal(scrollLeftFor({ from: 1200, to: 100, left: 0, view: 500 }), 716, 'too wide, a return: the source end on the right');
});
