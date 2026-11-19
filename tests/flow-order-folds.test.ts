// #141 #142 #143: the sequence view with order By subsystem. A callee is reused by what is DRAWN between, folds stop at a band edge,
// and a store whose owner is not in the flow is banded with its accessor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
// @ts-ignore plain JS modules shared with the browser
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { groupLane, laneRank } from '../web/js/views/flow-group.js';
// @ts-ignore
import { bandBreaks, subBands, subSubBands } from '../web/js/views/flow-bands.js';
// @ts-ignore
import { foldGroups, displayCols } from '../web/js/views/flow-squeeze.js';

const svc = (name: string) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' }) as any;
const SUB: Record<string, string> = { a: 'x', m: 'x', api: 'y', s: 'z', owner: 'z', cred: 'ag', key: 'ag', cli: 'ag', auth: 'pf', vault: 'pf' };
const subOf = (s: string) => SUB[s] ?? '';
const subs = () => ({ assigned: true, subOf, subOf2: () => '', list: () => ['x', 'y', 'z'].map((key) => ({ key })), info: () => null, subLabel: (k: string) => k });
const names = (cols: any[]) => cols.map((c) => c.service ?? c.id);

/** services with one ingress each; `calls`: [from, to] in order; `stores`: [from, store, owner] */
function model(services: string[], calls: [string, string][], stores: [string, string, string][] = []) {
  const steps = (s: string) => [...calls.filter(([f]) => f === s).map(([, t]) => ({ type: 'egress', target: `out.${t}` })), ...stores.filter(([f]) => f === s).map(([, r]) => ({ type: 'resource', target: r, operation: 'find', access: 'read' }))].map((x, i) => ({ seq: i + 1, ...x }));
  return buildIndex({ env: 't', services: services.map(svc),
    functions: services.map((s) => ({ service: s, id: `h.${s}`, name: s, steps: steps(s) }) as any),
    ingress: services.map((s) => ({ service: s, id: `in.${s}`, bindKey: `http:GET ${s}/x`, transport: 'http', handler: `h.${s}` }) as any),
    egress: calls.map(([f, t]) => ({ service: f, id: `out.${t}`, bindKey: `http:GET ${t}/x`, transport: 'http' }) as any),
    resources: stores.flatMap(([f, r, o]) => [o, f].map((service) => ({ service, id: r, kind: 'mongodb', name: `db.${r}`, bindKey: `mongodb:db/${r}` }) as any)), channels: [], bindings: [] });
}
const run = (g: any, service: string) => trace(g, { service, ingress: `in.${service}` }, { scope: 'full' })!;
const lane = (t: any, drawnAt: any = null) => buildLane(t.messages, { scope: t.scope, participants: t.participants, drawnAt });
const drawn = (t: any, regroup = true) => { // what the view does: a pass, the drawn order, a second pass
  const first = groupLane(lane(t), subs(), true, null, null, null, regroup);
  return groupLane(lane(t, laneRank(first)), subs(), true, null, null, null, regroup);
};
const repro = () => run(model(['a', 's', 'm', 'api'], [['a', 's'], ['a', 'm'], ['m', 'api'], ['api', 's']]), 'a');

test('#141: a crossing in call order that the subsystem order removes does not give a second "called again" column', () => {
  const t = repro();
  assert.ok(lane(t).columns.some((c: any) => c.sub === 'called again'), 'call order alone: a, s, m, api crosses and s is drawn twice');
  const d = drawn(t);
  assert.deepEqual(names(d.columns).filter((n: string) => n !== 'client'), ['a', 'm', 'api', 's']);
  assert.equal(d.columns.filter((c: any) => c.service === 's').length, 1);
});

test('#141: order By call order is unchanged (the second column stays)', () => {
  const d = drawn(repro(), false);
  assert.equal(d.columns.filter((c: any) => c.service === 's').length, 2);
});

