// #109: Simple with `merge` (one arrow per target within one activation of the caller): alternating stores merge per store, activations stay apart,
// a call into a service that opens its own activation keeps its place, blocked members become a "! N" badge, the option off is the 0.44 rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { viewOf } from '../core/trace-view.ts';
import { viewParams } from '../core/trace-view-params.ts';
import { shortOp } from '../core/trace-simple.ts';

const call = (seq: number, target: string, extra: object = {}) => ({ seq, type: 'call', target, ...extra });
const leaf = (seq: number) => ({ seq, type: 'call', kind: 'leaf', operation: `op${seq}` });
const res = (seq: number, target: string, operation: string, extra: object = {}) => ({ seq, type: 'resource', target, operation, ...extra });
const out = (seq: number, target: string) => ({ seq, type: 'egress', target });
const blocked = { unresolved: [{ what: 'detail', reason: 'computed key', detail: 'details.keyTemplate', gap: true }] };
const svc = (name: string) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' });

/** s: main (stores interleaved, one through an internal function), egress x1, x2 to leaf service x; egress to u (nested: u calls back into s, whose handler h3 uses the stores). */
function view(opts: object) {
  const main = [res(1, 'cache', 'setex', blocked), call(2, 'inner'), res(3, 'db', 'findOne'), res(4, 'cache', 'get', { details: { only_when: { guard: 'raw' } } }), out(5, 'x1'), res(6, 'db', 'find'), out(7, 'x2'), out(8, 'x1'), out(9, 'u1'), res(10, 'cache', 'del')];
  const model: any = { env: 't', services: [svc('s'), svc('x'), svc('u')],
    functions: [
      { service: 's', id: 'main', name: 'main', steps: main },
      { service: 's', id: 'inner', name: 'inner', steps: [leaf(1), res(2, 'cache', 'set', blocked), res(3, 'db', 'findById')] },
      { service: 's', id: 'h3', name: 'h3', steps: [res(1, 'cache', 'get'), res(2, 'db', 'find')] },
      { service: 'x', id: 'hx1', name: 'hx1', steps: [] }, { service: 'x', id: 'hx2', name: 'hx2', steps: [] },
      { service: 'u', id: 'hu', name: 'hu', steps: [out(1, 'back')] }],
    ingress: [{ service: 's', id: 'in', bindKey: 'http:GET s/a', transport: 'http', handler: 'main' }, { service: 's', id: 'in3', bindKey: 'http:GET s/back', transport: 'http', handler: 'h3' },
      { service: 'x', id: 'i1', bindKey: 'http:GET x/one', transport: 'http', handler: 'hx1' }, { service: 'x', id: 'i2', bindKey: 'http:POST x/two', transport: 'http', handler: 'hx2' }, { service: 'u', id: 'iu', bindKey: 'http:GET u/a', transport: 'http', handler: 'hu' }],
    egress: [{ service: 's', id: 'x1', bindKey: 'http:GET x/one', transport: 'http', mode: 'sync' }, { service: 's', id: 'x2', bindKey: 'http:POST x/two', transport: 'http', mode: 'sync' },
      { service: 's', id: 'u1', bindKey: 'http:GET u/a', transport: 'http', mode: 'sync' }, { service: 'u', id: 'back', bindKey: 'http:GET s/back', transport: 'http', mode: 'sync' }],
    resources: [{ service: 's', id: 'cache', kind: 'redis', name: 'c', bindKey: 'redis:c' }, { service: 's', id: 'db', kind: 'mongodb', name: 'd', bindKey: 'mongodb:d/users' }], channels: [], bindings: [] };
  return viewOf(trace(buildIndex(model), { service: 's', ingress: 'in' }, { scope: 'full' })!, { detail: 'simple', ...opts });
}
const labels = (t: any) => t.messages.map((m: any) => m.label);

test('merge: alternating stores are one arrow per store at the first one place, whatever lies between', () => {
  const t = view({ merge: true });
  const first = t.messages.filter((m: any) => m.kind === 'resource' && m.to.startsWith('res:redis') && m.dbGroup);
  assert.equal(first.length, 1, labels(t).join(' | '));
  assert.deepEqual(first[0].dbGroup.calls.map((c: any) => c.label), ['setex', 'set', 'get', 'del']);
  assert.equal(first[0].onlyWhen, undefined); // only one of the four members is guarded: the arrow is not conditional, the member keeps its guard in `calls`
  assert.equal(first[0].dbGroup.calls[2].onlyWhen?.guard, 'raw');
  const db = t.messages.filter((m: any) => m.kind === 'resource' && m.to.startsWith('res:mongodb') && m.dbGroup);
  assert.equal(db.length, 1);
  assert.deepEqual(db[0].dbGroup.calls.map((c: any) => c.label), ['findById', 'findOne', 'find']);
});

test('merge: blocked members become a count; the arrow itself is not a blocked step', () => {
  const row = view({ merge: true }).messages.find((m: any) => m.dbGroup?.members.length === 4)!;
  assert.equal(row.dbGroup!.flagged, 2);
  assert.equal(row.blocked, undefined);
  assert.equal(row.dbGroup!.calls!.filter((c: any) => c.blocked).length, 2);
  assert.equal(view({ merge: true }).blockedAll?.n, 2, 'the header badge and "Why incomplete" still know the blocked steps');
});

test('merge: calls into a leaf target are one arrow (distinct operations in first-use order); a service that opens its own activation keeps its place', () => {
  const t = view({ merge: true });
  assert.ok(labels(t).includes('*3 GET /one, POST /two') || labels(t).includes('*3 GET x/one, POST x/two') || labels(t).some((l: string) => /^\*3 .*one.*two/.test(l)), labels(t).join(' | '));
  assert.equal(t.messages.filter((m: any) => m.to === 'svc:x').length, 1);
  assert.equal(t.messages.filter((m: any) => m.to === 'svc:u').length, 1);
});

test('merge: a second activation of the same caller does not merge into the first', () => {
  const t = view({ merge: true });
  const redis = t.messages.filter((m: any) => m.to.startsWith('res:redis'));
  assert.equal(redis.length, 2, labels(t).join(' | '));
  assert.ok(redis[1].depth !== redis[0].depth || redis[1].n > redis[0].n);
});

test('merge off (the default): the 0.44 rule, blocked steps stay apart, leaves are not folded across different calls', () => {
  const t = view({});
  assert.ok(!labels(t).some((x: string) => /one.*two/.test(x)));
  assert.equal(t.messages.filter((m: any) => m.blocked).length, 2);
  assert.ok(t.messages.every((m: any) => m.dbGroup?.flagged === undefined));
});

test('merge: the view has fewer steps, numbered 1..N without gaps', () => {
  const a = view({}), b = view({ merge: true });
  assert.ok(b.messages.length < a.messages.length);
  const ns = b.messages.map((m: any) => m.n).filter((n: any) => n != null);
  assert.deepEqual(ns, ns.map((_: number, i: number) => i + 1));
});

test('merge is an explicit view option: viewParams reads merge=1, absent leaves it unset', () => {
  assert.equal(viewParams({ detail: 'simple', merge: '1' }).merge, true);
  assert.equal(viewParams({ detail: 'simple' }).merge, undefined);
  assert.equal(shortOp('http:POST ext/ap/v1/token'), 'POST /ap/v1/token');
});
