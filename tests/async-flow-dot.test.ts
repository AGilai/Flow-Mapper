// 0.9.5: deliveries that reach a consumer ingress end in a dot; async sub-flows get a half-row gap above them,
// a colour of their own and a band. Demo: saga-controller in.start (samples).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS module shared with the browser
import { asyncFlowOf, gapRows, gapsAbove, flowSpans, FLOW_COLORS } from '../web/js/views/sequence-plan.js';
// @ts-ignore
import { rowsOf } from '../web/js/views/sequence-render.js';

const g = buildIndex(sampleModel());
const d = (to: string, depth: number, extra = {}) => ({ kind: 'deliver', from: 'ch:q', to, depth, target: { service: 's', ingress: 'in' }, ...extra });
const call = (from: string, to: string, depth: number) => ({ kind: 'call', from, to, depth });

test('asyncFlowOf: only deliveries that reach a handled consumer ingress', () => {
  assert.deepEqual(asyncFlowOf({ kind: 'deliver', target: { service: 'a', ingress: 'in.x' } }), { service: 'a', ingress: 'in.x' });
  assert.equal(asyncFlowOf({ kind: 'egress', target: { service: 'a', ingress: 'in.x' } }), null);
  assert.equal(asyncFlowOf({ kind: 'deliver', broken: true, unhandled: true, target: { service: 'a', ingress: 'in.x' } }), null);
  assert.equal(asyncFlowOf({ kind: 'deliver' }), null);
});

// entry, two deliveries (f1, f2), their subtrees (f1 -> x, f1 -> y, f2 -> z), then a repeat of the first
const msgs = [
  { kind: 'entry', from: 'c', to: 'f', depth: 0 },
  d('f1', 1), d('f2', 1),
  call('f1', 'x', 2), call('x', 'y', 3),
  call('f2', 'z', 2),
  d('f3', 1, { repeatOf: 2 }),
];

test('gapRows: a subtree not right under its delivery, and repeats, get a gap; row 0 never', () => {
  const { rows } = rowsOf(msgs);
  assert.deepEqual([...gapRows(msgs, rows)], [rows[3], rows[5], rows[6]]);
  assert.deepEqual(gapsAbove(new Set([2, 4]), 5), [0, 0, 1, 1, 2, 2]);
  assert.equal(gapRows(msgs.slice(0, 1), [0]).size, 0);
});

test('flowSpans: one span per expanded delivery, colours by delivery order, a repeat takes its flow\'s colour', () => {
  const { spans, colorOf, spanOf } = flowSpans(msgs);
  assert.deepEqual(spans.map((s: any) => [s.i, s.start, s.end, s.color, s.level]), [[1, 3, 4, 1, 0], [2, 5, 5, 2, 0]]);
  assert.equal(colorOf.get(6), 1);
  assert.equal(spanOf.get(6).start, 3);
  assert.equal(colorOf.get(0), undefined);
  assert.equal(flowSpans(msgs).spans[0].color, spans[0].color); // stable
  assert.ok(FLOW_COLORS >= 6);
});

test('flowSpans: nested sub-flows sit inside their parent', () => {
  const nested = [{ kind: 'entry', from: 'c', to: 'f', depth: 0 }, d('f1', 1), call('f1', 'x', 2), d('f2', 3), call('f2', 'y', 4)];
  const { spans } = flowSpans(nested);
  assert.deepEqual(spans.map((s: any) => [s.color, s.level]), [[1, 0], [2, 1]]);
});

test('a real fan-out trace has dots, a gap before consumer subtrees and a span per consumer', () => {
  const t = trace(g, { service: 'saga-controller', ingress: 'in.start' }, { scope: 'full' })!;
  assert.ok(t.messages.some((m) => asyncFlowOf(m)));
  const { rows } = rowsOf(t.messages);
  assert.ok(gapRows(t.messages, rows).size > 0);
  assert.ok(flowSpans(t.messages).spans.length > 0);
});
