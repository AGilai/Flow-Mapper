// 0.27.1 (bug #62): data-store collections as lifelines of a flow. Pure rules in web/js/views/flow-stores-pure.js, the lane in flow-lane.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { accessOf } from '../core/stores.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { MAX_COLLECTION_LIFELINES, splitStore, opLabel, isWrite, foldedStores, storeColumn, arrowLabel, stepLabel, bandsOf } from '../web/js/views/flow-stores-pure.js';
// @ts-ignore
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { stepsOf, stepCols } from '../web/js/views/flow-steps.js';

const res = (store: string, label = 'find-one', over: any = {}) => ({ from: 'fn:a:f', to: `res:${store}`, label, mode: 'sync', kind: 'resource', depth: 1, store, storeKind: store.split(':')[0], access: 'read', transport: 'res', ...over });
const entry = { from: 'client', to: 'svc:a', label: 'POST /x', mode: 'sync', kind: 'entry', depth: 0, transport: 'http', service: 'a', fn: 'f' };
const parts = (names: string[]) => [{ id: 'client', label: 'caller', kind: 'client' }, { id: 'svc:a', label: 'a', kind: 'service', service: 'a' }, ...names.map((n) => ({ id: `res:${n}`, label: n, kind: 'resource' }))];
const keys = (n: number) => Array.from({ length: n }, (_, i) => `mongodb:users-db/c${i + 1}`);
const laneOf = (msgs: any[], extra: any = {}) => buildLane(msgs, { scope: 'full', participants: parts([...new Set(msgs.filter((m) => m.store).map((m) => m.store))] as string[]), ...extra });

test('MAX_COLLECTION_LIFELINES is 5', () => assert.equal(MAX_COLLECTION_LIFELINES, 5));

test('splitStore: store, kind and collection of a resource key; redis templates keep their colon', () => {
  assert.deepEqual(splitStore({ store: 'postgres:users-db/users', storeKind: 'postgres' }), { group: 'postgres:users-db', store: 'users-db', kind: 'postgres', collection: 'users' });
  assert.equal(splitStore({ store: 'redis:cache-main/user:{id}' }).collection, 'user:{id}');
  assert.equal(splitStore({ store: 'redis:cache-main/user:{id}' }).kind, 'redis');
  assert.deepEqual(splitStore({ store: 'redis:auth-cache' }), { group: 'redis:auth-cache', store: 'auth-cache', kind: 'redis', collection: null });
});

test('operation label: the harvester\'s words, never rewritten; a step without one says its access mode', () => {
  assert.equal(opLabel({ label: 'find-one', access: 'read' }), 'find-one');
  assert.equal(opLabel({ label: 'SELECT * FROM users WHERE id = $1', access: 'read' }), 'SELECT * FROM users WHERE id = $1');
  assert.equal(opLabel({ label: 'use', access: 'write' }), 'write');
  assert.equal(opLabel({ label: 'use', access: 'read' }), 'read');
  assert.equal(opLabel({ label: 'use', access: 'unknown' }), 'access');
  assert.equal(isWrite({ access: 'write' }), true);
  assert.equal(isWrite({ access: 'read_write' }), false);
});

test('access reaches the trace message: the step\'s own, else from the operation', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full', maxMessages: 800 })!;
  const r = t.messages.filter((m: any) => m.kind === 'resource');
  assert.ok(r.length >= 4 && r.every((m: any) => m.access && m.storeKind));
  assert.equal(accessOf({ operation: 'find-one' } as any), 'read');
});

test('fold: more than 5 collections of one store in a flow; counted per store, 5 stay as they are', () => {
  const five = foldedStores(keys(5).map((k) => res(k))), six = foldedStores(keys(6).map((k) => res(k)));
  assert.equal(five.size, 0);
  assert.deepEqual([...six], [['mongodb:users-db', 6]]);
  const mixed = foldedStores([...keys(6).map((k) => res(k)), ...[1, 2, 3].map((i) => res(`mongodb:other/o${i}`))]);
  assert.deepEqual([...mixed.keys()], ['mongodb:users-db'], 'another store with 3 collections is not folded');
  assert.equal(foldedStores([...keys(5), ...keys(5)].map((k) => res(k))).size, 0, 'the same collection twice is one');
});

