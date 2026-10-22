// 0.20.0: numbered steps (flow-steps.js), step keys (core/description.ts), the walk state (flow-walk.js). Pure, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { stepKey, stepKeys, stepBase, isStepKey, hasStep, calleeService, traceHash, flowDescriptions } from '../core/description.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { stepsOf, stepAtRow, stepByKey, isStep } from '../web/js/views/flow-steps.js';
// @ts-ignore
import { clampStep, moveStep, encodeStep, decodeStep, walkAction, announce } from '../web/js/views/flow-walk.js';
// @ts-ignore
import { keyAction } from '../web/js/views/flow-tabs-state.js';

const g = buildIndex(sampleModel());
const t = trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full', maxMessages: 800 })!;
const lane = buildLane(t.messages, { scope: t.scope, participants: t.participants });
const steps = stepsOf(lane, stepKeys);
const TYPES = ['call', 'hop', 'unresolved', 'store'];

test('steps: numbered 1..N in run order, one per arrow; returns, pills and notes are not steps', () => {
  assert.ok(steps.length >= 4);
  assert.deepEqual(steps.map((s: any) => s.n), steps.map((_: any, i: number) => i + 1));
  const rows = steps.map((s: any) => s.row);
  assert.deepEqual(rows, [...rows].sort((a, b) => a - b));
  for (const s of steps) assert.ok(TYPES.includes(s.event.type));
  for (const e of lane.events.filter((x: any) => ['return', 'pill', 'mw', 'amqpnote', 'frontier'].includes(x.type))) assert.ok(!isStep(e) && !stepAtRow(steps, e.row));
  assert.ok(lane.events.some((e: any) => e.type === 'return'), 'the sample flow has returns');
  assert.equal(steps.length, lane.events.filter((e: any) => TYPES.includes(e.type)).length);
});

test('steps: the first step is the entry call; ends and labels are display names', () => {
  const s = steps[0];
  assert.equal(s.event.type, 'call');
  assert.equal(s.to, 'api-gateway');
  assert.ok(s.label && typeof s.label === 'string' && s.from);
});

test('steps: store stubs and publish rows are steps', () => {
  for (const s of steps.filter((x: any) => x.event.type === 'store')) assert.ok(s.label.length && s.to);
  assert.ok(steps.some((s: any) => s.event.type === 'hop'));
});

