// Frame 33: arrow kinds (sync / async / return), the "↩N" return tile's number, and when a return keeps its label. Pure helpers: web/js/views/flow-arrow-kind.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrowKind, callStyle, returnLabel, returnOf, kindWord } from '../web/js/views/flow-arrow-kind.js';
import { buildLane } from '../web/js/views/flow-lane.js';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { stepKeys } from '../core/description.ts';
import { sampleModel } from './helpers.ts';
import { stepsOf } from '../web/js/views/flow-steps.js';

const g = buildIndex(sampleModel());
const call = (mode: string, bar: any = null) => ({ type: 'call', msg: { mode }, bar });

test('sync is a filled head, async an open head, both solid; a return is its own kind', () => {
  assert.equal(arrowKind(call('sync')), 'sync');
  assert.equal(arrowKind(call('async')), 'async');
  assert.equal(arrowKind(call('async', { id: 1 })), 'async', 'an async call that opens a bar is async too');
  assert.equal(arrowKind({ type: 'return', bar: {} }), 'return');
  assert.equal(arrowKind({ type: 'hop', msg: {} }), 'async', 'a publish hop (nobody waits) is async');
  assert.equal(arrowKind({ type: 'store', msg: {} }), 'sync');
  assert.deepEqual(callStyle(call('async')), { open: true });
  assert.deepEqual(callStyle(call('sync')), { open: false });
  for (const bar of [null, { id: 1 }]) assert.equal('dashed' in callStyle(call('async', bar)), false, 'an async call is never dashed');
  assert.equal(kindWord(call('async')), 'async');
  assert.equal(kindWord(call('sync')), 'sync');
});

test('a return keeps its label only when it carries information', () => {
  for (const t of ['return', 'Return', 'ok', 'OK', '', '  ', null, undefined]) assert.equal(returnLabel(t), null, `"${t}" is dropped`);
  for (const t of ['201', 'rows', 'id', '200 report']) assert.equal(returnLabel(t), t);
  assert.equal(returnLabel(['201', 'Created']), '201 Created');
});

test('a return names the step of the call it closes, whatever order the returns arrive in', () => {
  const t: any = trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full', maxMessages: 800 });
  const lane: any = buildLane(t.messages, { scope: t.scope, participants: t.participants });
  const steps = stepsOf(lane, stepKeys);
  const rets = lane.events.filter((e: any) => e.type === 'return');
  assert.ok(rets.length >= 2, 'the sample flow has sync returns');
  for (const r of rets) {
    const n = returnOf(lane.events, steps, r);
    assert.equal(steps[n - 1].event, lane.events[r.bar.start], 'the number points at the step of the bar the return closes');
  }
  assert.equal(returnOf(lane.events, steps, { bar: null }), null);
});

test('the legend and the tile code use the notation', () => {
  const read = (f: string) => readFileSync(new URL(`../web/js/views/${f}`, import.meta.url), 'utf8');
  assert.match(read('flow-draw-rows.js'), /callStyle\(e\)/);
  assert.doesNotMatch(read('flow-draw-rows.js'), /dashed: e\.msg\.mode === 'async'/);
  assert.match(read('flow-legend.js'), /answers call 4/);
  assert.match(read('flow-step-tiles.js'), /↩\$\{n\}/);
});
