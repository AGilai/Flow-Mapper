// 0.41.2 (#84): "Frontier steps" ticked draws every frontier message, in the External view too, and the folded
// "N internal calls" marker opens on a click or a key. Demo: samples/safer-auth.json (7 frontier messages, two unresolved).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { viewOf } from '../core/trace-view.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { wireEvents } from '../web/js/views/flow-draw-events.js';
// @ts-ignore
import { pillAction } from '../web/js/views/flow-scenario-pure.js';
// @ts-ignore
import { requestKey } from '../web/js/views/flow-sub.js';
// @ts-ignore
import { createTabData } from '../web/js/views/flow-tab-data.js';
// @ts-ignore
import { fullKey } from '../web/js/views/flow-tab-keys.js';

const g = buildIndex(sampleModel());
const start = { service: 'safer-auth', ingress: 'in.authenticate' };
const kinds = (t: any) => t.messages.map((m: any) => `${m.kind}:${m.label}`);
const unfolded = trace(g, start, { scope: 'full', frontier: true, maxMessages: 800 })!;
const folded = trace(g, start, { scope: 'full', maxMessages: 800 })!;

test('the demo: frontier=1 makes 7 messages, two unresolved; without it one folded marker', () => {
  assert.equal(unfolded.messages.length, 7);
  assert.deepEqual(unfolded.messages.filter((m: any) => m.gap).map((m: any) => m.gap.reason), ['unknown_receiver', 'class_not_in_repo']);
  assert.deepEqual(kinds(folded).map((k: string) => k.split(':')[0]), ['entry', 'frontier']);
});

test('viewOf: the External detail keeps every frontier step and the folded marker (was: only the two unresolved ones)', () => {
  assert.equal(viewOf(unfolded, { detail: 'external' }).messages.length, 7);
  assert.equal(viewOf(unfolded, { detail: 'full' }).messages.length, 7);
  assert.deepEqual(kinds(viewOf(folded, { detail: 'external' })), kinds(folded));
});

test('viewOf: an ordinary internal call is still hidden in External, and open brings it back', () => {
  const plain = { ...unfolded, messages: unfolded.messages.map((m: any) => (m.origin ? { ...m, origin: undefined, gap: undefined } : m)) } as any;
  assert.equal(viewOf(plain, { detail: 'external' }).messages.length, 1);
  assert.equal(viewOf(plain, { detail: 'external', open: ['safer-auth'] }).messages.length, 7);
});

test('lane: with frontier steps on, External draws a row for each of the 6 steps and no folded marker', () => {
  for (const icalls of [false, true]) {
    const v = viewOf(unfolded, { detail: 'external' });
    const lane = buildLane(v.messages, { scope: v.scope, participants: v.participants, icalls });
    assert.equal(lane.events.filter((e: any) => e.type === 'icall').length, 6, `icalls=${icalls}`);
    assert.equal(lane.events.filter((e: any) => e.type === 'pill').length, 0);
    assert.equal(lane.events.filter((e: any) => e.type === 'icall' && (e.msg.gap)).length, 2);
  }
});

test('lane: an ordinary internal call still folds into the marker, counted with its unresolved ones', () => {
  const msgs = unfolded.messages.map((m: any) => ({ ...m, origin: undefined }));
  const lane = buildLane(msgs, { scope: 'full', participants: unfolded.participants });
  const pill = lane.events.find((e: any) => e.type === 'pill');
  assert.deepEqual([pill.bar.internal.n, pill.bar.internal.gaps], [6, 2]);
});

// a body that records its listeners, and a target that answers closest() for the attributes it has
function wired(handlers: any) {
  const on: Record<string, (ev: any) => void> = {};
  const bars = [{ id: 0, service: 'safer-auth' }];
  const mk = () => ({ addEventListener: (n: string, f: any) => { on[n] = f; } });
  wireEvents(mk(), mk(), { columns: [], events: [], bars }, handlers);
  const target = (attrs: string[]) => ({ closest: (sel: string) => (attrs.some((a) => sel === `[${a}]`) ? { dataset: { pill: '0' }, classList: { contains: () => false } } : null) });
  return { click: (attrs: string[]) => on.click({ target: target(attrs), detail: 1 }), key: (attrs: string[], key: string) => on.keydown({ target: target(attrs), key, preventDefault() {} }) };
}

test('click and Enter / Space on the folded marker call onPill; a middleware label still looks inside', () => {
  const calls: string[] = [];
  const w = wired({ onPill: () => calls.push('pill'), onBar: () => calls.push('bar') });
  w.click(['data-pill', 'data-ipill']); w.key(['data-pill', 'data-ipill'], 'Enter'); w.key(['data-pill', 'data-ipill'], ' ');
  assert.deepEqual(calls, ['pill', 'pill', 'pill']);
  w.click(['data-pill']); w.key(['data-pill'], 'Enter');
  assert.deepEqual(calls.slice(3), ['bar', 'bar']);
});

test('the marker opens the calls where the view is lazy, and looks inside everywhere else', () => {
  assert.equal(pillAction(0, true), 'open');
  assert.equal(pillAction(0, false), 'inside'); // Full, or an intra flow
  assert.equal(pillAction(1, true), 'inside'); // a card in the list below the lane
});

test('request: Frontier steps goes on the trace request of a tab, as its own cache key, with the detail and the opened services', async () => {
  const asked: URLSearchParams[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => { asked.push(new URL(url, 'http://x').searchParams); return { ok: true, text: async () => JSON.stringify(unfolded) }; }) as any;
  try {
    for (const frontier of [true, false]) await createTabData('prod', () => ({ frontier })).load(fullKey('safer-auth', 'in.authenticate'));
    assert.deepEqual(asked.map((q) => [q.get('frontier'), q.get('detail'), q.get('scope'), q.get('choose'), q.get('group')]), [['1', 'external', 'full', '*:both', '0'], [null, 'external', 'full', '*:both', '0']]);
    const [a, b] = asked.map((q) => Object.fromEntries(q));
    assert.notEqual(requestKey(a), requestKey(b));
    await createTabData('prod', () => ({ frontier: true })).baseFor({ ...a, frontier: '1' }, 'external', ['safer-auth']);
    assert.equal(asked.at(-1)!.get('open'), 'safer-auth');
  } finally { globalThis.fetch = real; }
});