test('step keys: from message content, unique per flow, stable when the flow is rebuilt', () => {
  const keys = steps.map((s: any) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.ok(isStepKey(k));
  const again = buildLane(t.messages.slice(), { scope: t.scope, participants: t.participants });
  assert.deepEqual(stepsOf(again, stepKeys).map((s: any) => s.key), keys);
  const s = steps[2];
  assert.equal(stepByKey(steps, s.key), s);
  assert.equal(stepByKey(steps, '#step:nope'), null);
  assert.equal(stepAtRow(steps, s.row), s);
});

test('step keys: a repeat is counted over the whole trace, so hiding the first copy (depth, stores) keeps the keys', () => {
  const i = t.messages.findIndex((m: any) => m.kind === 'egress' && m.depth <= 2 && steps.some((x: any) => x.event.msg === m));
  const bare = t.messages.map(({ key, ...r }: any) => r); // 0.38.0: a trace's messages carry their `key`; this test makes a copy by hand, so the keys are worked out from content
  const m = bare[i], hidden = { ...m, depth: 99 };
  const all = [...bare.slice(0, i), hidden, ...bare.slice(i)];
  const visible = all.filter((x: any) => x.depth <= 50);
  const laneOf = (msgs: any[]) => buildLane(msgs, { scope: t.scope, participants: t.participants });
  const withAll = stepsOf(laneOf(visible), stepKeys, all).find((x: any) => x.event.msg === m);
  assert.equal(withAll.key, `${stepKey(m)}~2`, 'the second identical arrow, as the full trace numbers it');
  assert.equal(stepsOf(laneOf(visible), stepKeys).find((x: any) => x.event.msg === m).key, stepKey(m), 'counting only what is drawn would give it the first one\'s key');
  assert.equal(stepsOf(laneOf(all), stepKeys, all).find((x: any) => x.event.msg === m).key, withAll.key, 'showing everything keeps it');
});

test('step keys: format, repeats get ~n, base strips it', () => {
  const m = { from: 'svc:a', to: 'svc:b', label: 'http:GET b/x', transport: 'http' };
  assert.equal(stepKey(m), '#step:svc:a>svc:b|http:GET b/x|http');
  assert.equal(stepKey({ ...m, transport: undefined }), '#step:svc:a>svc:b|http:GET b/x|');
  const o = { ...m, label: 'other' };
  assert.deepEqual(stepKeys([m, o, m, m]).map(stepBase), [stepKey(m), stepKey(o), stepKey(m), stepKey(m)]);
  assert.deepEqual(stepKeys([m, m, m]).slice(1), [`${stepKey(m)}~2`, `${stepKey(m)}~3`]);
});

test('calleeService: a step key names no service; service and service:handler still do', () => {
  assert.equal(calleeService(steps[1].key), '');
  assert.equal(calleeService('orders-svc'), 'orders-svc');
  assert.equal(calleeService('orders-svc:in.create'), 'orders-svc');
});

test('step hash covers only the step own messages; hasStep refuses unknown keys', () => {
  const k = steps[1].key;
  assert.ok(hasStep(t, k));
  assert.ok(!hasStep(t, '#step:svc:x>svc:y|nothing|'));
  const h1 = traceHash(t, k);
  const other = t.messages.findIndex((m: any) => stepKey(m) !== k && m.kind === 'call');
  const changed = { messages: t.messages.map((m: any, i: number) => (i === other ? { ...m, label: `${m.label} changed` } : m)) };
  assert.equal(traceHash(changed as any, k), h1);
  assert.notEqual(traceHash(changed as any, ''), traceHash(t, ''));
});

test('flowDescriptions: a step row is a callee with its own outdated flag', () => {
  const k = steps[1].key;
  const row = (callee: string, hash: string) => ({ callee, source: 'ai' as const, text: 'x', author: null, model: 'm', traceHash: hash, updatedAt: '2026-01-01' });
  const d = flowDescriptions(t, 'api-gateway', 'in.createOrder', [row(k, traceHash(t, k)), { ...row(k, ''), source: 'human', text: 'h' }]);
  assert.equal(d.callees[k].ai!.outdated, false);
  assert.equal(d.callees[k].human!.text, 'h');
  const stale = flowDescriptions(t, 'api-gateway', 'in.createOrder', [row(k, 'old')]);
  assert.equal(stale.callees[k].ai!.outdated, true);
});

test('walk state: clamp, move without wrap, first and last', () => {
  assert.equal(clampStep(0, 5), 0); assert.equal(clampStep(9, 5), 5); assert.equal(clampStep('x', 5), 0); assert.equal(clampStep(-3, 5), 0); assert.equal(clampStep(3, 0), 0);
  // 0.36.1: step 0 = no step selected (a flow opens there): next goes to 1, prev from 1 returns to 0, prev at 0 stays
  assert.equal(moveStep(0, 5, 'next'), 1); assert.equal(moveStep(1, 5, 'prev'), 0); assert.equal(moveStep(0, 5, 'prev'), 0); assert.equal(moveStep(0, 0, 'next'), 0);
  assert.equal(moveStep(0, 5, 'first'), 1); assert.equal(moveStep(0, 5, 'last'), 5); assert.equal(moveStep(5, 5, 'next'), 5); assert.equal(moveStep(2, 5, 'next'), 3);
  assert.equal(moveStep(3, 5, 'first'), 1); assert.equal(moveStep(3, 5, 'last'), 5);
});

test('walk URL: step= round trip, junk ignored', () => {
  assert.equal(encodeStep(3), '3'); assert.equal(encodeStep(0), null); assert.equal(encodeStep(null), null); // step 0: no step= in the URL
  assert.equal(decodeStep(new URLSearchParams('step=4')), 4);
  for (const bad of ['', 'x', '0', '-2', '1.5', '99999']) assert.equal(decodeStep(new URLSearchParams(`step=${bad}`)), null);
  assert.equal(decodeStep(new URLSearchParams('tabs=a')), null);
});

test('walk keys: arrows and Home/End; never in a text box; never clash with the tab keys', () => {
  const ev = (key: string, extra: any = {}) => ({ key, target: { tagName: 'DIV' }, ...extra });
  assert.equal(walkAction(ev('ArrowLeft')), 'prev'); assert.equal(walkAction(ev('ArrowRight')), 'next');
  assert.equal(walkAction(ev('Home')), 'first'); assert.equal(walkAction(ev('End')), 'last');
  assert.equal(walkAction(ev('ArrowRight', { target: { tagName: 'TEXTAREA' } })), null);
  assert.equal(walkAction(ev('ArrowRight', { target: { tagName: 'DIV', isContentEditable: true } })), null);
  assert.equal(walkAction(ev('ArrowRight', { altKey: true })), null);
  assert.equal(walkAction(ev('ArrowRight', { target: { tagName: 'DIV', classList: { contains: (c: string) => c === 'seq-scroll' } } })), null, 'a scroller being scrolled');
  assert.equal(walkAction(ev('End', { target: { tagName: 'DIV', closest: (q: string) => (q === '.fi' ? {} : null) } })), null, 'the drill-down panel');
  for (const k of ['[', ']', '1', '9', 'Escape']) assert.equal(walkAction(ev(k)), null);
  for (const k of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.equal(keyAction(ev(k)), null);
  assert.equal(announce(3, 7, 'GET /x'), 'Step 3 of 7: GET /x');
  assert.equal(announce(0, 0, ''), 'No steps in this flow');
});
