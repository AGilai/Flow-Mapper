// 0.44.0 (#90): the Simple view (core/trace-simple.ts): kept, flattened, counted, non-adjacent merge, repeats, hidden steps, budget, numbering, counts; `unfold`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { viewOf, viewCounts } from '../core/trace-view.ts';
import { stepKeys } from '../core/description.ts';
import { viewParams } from '../core/trace-view-params.ts';

const G = (id: string, arms: Record<string, string[]>) => ({ group_id: id, name: id, arms: Object.entries(arms).map(([arm, step_ids]) => ({ arm, label: arm, step_ids })) });
const call = (seq: number, target: string, extra: object = {}) => ({ seq, type: 'call', target, ...extra });
const leaf = (seq: number) => ({ seq, type: 'call', kind: 'leaf', operation: `op${seq}` });
const res = (seq: number, target: string, operation: string, key?: string) => ({ seq, type: 'resource', target, operation, ...(key ? { details: { keyTemplate: key } } : {}) });
const out = (seq: number, target = 'e', extra: object = {}) => ({ seq, type: 'egress', target, ...extra });
const svc = (name: string) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' });
const RES = [['db', 'mongodb:d/users'], ['cache', 'redis:c'], ['db2', 'mongodb:d/orders']].map(([id, bindKey]) => ({ service: 's', id, kind: bindKey.split(':')[0], name: id, bindKey }));
/** service s (handler main + fns), t (h: one leaf) and u (h2: calls t) behind egresses e (s>t), f (s>u), tu (u>t). */
function run(fns: Record<string, any[]>, opts: object = {}, tHits = false) {
  const model: any = { env: 't', services: [svc('s'), svc('t'), svc('u')],
    functions: [...Object.entries(fns).map(([id, steps]) => ({ service: 's', id, name: id, steps })), { service: 't', id: 'h', name: 'h', steps: tHits ? [leaf(1), { seq: 2, type: 'resource', target: 'tdb', operation: 'insert' }] : [leaf(1)] }, { service: 'u', id: 'h2', name: 'h2', steps: [leaf(1), out(2, 'tu')] }],
    ingress: [{ service: 's', id: 'in', bindKey: 'http:GET s/x', transport: 'http', handler: 'main' }, { service: 't', id: 'in.t', bindKey: 'http:GET t/x', transport: 'http', handler: 'h' }, { service: 'u', id: 'in.u', bindKey: 'http:GET u/x', transport: 'http', handler: 'h2' }],
    egress: [{ service: 's', id: 'e', bindKey: 'http:GET t/x', transport: 'http', mode: 'sync' }, { service: 's', id: 'f', bindKey: 'http:GET u/x', transport: 'http', mode: 'sync' }, { service: 'u', id: 'tu', bindKey: 'http:GET t/x', transport: 'http', mode: 'sync' }],
    resources: [...RES, { service: 't', id: 'tdb', kind: 'mongodb', name: 'tdb', bindKey: 'mongodb:td/things' }], channels: [], bindings: [] };
  return trace(buildIndex(model), { service: 's', ingress: 'in' }, { scope: 'full', ...opts })!;
}
const simple = (fns: Record<string, any[]>, o: object = {}) => viewOf(run(fns), { detail: 'simple', ...o });
const labels = (t: any) => t.messages.map((m: any) => m.label);

test('kept: no internal calls, leaves or frontier; the view says it is simple and carries no decisions', () => {
  const v = simple({ main: [call(1, 'a'), res(2, 'db', 'find')], a: [leaf(1), res(1, 'db2', 'get'), call(2, 'b')], b: [leaf(1)] });
  assert.deepEqual(labels(v), ['http:GET s/x', 'get', 'find']);
  assert.equal(v.detail, 'simple');
  assert.equal(v.decisions, undefined);
  assert.equal(v.choose, undefined);
});

test('problems stay: an unresolved call is drawn although it is an internal step', () => {
  const v = simple({ main: [{ seq: 1, type: 'call', unresolved: [{ what: 'target', reason: 'dynamic_call' }] }, res(2, 'db', 'find')] });
  assert.equal(v.messages.length, 3);
  assert.ok(v.messages.some((m) => m.gap));
});

