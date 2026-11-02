// 0.47.0 (#97): External is compact: entry, egress, deliver, resource and the arms between them. No internal calls, frontier steps,
// folded markers or problem-only messages, with or without frontier=1. Full is unchanged, `open` still brings internals back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { viewOf, viewCounts } from '../core/trace-view.ts';
import { traceBlocked, blockedSites } from '../core/incomplete.ts';
// @ts-ignore plain JS module shared with the browser
import { frontierSimple } from '../web/js/views/flow-prefs.js';
import { startApp, readSample } from './helpers.ts';

const svc = (name: string) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' });
const call = (seq: number, target: string, extra: object = {}) => ({ seq, type: 'call', target, ...extra });
const fr = (seq: number, target: string, extra: object = {}) => call(seq, target, { origin: 'frontier', ...extra });
const G = (id: string, arms: Record<string, string[]>) => ({ group_id: id, name: id, arms: Object.entries(arms).map(([arm, step_ids]) => ({ arm, label: arm, step_ids })) });
const unres = (seq: number, extra: object = {}) => ({ seq, type: 'call', unresolved: [{ what: 'target', reason: 'dynamic_call', gap: true }], ...extra });
function run(fns: Record<string, any[]>, opts: object = {}) {
  const model: any = { env: 't', services: [svc('s')],
    functions: Object.entries(fns).map(([id, steps]) => ({ service: 's', id, name: id, steps })),
    ingress: [{ service: 's', id: 'in', bindKey: 'http:GET s/x', transport: 'http', handler: 'main' }],
    egress: [{ service: 's', id: 'e', bindKey: 'http:GET x/y', transport: 'http', mode: 'sync' }],
    resources: [{ service: 's', id: 'db', kind: 'mongodb', name: 'db', bindKey: 'mongodb:d/users' }], channels: [], bindings: [] };
  return trace(buildIndex(model), { service: 's', ingress: 'in' }, { scope: 'full', maxMessages: 800, ...opts })!;
}
const out = (seq: number, extra: object = {}) => ({ seq, type: 'egress', target: 'e', ...extra });
const res = (seq: number, extra: object = {}) => ({ seq, type: 'resource', target: 'db', operation: 'find', ...extra });
const FNS = { main: [call(1, 'a'), out(2), res(3), unres(4)], a: [call(1, 'b'), fr(2, 'b')], b: [fr(1, 'a')] };
const kinds = (t: any) => t.messages.map((m: any) => m.kind);

test('External drops internal calls, frontier steps, folded markers and problems, with and without frontier=1', () => {
  for (const frontier of [false, true]) {
    const t = run(FNS, { frontier }), v = viewOf(t, { detail: 'external' });
    assert.deepEqual(kinds(v), ['entry', 'egress', 'resource'], `frontier=${frontier}`);
    assert.ok(kinds(t).includes('call'), 'the canonical trace has internal calls');
    assert.deepEqual(viewCounts(t, { detail: 'external' }).messages, v.counts!.messages, 'viewCounts agrees');
  }
});

test('Full is unchanged; Simple still shows problems', () => {
  const t = run(FNS, { frontier: true });
  assert.equal(viewOf(t, { detail: 'full' }).messages.length, t.messages.length);
  assert.ok(viewOf(t, { detail: 'full' }).messages.some((m: any) => m.origin === 'frontier'));
  assert.ok(!viewOf(t, { detail: 'simple' }).messages.some((m: any) => m.origin === 'frontier'));
  assert.ok(viewOf(t, { detail: 'simple' }).messages.some((m: any) => m.blocked || m.gap));
});

test('open= still brings a service back in External', () => {
  const t = run(FNS, { frontier: true });
  assert.ok(viewOf(t, { detail: 'external', open: ['s'] }).messages.some((m: any) => m.kind === 'call'));
});

test('open= never brings back frontier steps or folded markers', () => {
  for (const frontier of [false, true]) {
    const v = viewOf(run(FNS, { frontier }), { detail: 'external', open: ['s'] });
    assert.ok(!v.messages.some((m: any) => m.origin === 'frontier' || m.kind === 'frontier'), `frontier=${frontier}`);
  }
});

test('"Why incomplete" is unchanged: the External view carries the blocked steps of the full trace', () => {
  const t = run({ main: [out(1), unres(2), call(3, 'a')], a: [unres(1, { origin: 'frontier' })] }, { frontier: true });
  const full = traceBlocked(t, null), v = viewOf(t, { detail: 'external' });
  assert.ok(full.n >= 1);
  assert.equal(v.messages.some((m: any) => m.blocked), false);
  assert.deepEqual(traceBlocked(v, null), full);
  assert.deepEqual(blockedSites(v, null).sites, blockedSites(t, null).sites);
  assert.equal(viewOf(t, { detail: 'full' }).blockedAll, undefined);
});

test('arm fallback: an arm with nothing external keeps one message, not a frontier one when a plain one exists', () => {
  const alt = (g: any) => ({ alternatives: [g] });
  const g = G('g', { x: ['s:main#1', 's:main#2'], y: ['s:main#3'] });
  const t = run({ main: [fr(1, 'a', alt(g)), call(2, 'a', alt(g)), call(3, 'a', alt(g))], a: [] }, { frontier: true });
  const v = viewOf(t, { detail: 'external', choose: { g: 'x' } });
  assert.deepEqual(v.messages.filter((m: any) => m.kind !== 'entry').map((m: any) => [m.seq, m.origin ?? null]), [[2, null]], 'the plain call, not the frontier step');
  const only = run({ main: [fr(1, 'a', alt(g)), fr(2, 'a', alt(g)), call(3, 'a', alt(g))], a: [] }, { frontier: true });
  assert.deepEqual(viewOf(only, { detail: 'external', choose: { g: 'x' } }).messages.filter((m: any) => m.kind !== 'entry').map((m: any) => m.seq), [1], 'only frontier content: today\'s first-message fallback');
});

test('the Frontier steps checkbox is disabled outside Full, with its tooltip', () => {
  const input: any = { disabled: false }, cls = new Set<string>();
  const label: any = { dataset: { tip: 'Draw frontier steps' }, title: 'Draw frontier steps', querySelector: () => input, classList: { toggle: (c: string, on: boolean) => (on ? cls.add(c) : cls.delete(c)) } };
  frontierSimple(label, true);
  assert.deepEqual([input.disabled, label.title, cls.has('disabled')], [true, 'Frontier steps show in Full', true]);
  frontierSimple(label, false);
  assert.deepEqual([input.disabled, label.title, cls.has('disabled')], [false, 'Draw frontier steps', false]);
});

test('API: detail=external ignores frontier=1; detail=full keeps the frontier steps', async () => {
  const app = await startApp();
  try {
    const r = await app.call('POST', '/api/ingest', { manifests: [readSample('safer-auth.json')] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const q = '/api/envs/prod/trace?service=safer-auth&ingress=in.authenticate';
    const ext = (await app.call('GET', `${q}&detail=external&frontier=1`)).body, plain = (await app.call('GET', `${q}&detail=external`)).body;
    assert.equal(ext.messages.some((m: any) => m.origin === 'frontier' || m.kind === 'frontier' || m.gap), false);
    assert.deepEqual(ext.messages.map((m: any) => m.label), plain.messages.map((m: any) => m.label));
    assert.ok((await app.call('GET', `${q}&detail=full&frontier=1`)).body.messages.some((m: any) => m.origin === 'frontier'));
    assert.ok(ext.blockedAll?.n >= 1, 'the problems stay reported');
  } finally { await app.close(); }
});
