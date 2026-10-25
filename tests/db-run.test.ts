// 0.43.3 (#88 follow-up): the run a store call belongs to, and the "Calls in this run" block of an expanded call's pane.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { viewOf } from '../core/trace-view.ts';
import { dbRunOf, runCardModel, runContext } from '../core/db-run.ts';

const svc = (name: string) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' });
const redis = (seq: number, op: string, target = 'r') => ({ seq, type: 'resource', target, operation: op });
const model: any = { env: 't', services: [svc('s')], functions: [{ service: 's', id: 'main', name: 'main', steps: [redis(1, 'get'), redis(2, 'hget'), redis(3, 'get'), redis(4, 'set', 'o')] }],
  ingress: [{ service: 's', id: 'in', bindKey: 'http:GET s/x', transport: 'http', handler: 'main' }], egress: [], channels: [], bindings: [],
  resources: [{ service: 's', id: 'r', kind: 'redis', name: 'p81', bindKey: 'redis:p81-production' }, { service: 's', id: 'o', kind: 'redis', name: 'other', bindKey: 'redis:other' }] };
const t = trace(buildIndex(model), { service: 's', ingress: 'in' }, { scope: 'full', maxMessages: 500 })!;
const folded = viewOf(t, { dbOpen: [], group: true }).messages;
const group = folded.find((m) => m.dbGroup)!;
const runKey = group.key!;

test('dbRunOf: every member of a run finds the run, its key is the first member\'s and its index is the call\'s place', () => {
  const members = group.dbGroup!.members;
  assert.equal(members.length, 3);
  members.forEach((k, i) => { const r = dbRunOf(folded, k)!; assert.equal(r.key, runKey); assert.equal(r.index, i); assert.equal(r.calls.length, 3); });
  assert.equal(members[0], runKey);
});

test('dbRunOf: a message outside any run, or no key, is null', () => {
  const lone = folded.find((m) => !m.dbGroup && m.kind === 'resource')!; // the `set` on another store: one call is not a run
  assert.equal(dbRunOf(folded, lone.key), null);
  assert.equal(dbRunOf(folded, undefined), null);
  assert.equal(dbRunOf(folded, 'nope'), null);
});

test('the expanded view\'s messages are the run\'s members, so the pane finds its run from them', () => {
  const open = viewOf(t, { dbOpen: [runKey], group: true }).messages.filter((m) => m.kind === 'resource');
  assert.deepEqual(open.slice(0, 3).map((m) => m.label), ['get', 'hget', 'get']);
  assert.equal(dbRunOf(folded, open[1].key)!.index, 1);
});

test('runCardModel: lists the calls with their step numbers, marks the current one and words the way back', () => {
  const r = dbRunOf(folded, group.dbGroup!.members[1])!;
  const md = runCardModel(r, 4);
  assert.equal(md.title, 'Calls in this run');
  assert.deepEqual(md.rows.map((x) => [x.no, x.label, x.current]), [['3', 'get', false], ['4', 'hget', true], ['5', 'get', false]]);
  assert.equal(md.button, 'Group the 3 calls into one arrow again');
  assert.deepEqual(runCardModel(r, null).rows.map((x) => x.no), ['1', '2', '3'], 'not numbered: the call\'s place in the run');
});

test('runContext: the button folds the run by its first member\'s key (what dbOpen holds); n is the drawn step of the call', () => {
  const r = dbRunOf(folded, group.dbGroup!.members[2])!;
  let regrouped = '';
  const cur = {}, ctx = runContext(cur, r, { steps: () => [{ n: 7, event: { msg: {} } }, { n: 8, event: { msg: cur } }], regroup: (k: string) => { regrouped = k; } });
  ctx.group();
  assert.equal(regrouped, runKey);
  assert.equal(ctx.n, 8);
});