test('labels: the collection joins the operation only when the head does not name it', () => {
  const m = res('mongodb:users-db/audit_events', 'insert-one');
  assert.equal(arrowLabel(m, false), 'insert-one');
  assert.equal(arrowLabel(m, true), 'insert-one · audit_events');
  assert.equal(stepLabel(m), 'insert-one · audit_events');
  const col = storeColumn(m, new Map([['mongodb:users-db', 7]]));
  assert.deepEqual([col.label, col.stack, col.collections], ['users-db (7 collections)', true, 7]);
  const one = storeColumn(m, new Map());
  assert.deepEqual([one.label, one.sub, one.kind, one.transport], ['audit_events', 'users-db · mongodb', 'resource', 'res']);
});

test('lane: one lifeline per collection, in the order of the first step, after the last component', () => {
  const msgs = [entry, res('mongodb:users-db/users'), res('mongodb:users-db/devices'), res('redis:cache-main/k:{id}', 'GET'), res('mongodb:users-db/users', 'update-one', { access: 'write' }), res('mongodb:users-db/sessions', 'insert-one', { access: 'write' })];
  const lane = laneOf(msgs);
  assert.deepEqual(lane.columns.map((c: any) => c.label), ['client', 'a', 'users', 'devices', 'sessions', 'k:{id}'], 'a store\'s collections stay together, stores in first-touch order');
  const st = lane.events.filter((e: any) => e.type === 'store');
  assert.deepEqual(st.map((e: any) => [e.label, e.write]), [['find-one', false], ['find-one', false], ['GET', false], ['update-one', true], ['insert-one', true]]);
  assert.equal(st[0].col, st[3].col, 'the same collection is the same lifeline');
  assert.deepEqual(bandsOf(lane.columns).map((b: any) => [b.from, b.to, b.label]), [[2, 4, 'mongodb: users-db'], [5, 5, 'redis: cache-main']]);
  assert.deepEqual(bandsOf(lane.columns, new Set([3])).map((b: any) => [b.from, b.to]), [[2, 2], [4, 4], [5, 5]], 'a squeezed lifeline breaks its band');
});

test('lane: more than 5 collections fold into one lifeline, each arrow names its collection', () => {
  const lane = laneOf([entry, ...keys(7).map((k) => res(k, 'find-one'))]);
  const cols = lane.columns.filter((c: any) => c.kind === 'resource');
  assert.equal(cols.length, 1);
  assert.equal(cols[0].label, 'users-db (7 collections)');
  assert.deepEqual(lane.events.filter((e: any) => e.type === 'store').map((e: any) => e.label).slice(0, 2), ['find-one · c1', 'find-one · c2']);
  assert.equal(bandsOf(lane.columns).length, 1);
  assert.equal(laneOf([entry, ...keys(5).map((k) => res(k))]).columns.filter((c: any) => c.kind === 'resource').length, 5, 'exactly 5 do not fold');
});

test('lane: "Data stores" off hides every store lifeline, folded or not', () => {
  const msgs = [entry, ...keys(7).map((k) => res(k))];
  const off = laneOf(msgs, { stores: false });
  assert.equal(off.columns.filter((c: any) => c.kind === 'resource').length, 0);
  assert.equal(off.events.filter((e: any) => e.type === 'store').length, 0);
});

test('steps: the walk label is the full operation and collection; the ends are the component and the store', () => {
  const lane = laneOf([entry, ...keys(7).map((k) => res(k, 'find-one'))]);
  const steps = stepsOf(lane, (ms: any[]) => ms.map((_, i) => `k${i}`));
  const s = steps.find((x: any) => x.event.type === 'store');
  assert.deepEqual([s.label, s.from, s.to], ['find-one · c1', 'a', 'users-db']);
  const [a, b] = stepCols(s.event);
  assert.ok(a && b && b.kind === 'resource', 'both ends are lifelines now');
});

test('the sample flows draw: login has 3 collections, the audit export folds 7', async () => {
  const g = buildIndex(sampleModel());
  const run = (ing: string) => trace(g, { service: 'identity-svc', ingress: ing }, { scope: 'full', maxMessages: 800 })!;
  const a = buildLane(run('in.login').messages, { scope: 'full', participants: run('in.login').participants });
  assert.deepEqual(a.columns.filter((c: any) => c.kind === 'resource').map((c: any) => c.label), ['users', 'devices', 'sessions']);
  const b = buildLane(run('in.auditExport').messages, { scope: 'full', participants: run('in.auditExport').participants });
  assert.deepEqual(b.columns.filter((c: any) => c.kind === 'resource').map((c: any) => c.label), ['identity-db (7 collections)']);
});
