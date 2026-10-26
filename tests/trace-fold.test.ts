// #90: an internal callee is expanded once per trace; later calls to it are one `fn ↩ seen at step N` line (repeatOf: N), as for deliveries (#43).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { viewOf } from '../core/trace-view.ts';

const G = (id: string, arms: Record<string, string[]>) => ({ group_id: id, name: id, arms: Object.entries(arms).map(([arm, step_ids]) => ({ arm, label: arm, step_ids })) });
const leaf = (seq: number, extra: object = {}) => ({ seq, type: 'call', kind: 'leaf', operation: `op${seq}`, ...extra });
const call = (seq: number, target: string, extra: object = {}) => ({ seq, type: 'call', target, ...extra });
function run(fns: Record<string, any[]>, opts: object = {}) {
  const functions = Object.entries(fns).map(([id, steps]) => ({ service: 's', id, name: id, steps }));
  const model: any = { env: 't', services: [{ name: 's', kind: 'service', version: 1, harvestedAt: '2026-01-01' }], functions, ingress: [{ service: 's', id: 'in', bindKey: 'http:GET s/x', transport: 'http', handler: 'main' }], egress: [], resources: [], channels: [], bindings: [] };
  return trace(buildIndex(model), { service: 's', ingress: 'in' }, { scope: 'full', ...opts })!;
}
const labels = (t: any) => t.messages.map((m: any) => m.label);
// helper is reached from three call sites: via x, via y, and directly
const three = () => ({ main: [call(1, 'x'), call(2, 'y'), call(3, 'helper')], x: [call(1, 'helper')], y: [call(1, 'helper')], helper: [leaf(1), call(2, 'inner')], inner: [leaf(1)] });

test('three call sites: the helper expands once, the others are one repeat line with the right step', () => {
  const t = run(three());
  assert.deepEqual(labels(t), ['http:GET s/x', 'x', 'helper', 'op1', 'inner', 'op1', 'y', 'helper ↩ seen at step 3', 'helper ↩ seen at step 3']);
  const reps = t.messages.filter((m) => m.repeatOf);
  assert.deepEqual(reps.map((m) => [m.kind, m.repeatOf, m.internal]), [['call', 3, true], ['call', 3, true]]);
  assert.equal(t.messages[2].repeatOf, undefined);
  assert.equal(t.truncated, false);
  assert.equal(run(three(), { maxMessages: 7 }).truncated, false, 'repeat markers are free in the budget (7 counted messages, 9 drawn)');
  assert.equal(run(three(), { maxMessages: 6 }).truncated, true);
});

test('recursion keeps its cycle marker; a repeat is not a cycle', () => {
  const t = run({ main: [call(1, 'r'), call(2, 'r')], r: [leaf(1), call(2, 'r')] });
  assert.deepEqual(labels(t), ['http:GET s/x', 'r', 'op1', 'r', 'r ↩ seen at step 2']);
  assert.equal(t.messages[3].cycle, true);
  assert.equal(t.messages[3].repeatOf, undefined, 'a call back into an ancestor is a cycle, not a repeat');
  assert.equal(t.messages[4].cycle, false);
});

test('an async repeat starts no deferred work', () => {
  const t = run({ main: [call(1, 'h', { mode: 'async' }), call(2, 'h', { mode: 'async' })], h: [leaf(1)] });
  assert.deepEqual(labels(t), ['http:GET s/x', 'h', 'h ↩ seen at step 2', 'op1']);
  assert.equal(t.messages[2].n, undefined);
});

test('arm rule: the same fn in two arms of an either/or expands in both; a later call outside the arms expands again, then repeats that', () => {
  const g = G('g', { x: ['s:main#1'], y: ['s:main#2'] });
  const t = run({ main: [call(1, 'h', { alternatives: [g] }), call(2, 'h', { alternatives: [g] }), call(3, 'h'), call(4, 'h')], h: [leaf(1)] });
  assert.deepEqual(labels(t), ['http:GET s/x', 'h', 'op1', 'h', 'op1', 'h', 'op1', 'h ↩ seen at step 6']);
});

test('arm rule: an expansion outside every arm is reused inside an arm', () => {
  const g = G('g', { x: ['s:main#2'], y: ['s:main#3'] });
  const t = run({ main: [call(1, 'h'), call(2, 'h', { alternatives: [g] }), call(3, 'h', { alternatives: [g] })], h: [leaf(1)] });
  assert.deepEqual(labels(t), ['http:GET s/x', 'h', 'op1', 'h ↩ seen at step 2', 'h ↩ seen at step 2']);
});

test('values bound on the way down can change the subtree: a different bind expands again', () => {
  const t = run({ main: [call(1, 'h', { bind: { e: 'A' } }), call(2, 'h', { bind: { e: 'B' } }), call(3, 'h', { bind: { e: 'A' } })], h: [leaf(1)] });
  assert.deepEqual(labels(t), ['http:GET s/x', 'h', 'op1', 'h', 'op1', 'h ↩ seen at step 2']);
});

test('a fix in force changes what the callee draws: a call under a different fix expands again', () => {
  const pick = [leaf(1, { alternatives: [G('g', { x: ['s:pick#1'], y: ['s:pick#2'] })] }), leaf(2, { alternatives: [G('g', { x: ['s:pick#1'], y: ['s:pick#2'] })] })];
  const t = run({ main: [call(1, 'pick', { fixes: [{ group_id: 'g', arm: 'x' }] }), call(2, 'pick'), call(3, 'pick')], pick });
  assert.deepEqual(labels(t), ['http:GET s/x', 'pick', 'op1', 'pick', 'op1', 'op2', 'pick ↩ seen at step 4']);
});

test('views renumber repeatOf with the drawn numbering (#89): a hidden arm shifts the step', () => {
  const g = G('g', { x: ['s:main#1'], y: ['s:main#2'] });
  const t = run({ main: [leaf(1, { alternatives: [g] }), leaf(2, { alternatives: [g] }), call(3, 'h'), call(4, 'h')], h: [leaf(1)] });
  const full = t.messages.findIndex((m) => m.label === 'h') + 1;
  assert.equal(t.messages.find((m) => m.repeatOf)!.repeatOf, full);
  const v = viewOf(t, { detail: 'full' }); // the first arm only: the other arm's leaf is gone
  const rep = v.messages.find((m) => m.repeatOf)!;
  assert.equal(rep.repeatOf, v.messages.findIndex((m) => m.label === 'h') + 1);
  assert.equal(rep.repeatOf, full - 1);
  assert.equal(rep.label, `h ↩ seen at step ${full - 1}`);
  const both = viewOf(t, { detail: 'full', choose: { '*': 'both' } });
  assert.equal(both.messages.find((m) => m.repeatOf)!.repeatOf, full);
});

test('external view: repeats of internal calls are hidden with the other internal calls and come back with `open`', () => {
  const t = run(three());
  assert.ok(viewOf(t).messages.every((m) => !m.repeatOf));
  const open = viewOf(t, { open: ['s'] });
  assert.equal(open.messages.filter((m) => m.repeatOf).length, 2);
  for (const m of open.messages.filter((m) => m.repeatOf)) assert.equal(open.messages[m.repeatOf! - 1].label, 'helper');
});
