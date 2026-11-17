// 0.43.2 (#88): consecutive store calls merge into one node `*N op, op`. A per-step guard and a message that carries `alternatives` do not split a run;
// a different arm of the same decision, an external call or any other visible message does. The row lists its calls in `dbGroup.calls`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { viewOf } from '../core/trace-view.ts';

const G = (id: string, arms: Record<string, string[]>) => ({ group_id: id, name: `name ${id}`, arms: Object.entries(arms).map(([arm, step_ids]) => ({ arm, step_ids })) });
const svc = (name: string) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' });
const redis = (seq: number, op: string, extra: Record<string, any> = {}, target = 'r') => ({ seq, type: 'resource', target, operation: op, ...extra });
const egress = (seq: number) => ({ seq, type: 'egress', target: 'e' });
const call = (seq: number, target: string) => ({ seq, type: 'call', target });
const leaf = (seq: number) => ({ seq, type: 'call', kind: 'leaf', operation: `op${seq}` });
const RES = [{ service: 's', id: 'r', kind: 'redis', name: 'p81', bindKey: 'redis:p81-production' }, { service: 's', id: 'o', kind: 'redis', name: 'other', bindKey: 'redis:other' }];

function flow(fns: Record<string, any[]>) {
  const model: any = { env: 't', services: [svc('s'), svc('t')],
    functions: [...Object.entries(fns).map(([id, steps]) => ({ service: 's', id, name: id, steps })), { service: 't', id: 'h', name: 'h', steps: [leaf(1)] }],
    ingress: [{ service: 's', id: 'in', bindKey: 'http:GET s/x', transport: 'http', handler: 'main' }, { service: 't', id: 'in.t', bindKey: 'http:GET t/x', transport: 'http', handler: 'h' }],
    egress: [{ service: 's', id: 'e', bindKey: 'http:GET t/x', transport: 'http', mode: 'sync' }], resources: RES, channels: [], bindings: [] };
  return trace(buildIndex(model), { service: 's', ingress: 'in' }, { scope: 'full', maxMessages: 500 })!;
}
const rows = (t: any, o: object = {}) => viewOf(t, o).messages.map((m) => m.label);

test('#88 safer-auth shape: get, hget (with a guard) and get of one Redis, the first carrying alternatives, are one "*3 get, hget" node', () => {
  const g = G('g', { then: ['s:main#2', 's:main#3', 's:main#4'], else: ['s:main#5'] });
  const t = flow({ main: [egress(1), redis(2, 'get', { alternatives: [g], details: { keyTemplate: 'session:{id}', dbIndex: 2, ttlSeconds: 60 } }),
    redis(3, 'hget', { details: { only_when: { guard: 'sessionId is set' }, keyTemplate: '{unresolved:computed}' } }), redis(4, 'get'), leaf(5)] });
  const v = viewOf(t);
  const row = v.messages.find((m) => m.dbGroup)!;
  assert.deepEqual(v.messages.map((m) => m.label), ['http:GET s/x', 'http:GET t/x', '*3 get, hget']);
  assert.equal(row.dbGroup!.count, 3);
  assert.deepEqual(row.dbGroup!.calls!.map((c) => [c.label, c.seq, c.keyTemplate ?? null, c.dbIndex ?? null, c.ttlSeconds ?? null, c.onlyWhen?.guard ?? null]),
    [['get', 2, 'session:{id}', 2, 60, null], ['hget', 3, null, null, null, 'sessionId is set'], ['get', 4, null, null, null, null]]);
  assert.deepEqual(row.dbGroup!.calls![1].keyUnresolved, ['computed']);
  assert.equal(row.dbGroup!.calls![0].stepId, 's:main#2');
  assert.equal(row.onlyWhen!.guard, 'sessionId is set');
  assert.deepEqual(row.dbGroup!.calls!.map((c) => c.key), row.dbGroup!.members);
});

test('#88 tryGetCacheData shape: setex, setex, del at one depth under alternatives are one "*3 setex, del"', () => {
  const g = G('g', { then: ['s:cache#1', 's:cache#2', 's:cache#3'], else: ['s:cache#4'] });
  const t = flow({ main: [call(1, 'cache')], cache: [redis(1, 'setex', { alternatives: [g] }), redis(2, 'setex'), redis(3, 'del'), leaf(4)] });
  assert.deepEqual(rows(t), ['http:GET s/x', '*3 setex, del']);
  assert.deepEqual(rows(t, { detail: 'full', group: true }), ['http:GET s/x', 'cache', '*3 setex, del'], 'the full view keeps the call; the run under it is one node too');
  assert.equal(viewOf(t).messages[1].dbGroup!.access, 'write');
});

test('#88 two calls in different arms of one decision stay apart', () => {
  const g = G('g', { x: ['s:main#1', 's:main#2'], y: ['s:main#3', 's:main#4'] });
  const t = flow({ main: [redis(1, 'get', { alternatives: [g] }), redis(2, 'hget'), redis(3, 'set', { alternatives: [g] }), redis(4, 'del')] });
  assert.deepEqual(rows(t, { choose: { g: 'both' } }), ['http:GET s/x', '*2 get, hget', '*2 set, del'], 'each arm merges inside itself, never across the boundary');
  assert.deepEqual(rows(t), ['http:GET s/x', '*2 get, hget'], 'one arm drawn: its own run only');
  assert.deepEqual(rows(t, { choose: { g: 'y' } }), ['http:GET s/x', '*2 set, del']);
});

test('#88 an external call, another store, or an opened run between calls splits; one call is not a group', () => {
  const t = flow({ main: [redis(1, 'get'), redis(2, 'get'), egress(3), redis(4, 'get'), redis(5, 'get', {}, 'o'), redis(6, 'get', {}, 'o'), redis(7, 'get')] });
  assert.deepEqual(rows(t), ['http:GET s/x', '*2 get', 'http:GET t/x', 'get', '*2 get', 'get']);
  const key = viewOf(t).messages.find((m) => m.dbGroup)!.key!;
  assert.deepEqual(rows(t, { dbOpen: [key] }), ['http:GET s/x', 'get', 'get', 'http:GET t/x', 'get', '*2 get', 'get'], 'the run at that key stays expanded');
});
