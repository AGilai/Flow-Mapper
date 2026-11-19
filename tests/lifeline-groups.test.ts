// #138: lifelines ordered by subsystem (hierarchical by groupPath, env order), not by first appearance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { groupedOrder } from '../core/lifeline-groups.ts';
import { orderParam } from '../core/trace-view-params.ts';
import { exportMermaid } from '../core/mermaid-export.ts';
import type { Message, Participant } from '../core/trace.ts';

const PATH: Record<string, string> = { a1: 'platform/identity', a2: 'platform/objects', a3: 'platform/identity', a0: 'platform', b1: 'agent/net', b2: 'agent/core', b3: 'agent/net', c1: 'agent' };
const order = ['platform', 'platform/identity', 'platform/objects', 'agent', 'agent/core', 'agent/net'];
const svc = (s: string, extra: Partial<Participant> = {}): Participant => ({ id: `svc:${s}`, label: s, kind: 'service', service: s, ...extra });
const gr = { groupOf: (s: string) => PATH[s] ?? '', order };
const ids = (ps: Participant[] | null) => ps!.map((p) => p.id.replace(/^svc:/, ''));
const msg = (from: string, to: string, extra: Partial<Message> = {}): Message => ({ from, to, label: 'x', mode: 'sync', kind: 'call', depth: 1, ...extra } as Message);

test('call order interleaves two parents with two children each: output is contiguous per parent, then per child, in env order', () => {
  const parts = [{ id: 'client', label: 'client', kind: 'client' } as Participant, ...['b1', 'a1', 'b2', 'a2', 'a3', 'b3', 'a0', 'c1'].map((s) => svc(s))];
  assert.deepEqual(ids(groupedOrder(parts, [], gr)), ['client', 'a0', 'a1', 'a3', 'a2', 'c1', 'b2', 'b1', 'b3']);
});

test('the caller stays first and its subsystem ranks first; no groupPath and external come last', () => {
  const parts = [svc('b1'), svc('a1'), svc('loose'), svc('ext', { external: true }), svc('a2'), svc('b3')];
  assert.deepEqual(ids(groupedOrder(parts, [], gr)), ['b1', 'b3', 'a1', 'a2', 'loose', 'ext']);
});

test('an owned store sits right after its owner; an unowned store after the grouped components; channels keep their sender / owner rules', () => {
  const parts = [svc('a1'), svc('b1'), svc('a2'),
    { id: 'res:keystore:a2/k', label: 'k', kind: 'resource' } as Participant, { id: 'res:shared', label: 's', kind: 'resource' } as Participant,
    { id: 'ch:sns:t', label: 't', kind: 'channel' } as Participant, { id: 'ch:sqs:q', label: 'q', kind: 'channel', owner: 'b1' } as Participant, svc('loose')];
  const messages = [msg('svc:a1', 'svc:b1'), msg('svc:a2', 'res:keystore:a2/k', { kind: 'resource', owner: 'a2' }), msg('svc:a2', 'res:shared', { kind: 'resource' }),
    msg('svc:a1', 'ch:sns:t'), msg('ch:sns:t', 'ch:sqs:q')];
  assert.deepEqual(ids(groupedOrder(parts, messages, gr)), ['a1', 'ch:sns:t', 'a2', 'res:keystore:a2/k', 'b1', 'ch:sqs:q', 'res:shared', 'loose']);
});

test('no groupPath anywhere: groupedOrder declines (the legacy order and the golden hashes stay)', () => {
  assert.equal(groupedOrder([svc('x'), svc('y')], [], gr), null);
});

function model(withGroups: boolean) {
  const names = ['entry', 'b1', 'a1', 'b2', 'a2'];
  const path = (n: string) => (withGroups && PATH[n] ? { groupPath: PATH[n] } : {});
  return {
    env: 't', services: names.map((name) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01', ...path(name) })),
    functions: [{ service: 'entry', id: 'h', name: 'h', steps: names.slice(1).map((n, i) => ({ seq: i + 1, type: 'egress', target: `e-${n}` })) }, ...names.slice(1).map((n) => ({ service: n, id: 'h', name: 'h', steps: [] }))],
    ingress: [{ service: 'entry', id: 'in', bindKey: 'http:GET entry/x', transport: 'http', handler: 'h', entryPoint: true }, ...names.slice(1).map((n) => ({ service: n, id: 'in', bindKey: `http:GET ${n}/x`, transport: 'http', handler: 'h' }))],
    egress: names.slice(1).map((n) => ({ service: 'entry', id: `e-${n}`, bindKey: `http:GET ${n}/x`, transport: 'http' })), resources: [], channels: [], bindings: [],
  } as any;
}
const run = (withGroups: boolean) => { const g = buildIndex(model(withGroups)); if (withGroups) g.groupOrder = order; return trace(g, { service: 'entry', ingress: 'in' }, { scope: 'full' })!; };

test('trace: scattered call order comes out grouped; without groups it is unchanged (first appearance)', () => {
  assert.deepEqual(run(false).participants.map((p) => p.id), ['client', 'svc:entry', 'svc:b1', 'svc:a1', 'svc:b2', 'svc:a2']);
  assert.deepEqual(run(true).participants.map((p) => p.id), ['client', 'svc:a1', 'svc:a2', 'svc:b2', 'svc:b1', 'svc:entry']);
});

test('mermaid export lists participants in the grouped order', () => {
  const decl = exportMermaid(run(true)).split('\n').filter((l) => /^(participant|actor) /.test(l)).map((l) => l.split(' ')[1]);
  assert.deepEqual(decl, ['client', 'a1', 'a2', 'b2', 'b1', 'entry']);
});

test('order=calls restores first appearance even where components have groups; subsystem is the default; bad values are refused', () => {
  const g = buildIndex(model(true)); g.groupOrder = order;
  const calls = trace(g, { service: 'entry', ingress: 'in' }, { scope: 'full', order: 'calls' })!;
  assert.deepEqual(calls.participants.map((p) => p.id), ['client', 'svc:entry', 'svc:b1', 'svc:a1', 'svc:b2', 'svc:a2']);
  assert.deepEqual(trace(g, { service: 'entry', ingress: 'in' }, { scope: 'full', order: 'subsystem' })!.participants.map((p) => p.id), run(true).participants.map((p) => p.id));
  const mm = exportMermaid(calls).split('\n').filter((l) => /^participant /.test(l)).map((l) => l.split(' ')[1]);
  assert.deepEqual(mm, ['entry', 'b1', 'a1', 'b2', 'a2']);
  assert.equal(orderParam('calls'), 'calls'); assert.equal(orderParam(undefined), undefined); assert.equal(orderParam('subsystem'), undefined);
  assert.throws(() => orderParam('x'));
});
