// Reference decoration of a trace and the count of references a flow reaches (core/flow-refs.ts), on a small hand-made design.
// Sealed-environment behaviour (traces untouched) is covered in trace-refs.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { rowsToModel, type ItemRow } from '../core/item-rows.ts';
import { originsOf, referencesOf } from '../core/references.ts';
import { decorateDesignTrace, refsReached } from '../core/flow-refs.ts';
import { entryPoints, trace } from '../core/trace.ts';

const hdr = (service: string, kind = 'service'): ItemRow => ({ service, list: 'header', key: '', data: { kind } });
const ing = (service: string, id: string, bindKey: string, handler: string, extra: object = {}): ItemRow => ({ service, list: 'ingress', key: id, data: { id, bindKey, transport: 'http', handler, ...extra } });
const egr = (service: string, id: string, bindKey: string): ItemRow => ({ service, list: 'egress', key: id, data: { id, bindKey, transport: 'http', mode: 'sync' } });
const fn = (service: string, id: string, targets: string[]): ItemRow => ({ service, list: 'functions', key: id, data: { id, name: id, steps: targets.map((target, i) => ({ seq: i + 1, type: 'egress', target })) } });

// agent -> b (a reference), agent -> c (designed) -> b again, agent -> d (a reference)
const rows: ItemRow[] = [
  hdr('agent', 'client-app'), fn('agent', 'fa', ['out.b', 'out.c', 'out.d']), ing('agent', 'in.a', 'client:agent/open', 'fa', { entryPoint: true, transport: 'other' }),
  egr('agent', 'out.b', 'http:GET b/x'), egr('agent', 'out.c', 'http:GET c/y'), egr('agent', 'out.d', 'http:GET d/z'),
  hdr('b'), ing('b', 'in.b', 'http:GET b/x', 'hb'),
  hdr('c'), fn('c', 'hc', ['out.b2']), ing('c', 'in.c', 'http:GET c/y', 'hc'), egr('c', 'out.b2', 'http:GET b/x'),
  hdr('d'), ing('d', 'in.d', 'http:GET d/z', 'hd'),
];
const g = buildIndex(rowsToModel('design', rows));
const copied = rows.filter((r) => r.list === 'ingress' && ['b', 'd'].includes(r.service)).map((r) => ({ service: r.service, list: r.list, key: r.key, sourceEnv: 'prod', takenAt: 'T0' }));
const refs = referencesOf(rows, originsOf(copied), 'T0');

test('messages into a reference carry it; partial.steps lists the first message per reference, with valid indexes', () => {
  const t = trace(g, { service: 'agent', ingress: 'in.a' })!;
  const d = decorateDesignTrace(t, refs, (s) => g.services.get(s)?.kind);
  const into = (m: any) => m.reference?.anchor;
  assert.deepEqual(d.messages.map(into).filter(Boolean), ['ing:b/in.b', 'ing:b/in.b', 'ing:d/in.d'], 'b is reached twice (from agent and from c)');
  assert.deepEqual(d.messages.find((m) => into(m))!.reference, { anchor: 'ing:b/in.b', source: 'prod' });
  assert.deepEqual(d.partial!.steps.map((s) => [s.anchor, s.service, s.ingress, s.label, s.source]),
    [['ing:b/in.b', 'b', 'in.b', 'http:GET b/x', 'prod'], ['ing:d/in.d', 'd', 'in.d', 'http:GET d/z', 'prod']]);
  for (const s of d.partial!.steps) assert.equal(into(d.messages[s.message]), s.anchor, 'message is the 0-based index into messages');
  assert.equal(d.partial!.steps[0].message, d.messages.findIndex(into), 'the first one per anchor');
  assert.equal(d.messages.filter((m) => !m.target || !into(m)).every((m) => !('reference' in m)), true);
});

test('service participants gain serviceKind; the trace itself is not changed (core/trace.ts output is the input)', () => {
  const t = trace(g, { service: 'agent', ingress: 'in.a' })!;
  const before = JSON.stringify(t);
  const d = decorateDesignTrace(t, refs, (s) => g.services.get(s)?.kind);
  assert.equal(JSON.stringify(t), before);
  assert.equal(d.participants.find((p) => p.service === 'agent')!.serviceKind, 'client-app');
  assert.equal(d.participants.find((p) => p.service === 'c')!.serviceKind, 'service');
  assert.equal(d.participants.find((p) => p.kind === 'client')!.serviceKind, undefined);
});

test('a flow with no step into a reference has no partial, and a design with no reference decorates nothing', () => {
  const t = trace(g, { service: 'c', ingress: 'in.c' })!;
  const only = decorateDesignTrace(t, { endpoints: {}, components: {}, origins: {} }, () => undefined);
  assert.equal('partial' in only, false);
  assert.deepEqual(only.messages, t.messages);
});

test('refsReached counts the distinct reference endpoints a flow reaches, like tracing every entry', () => {
  const reached = refsReached(g, refs);
  const brute = new Map<string, number>();
  for (const e of entryPoints(g)) {
    const t = decorateDesignTrace(trace(g, { service: e.service, ingress: e.id })!, refs, () => undefined);
    if (t.partial) brute.set(`${e.service}:${e.id}`, t.partial.steps.length);
  }
  assert.deepEqual([...reached].sort(), [...brute].sort());
  assert.equal(reached.get('agent:in.a'), 2);
  assert.equal(refsReached(g, refs), reached, 'memoised per graph and refs');
  assert.equal(refsReached(g, { endpoints: {}, components: {}, origins: {} }).size, 0);
});
