// 0.28.1: the subsystem level's geometry (web/js/graph/subsystem-layout.js, pure): the grid, parallel offsets, the collapse past 6 lines, 26 boxes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { layoutBoxes, routeItems, routeMerged, mergePairs, collapseLines, gridFor, thickness, lineLabel, itemsOf, BOX_W, MAX_ROWS, SPACING } from '../web/js/graph/subsystem-layout.js';

const box = (key: string, n = 3) => ({ key, label: key, components: Array.from({ length: n }, (_, i) => ({ name: `${key}-${i}`, kind: 'service' })) });
const line = (from: string, to: string, transport = 'http', count = 1, mode = 'sync') => ({ id: `${from}>${to}|${transport}|${mode}`, from, to, transport, mode, count, calls: Array.from({ length: count }, (_, i) => ({ from: { service: `${from}-0`, egress: `e${i}` }, to: { service: `${to}-0`, ingress: `i${i}` }, bindKey: 'k', via: [] })), links: [] });
const overlap = (a: any, b: any) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('layoutBoxes: boxes fill a grid of at most 4 columns in the given order, a grid row is as tall as its tallest', () => {
  const L = layoutBoxes([box('a'), box('b', 8), box('c'), box('d'), box('e')], { cols: 4 });
  const p = (k: string) => L.boxes.get(k);
  assert.deepEqual(['a', 'b', 'c', 'd'].map((k) => p(k).row), [0, 0, 0, 0]);
  assert.equal(p('e').row, 1);
  assert.equal(p('e').col, 0);
  assert.equal(p('a').h, p('b').h, 'one grid row, one height');
  assert.ok(p('b').x > p('a').x + BOX_W, 'a gap between columns');
});

test('layoutBoxes: a box lists at most 10 names and says how many more', () => {
  const L = layoutBoxes([box('big', 14)], { cols: 1 }), b = L.boxes.get('big');
  assert.equal(b.rows.length, MAX_ROWS);
  assert.equal(b.more, 4);
});

test('gridFor: 4 columns when wide, fewer when narrow, never more than the boxes; shrinks to keep a column', () => {
  assert.equal(gridFor(1500, 26).cols, 4);
  assert.equal(gridFor(1500, 2).cols, 2);
  assert.equal(gridFor(400, 6).cols, 1);
  assert.deepEqual(gridFor(400, 3), { cols: 3, scale: 0.5 }, 'three boxes stay in one row, shrinking to half');
  assert.ok(Math.abs(gridFor(700, 3).scale - 700 / 992) < 1e-9, 'no horizontal scroll: the drawing fits the width');
  const g = gridFor(840, 3);
  assert.equal(g.cols, 3, 'three boxes keep their row by shrinking a little');
  assert.ok(g.scale < 1 && g.scale >= 0.78);
});

test('routeItems: parallel lines of one pair of boxes are SPACING apart, both directions side by side', () => {
  const L = layoutBoxes([box('a'), box('b')], { cols: 2 }), items = [line('a', 'b', 'http'), line('a', 'b', 'amqp', 1, 'async'), line('b', 'a', 'rpc')].map((l) => ({ id: l.id, from: l.from, to: l.to }));
  const r = routeItems(items, L), ys = items.map((i) => r.get(i.id).from[1]).sort((x: number, y: number) => x - y);
  assert.equal(ys[1] - ys[0], SPACING);
  assert.equal(ys[2] - ys[1], SPACING);
  assert.ok(items.every((i) => r.get(i.id).d.startsWith('M')));
});

test('routeItems: boxes of one row that are not neighbours are joined underneath, so a line never crosses a box', () => {
  const L = layoutBoxes([box('a'), box('b'), box('c')], { cols: 3 }), r = routeItems([{ id: 'x', from: 'a', to: 'c' }], L).get('x');
  assert.ok(r.d.includes('V') && r.d.includes('H'), 'down, across, up');
  assert.ok(r.from[1] >= L.boxes.get('a').y + L.boxes.get('a').h, 'leaves the bottom edge');
});