test('arms flattened: every arm is in, no alt frames, `flattened` counts the decisions', () => {
  const g = G('g', { x: ['s:main#1'], y: ['s:main#2'] });
  const v = simple({ main: [res(1, 'db', 'find', undefined), res(2, 'db2', 'get')].map((s, k) => ({ ...s, alternatives: [g] })) });
  assert.deepEqual(labels(v), ['http:GET s/x', 'find', 'get']);
  assert.equal(v.flattened, 1);
  assert.ok(v.messages.every((m) => !m.arms && !m.alt));
});

test('consolidation: the same store call from three functions is one `*3` arrow with its occurrences, the first place wins', () => {
  const v = simple({ main: [call(1, 'a'), call(2, 'b'), call(3, 'c')], a: [res(1, 'db', 'find')], b: [res(1, 'db', 'find')], c: [res(1, 'db', 'find')] });
  assert.deepEqual(labels(v), ['http:GET s/x', '*3 find']);
  assert.deepEqual(v.messages[1].occurrences!.map((o) => o.fn), ['a', 'b', 'c']);
  assert.ok(v.messages[1].occurrences!.every((o) => o.key && o.service === 's' && o.seq === 1));
});

test('the key includes the key template: other keys are other arrows (until the same-store merge)', () => {
  const v = simple({ main: [res(1, 'cache', 'get', 'a:{id}'), res(2, 'db', 'find'), res(3, 'cache', 'get', 'b:{id}')] });
  assert.deepEqual(labels(v), ['http:GET s/x', '*2 get', 'find']);
  assert.equal(v.messages[1].dbGroup!.calls!.length, 2);
});

test('non-adjacent same store, other ops: one `*N get, set` row at the first place (the #88 shape)', () => {
  const v = simple({ main: [call(1, 'a'), res(2, 'db', 'find'), call(3, 'b'), call(4, 'c')], a: [res(1, 'cache', 'get', 'k')], b: [res(1, 'cache', 'set', 'k')], c: [res(1, 'cache', 'get', 'k'), res(2, 'cache', 'set', 'k')] });
  assert.deepEqual(labels(v), ['http:GET s/x', '*2 get, set', 'find']);
  const row = v.messages[1];
  assert.deepEqual(row.dbGroup!.calls!.map((c) => c.label), ['get', 'set']);
  assert.equal(row.dbGroup!.members.length, 2);
  assert.equal(row.occurrences!.length, 2);
});

test('cross-service: the same call from one caller is a count; a second caller reaching the same ingress is a repeat marker, nothing below it', () => {
  const v = simple({ main: [out(1), out(2), out(3, 'f')] });
  assert.deepEqual(labels(v), ['http:GET s/x', '*2 http:GET t/x', 'http:GET u/x', 'http:GET t/x ↩ seen at step 2']);
  const rep = v.messages[3];
  assert.equal(rep.repeatOf, 2);
  assert.equal(rep.from, 'svc:u');
  assert.equal(v.messages.length, 4);
  assert.deepEqual(v.participants.map((p) => [p.id, p.hiddenSteps]).filter(([, h]) => h !== undefined), [['svc:s', 0], ['svc:t', 0], ['svc:u', 0]]);
});

test('a repeat in another arm is a marker too, its subtree dropped (canonical expands it again)', () => {
  const g = G('g', { x: ['s:main#1'], y: ['s:main#2'] });
  const v = simple({ main: [out(1, 'e', { alternatives: [g] }), out(2, 'f', { alternatives: [g] })], });
  assert.equal(v.messages.length, 4);
  const t = run({ main: [out(1, 'e', { alternatives: [g] }), out(2, 'f', { alternatives: [g] })] });
  assert.ok(t.messages.length >= 5, 'the canonical trace holds both arms');
});

test('hiddenSteps: internal calls and frontier steps per service; duplicates folded into a count are not in it', () => {
  const v = simple({ main: [call(1, 'a'), call(2, 'b'), out(3)], a: [res(1, 'db', 'find'), call(2, 'b')], b: [res(1, 'db', 'find')] });
  assert.equal(v.participants.find((p) => p.id === 'svc:s')!.hiddenSteps, 3, 'a, b (expanded), b (repeat)');
  assert.deepEqual(labels(v).slice(1), ['*2 find', 'http:GET t/x']);
  assert.equal(v.participants.find((p) => p.id === 'svc:s')!.internalCalls, 0);
});

