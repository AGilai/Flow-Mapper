// 0.28.1: subsystem regions on the component-level map (web/js/graph/graph-regions.js, pure) and the column option of the layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { regionsOf, regionText, regionAt, regionCells, REGION_PAD, REGION_HEAD } from '../web/js/graph/graph-regions.js';
// @ts-ignore
import { layout } from '../web/js/graph/layout.js';
// @ts-ignore
import { createSubsystems } from '../web/js/design/subsystems-store.js';
// @ts-ignore
import { createMarks } from '../web/js/design/marks-store.js';

const node = (name: string) => ({ id: `svc:${name}`, kind: 'service', label: name });
const subs = createSubsystems({ subsystems: [{ key: 'agent', label: 'Agent', components: [{ name: 'app' }] }, { key: 'plat', label: 'Platform', components: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }] });

test('regionText: the split of new, prod and changed components, as in frame 2', () => {
  assert.equal(regionText(9, 3, 2, true), '9 components: 3 new, 6 from prod (2 changed)');
  assert.equal(regionText(4, 4, 0, true), '4 components, all new');
  assert.equal(regionText(1, 1, 0, true), '1 component, all new');
  assert.equal(regionText(5, 0, 2, true), '5 components: 2 changed');
  assert.equal(regionText(6, 0, 0, true), '6 components');
  assert.equal(regionText(6, 2, 1, false), '6 components', 'a sealed environment has no marks to count');
});

test('regionsOf: a rect round the members of each subsystem in the environment\'s order, with head room; a component with no subsystem is in none', () => {
  const nodes = ['app', 'a', 'b', 'c', 'loose'].map(node), pos = new Map([['svc:app', { x: 0, y: 0 }], ['svc:a', { x: 300, y: 0 }], ['svc:b', { x: 500, y: 200 }], ['svc:c', { x: 400, y: 100 }], ['svc:loose', { x: 900, y: 900 }]]);
  const marks = createMarks({ marks: { 'svc:app': { mark: 'new' }, 'svc:a': { mark: 'new' }, 'svc:b': { mark: 'changed' } } });
  const rs = regionsOf(nodes, pos, subs, marks);
  assert.deepEqual(rs.map((r: any) => r.key), ['agent', 'plat']);
  const p = rs[1];
  assert.ok(p.x <= 300 - REGION_PAD, 'at least the members and their padding');
  assert.equal(p.y, 0 - REGION_PAD - REGION_HEAD);
  assert.ok(p.w >= 200 + 2 * REGION_PAD, 'the members, their padding, and room for the head text');
  assert.equal(p.text, '3 components: 1 new, 2 from prod (1 changed)');
  assert.deepEqual(p.ids, ['svc:a', 'svc:b', 'svc:c']);
  assert.ok(rs[0].w >= 'Agent'.length * 8, 'a region with one component is still wide enough for its head');
});

test('regionAt: the head is the click target, the empty part of a region is not', () => {
  const r = { x: 0, y: 0, w: 100, h: 200 };
  assert.equal(regionAt([r], 50, 10), r);
  assert.equal(regionAt([r], 50, REGION_HEAD + 20), null);
});

test('layout columnOf: members of a column end up near the column, y stays free, deterministic', () => {
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, group: i < 6 ? 'x' : 'y' })), edges = [{ from: 'n0', to: 'n7' }, { from: 'n3', to: 'n9' }];
  const columnOf = new Map(nodes.map((n, i) => [n.id, i < 6 ? 0 : 1]));
  const a = layout(nodes, edges, { iterations: 120, columnOf }), b = layout(nodes, edges, { iterations: 120, columnOf });
  assert.deepEqual([...a.values()], [...b.values()]);
  const mean = (ids: string[]) => ids.reduce((s, id) => s + a.get(id).x, 0) / ids.length;
  assert.ok(mean(nodes.slice(6).map((n) => n.id)) - mean(nodes.slice(0, 6).map((n) => n.id)) > 150, 'column 1 sits right of column 0');
  const ys = nodes.map((n) => a.get(n.id).y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 40, 'y is free');
});

test('regionCells: about ceil(sqrt(n)) columns, cells never overlap, nodes of a cell stay inside it', () => {
  const groups = Array.from({ length: 26 }, (_, i) => ({ key: `g${i}`, count: 1 + (i % 9) })), cells = regionCells(groups), all = [...cells.values()];
  const cols = new Set(all.map((c: any) => Math.round(c.x0 / 5))).size;
  assert.ok(cols <= 7 && cols >= 5, `a grid of about 6 columns, got ${cols}`);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a: any = all[i], b: any = all[j], pad = REGION_PAD;
    const ra = { x0: a.x0 - pad, x1: a.x1 + pad, y0: a.y0 - pad - REGION_HEAD, y1: a.y1 + pad }, rb = { x0: b.x0 - pad, x1: b.x1 + pad, y0: b.y0 - pad - REGION_HEAD, y1: b.y1 + pad };
    assert.ok(ra.x1 <= rb.x0 || rb.x1 <= ra.x0 || ra.y1 <= rb.y0 || rb.y1 <= ra.y0, `regions of g${i} and g${j} overlap`);
  }
});

test('layout bounds: every node stays inside its cell', () => {
  const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, group: i < 5 ? 'x' : 'y' })), bounds = new Map(nodes.map((n, i) => [n.id, i < 5 ? { x0: 0, y0: 0, x1: 100, y1: 100 } : { x0: 400, y0: 0, x1: 500, y1: 100 }]));
  const p = layout(nodes, [{ from: 'n0', to: 'n9' }], { iterations: 100, bounds });
  for (const n of nodes) { const b: any = bounds.get(n.id), q = p.get(n.id); assert.ok(q.x >= b.x0 && q.x <= b.x1 && q.y >= b.y0 && q.y <= b.y1, n.id); }
});