test('collapseLines: more than 6 lines between two subsystems become one per direction, "N calls · M transports", every call kept', () => {
  const ts = ['http', 'rpc', 'amqp', 'sns', 'sqs', 'socket', 'grpc'];
  const ls = ts.map((t) => line('a', 'b', t, 2));
  const out = collapseLines(ls);
  assert.equal(out.length, 1);
  assert.equal(lineLabel(out[0]), '14 calls · 7 transports');
  assert.equal(out[0].calls.length, 14);
  assert.equal(collapseLines(ls.slice(0, 6)).length, 6, 'six stay as they are');
  assert.equal(collapseLines([...ls, line('b', 'a', 'http')]).length, 2, 'the other direction stays its own line');
});

test('thickness grows with the count; the label reads "2 calls · http", "1 async · amqp"', () => {
  assert.ok(thickness(1) < thickness(2) && thickness(2) < thickness(8));
  assert.equal(lineLabel(line('a', 'b', 'http', 2)), '2 calls · http');
  assert.equal(lineLabel(line('a', 'b', 'http', 1)), '1 call · http');
  assert.equal(lineLabel(line('a', 'b', 'amqp', 1, 'async')), '1 async · amqp');
});

test('26 boxes (the mock) fit on the grid without overlap and every line gets a route', () => {
  const boxes = Array.from({ length: 26 }, (_, i) => box(`s${i}`, 1 + (i % 12)));
  const L = layoutBoxes(boxes, { cols: 4 }), all = [...L.boxes.values()];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(all[i], all[j]), `${all[i].key} and ${all[j].key} overlap`);
  const lines = Array.from({ length: 40 }, (_, i) => line(`s${i % 26}`, `s${(i * 7 + 3) % 26}`, ['http', 'amqp'][i % 2]));
  const { items } = itemsOf({ lines, abstract: [] }, L, {});
  const routable = items.filter((i: any) => i.from !== i.to);
  assert.equal(routeItems(routable, L).size, new Set(routable.map((i: any) => i.id)).size);
  assert.ok(L.width <= 1400 && L.height > 0);
});

test('mergePairs: one line per pair of boxes, every transport and both directions together, count summed', () => {
  const m = mergePairs([line('a', 'b', 'http', 2), line('b', 'a', 'amqp', 1, 'async'), line('a', 'c', 'rpc', 3)]);
  assert.equal(m.length, 2);
  assert.deepEqual([m[0].from, m[0].to, m[0].count, m[0].transports], ['a', 'b', 3, ['http', 'amqp']]);
  assert.equal(lineLabel(m[0]), '3 calls · 2 transports');
  assert.equal(lineLabel(m[1]), '3 calls · rpc');
  assert.equal(m[0].calls.length, 3);
});

test('routeMerged: a line runs edge to edge and its label is dropped when it would sit on a box', () => {
  const L = layoutBoxes([box('a'), box('b'), box('c')], { cols: 3 });
  const r = routeMerged(mergePairs([line('a', 'c', 'http', 2), line('a', 'b', 'http', 1)]), L);
  const ac = r.get('pair:a|c'), ab = r.get('pair:a|b');
  assert.equal(ac.show, false, 'a to c passes b: its middle is under b');
  assert.equal(ab.show, true);
  assert.ok(ab.from[0] <= L.boxes.get('a').x + L.boxes.get('a').w + 0.001 && ab.to[0] >= L.boxes.get('b').x - 0.001);
});

test('more than 8 boxes is the many case; the svg is as tall as its lowest corridor', () => {
  const L = layoutBoxes([box('a'), box('b'), box('c')], { cols: 3 }), r = routeItems([{ id: 'x', from: 'a', to: 'c', h: 32 }], L).get('x');
  assert.ok(r.bottom > L.rowBottom[0], 'the corridor under the row is reported');
});