test('budget: cut at maxMessages items, truncated only then; numbering follows the drawn rows', () => {
  const fns = { main: [res(1, 'db', 'find'), res(2, 'db2', 'get'), out(3), out(4, 'f')] };
  const all = viewOf(run(fns), { detail: 'simple' });
  assert.equal(all.messages.length, 6);
  assert.equal(all.truncated, false);
  const cut = viewOf(run(fns), { detail: 'simple', maxMessages: 4 });
  assert.equal(cut.messages.length, 4);
  assert.equal(cut.truncated, true);
  assert.equal(viewOf(run(fns), { detail: 'simple', maxMessages: 6 }).truncated, false);
  assert.equal(all.messages[5].repeatOf, 4, 'the marker points at the drawn number of the first call (step 4: client > s, find, get, e)');
  assert.equal(all.messages[5].label, 'http:GET t/x ↩ seen at step 5'.replace('5', String(all.messages[5].repeatOf)));
});

test('viewCounts of simple is the drawn count; no decisions are offered', () => {
  const t = run({ main: [call(1, 'a'), call(2, 'b')], a: [res(1, 'db', 'find')], b: [res(1, 'db', 'find')] });
  assert.deepEqual(viewCounts(t, { detail: 'simple' }), { messages: { min: 2, max: 2 }, decisions: 0 });
  assert.equal(viewOf(t, { detail: 'simple' }).messages.length, 2);
});

test('detail=simple is a valid view parameter; unfold is parsed', () => {
  assert.equal(viewParams({ detail: 'simple' }).detail, 'simple');
  assert.deepEqual(viewParams({ unfold: 'a,b' }).unfold, ['a', 'b']);
  assert.throws(() => viewParams({ detail: 'big' }), /simple, external or full/);
});

// unfold: a call repeat (full detail) gets the first expansion's messages under it, numbered 7.1, 7.2 ..., later numbers do not shift
const three = () => ({ main: [call(1, 'x'), call(2, 'helper'), call(3, 'helper'), res(4, 'db', 'find')], x: [leaf(1)], helper: [res(1, 'cache', 'get', 'k'), call(2, 'inner')], inner: [res(1, 'db2', 'get')] });

test('unfold: copies after the marker as sub-steps, later numbers do not shift, the copies say what they are', () => {
  const t = run(three());
  const base = viewOf(t, { detail: 'full', group: false, unfold: [] });
  const keys = stepKeys(t.messages), marker = { ...t.messages.find((m) => m.repeatOf)!, key: keys[t.messages.findIndex((m) => m.repeatOf)] };
  const v = viewOf(t, { detail: 'full', group: false, unfold: [marker.key] });
  const at = v.messages.findIndex((m) => m.repeatOf);
  const copies = v.messages.filter((m) => m.unfoldOf);
  assert.deepEqual(copies.map((m) => m.unfoldOf!.sub), [`${at + 1}.1`, `${at + 1}.2`, `${at + 1}.3`]);
  assert.deepEqual(copies.map((m) => m.label), ['get', 'inner', 'get']);
  assert.equal(copies[0].unfoldOf!.marker, at + 1);
  assert.equal(copies[0].unfoldOf!.first, marker.repeatOf);
  assert.deepEqual(v.messages.filter((m) => !m.unfoldOf).map((m) => m.label), base.messages.map((m) => m.label), 'everything else is as before');
  assert.deepEqual(v.messages.filter((m) => !m.unfoldOf).map((m) => m.repeatOf), base.messages.map((m) => m.repeatOf));
  assert.equal(viewOf(t, { detail: 'full', group: false, unfold: ['nope'] }).messages.length, base.messages.length);
});

test('unfold works in External too (a delivery or a repeated call out), and without it nothing changes', () => {
  const t = run({ main: [out(1), out(2, 'f')] }, {}, true);
  const ext = viewOf(t, { detail: 'external' }), marker = ext.messages.find((m) => m.repeatOf)!;
  assert.ok(marker, 'u reaches t again: a repeat marker');
  const v = viewOf(t, { detail: 'external', unfold: [marker.key!] });
  assert.equal(v.messages.length, ext.messages.length + 1, 'the insert of t is copied under the marker');
  assert.equal(v.messages.find((m) => m.unfoldOf)!.unfoldOf!.sub, `${ext.messages.indexOf(marker) + 1}.1`);
});