const sv = (service: string) => ({ id: `svc:${service}`, kind: 'service', service, label: service });

test('#142: a fold never crosses a subsystem band edge, so each band keeps its own fold', () => {
  const cols = [sv('s0'), sv('cred'), sv('key'), sv('cli'), sv('auth'), sv('vault'), sv('idp')];
  const brk = bandBreaks(cols, subOf);
  assert.deepEqual([...brk], [1, 4, 6]);
  const folded = new Set([1, 2, 3, 4, 5]);
  assert.equal(foldGroups(7, folded).length, 1, 'without the breaks: one mixed fold');
  assert.deepEqual(foldGroups(7, folded, brk).map((g: any) => g.cols), [[1, 2, 3], [4, 5]]);
  assert.deepEqual(displayCols(7, folded, brk).map((d: any) => d.fold), [false, true, true, false]);
  assert.deepEqual(subBands(cols, folded, subOf, undefined, brk).map((b: any) => [b.key, b.from, b.to]), [['ag', 1, 3], ['pf', 4, 5]]);
  assert.deepEqual(subSubBands(cols, folded, () => '', brk), []);
  assert.deepEqual(subBands(cols, folded, subOf).map((b: any) => b.key), [], 'the old result: a mixed fold has no band');
});

test('#143: a store whose owner has no lifeline is banded with its first accessor, not with the owner subsystem', () => {
  const t = run(model(['a', 'm', 'owner'], [['a', 'm']], [['m', 'st', 'owner']]), 'a');
  const d = groupLane(lane(t), subs(), true, null);
  const st = d.columns.find((c: any) => c.kind === 'resource');
  assert.equal(st.owner, 'owner');
  assert.equal(st.bandOwner, 'm');
  assert.deepEqual(subBands(d.columns, new Set(), subOf).map((b: any) => b.key), ['x'], 'a, m and the store are one band: no band of the owner subsystem');
});

test('#143: an owner that is in the flow keeps its store in the owner band', () => {
  const t = run(model(['a', 'm', 'owner'], [['a', 'm'], ['m', 'owner']], [['m', 'st', 'owner']]), 'a');
  const d = groupLane(lane(t), subs(), true, null);
  assert.equal(d.columns.find((c: any) => c.kind === 'resource').bandOwner, undefined);
});

const store = (d: any) => d.columns.find((c: any) => c.kind === 'resource');
const at = (d: any, f: (c: any) => boolean) => d.columns.findIndex(f);

test('#145: an owner-less store sits inside the band of its first accessor, so no band key repeats; By call order is unchanged', () => {
  const t = run(model(['cred', 'key', 'idp', 'owner'], [['cred', 'key'], ['cred', 'idp']], [['cred', 'st', 'owner']]), 'cred');
  const d = groupLane(lane(t), subs(), true, null);
  assert.equal(at(d, (c) => c.kind === 'resource'), at(d, (c) => c.service === 'cred') + 1, 'right after cred, its first accessor (not after idp, the last component)');
  const keys = subBands(d.columns, new Set(), subOf).map((b: any) => b.key);
  assert.deepEqual(keys, ['ag'], 'the store is in the Agent band');
  assert.equal(new Set(keys).size, keys.length, 'no band key repeats');
  const calls = groupLane(lane(t), subs(), true, null, null, null, false);
  assert.equal(calls.columns.at(-1), store(calls), 'By call order: the store keeps its place after the services');
});

test('#145: a store whose first accessor has no subsystem is in no band, and next to it', () => {
  const t = run(model(['idp', 'cred', 'owner'], [['idp', 'cred']], [['idp', 'st', 'owner']]), 'idp');
  const d = groupLane(lane(t), subs(), true, null);
  assert.deepEqual(subBands(d.columns, new Set(), subOf).map((b: any) => b.key), ['ag']);
  assert.equal(at(d, (c) => c.kind === 'resource'), at(d, (c) => c.service === 'idp') + 1);
});
