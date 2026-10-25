// 0.43.2 (#89): the activation bars follow `from`. A caller's next call, drawn after the deeper call of a deferred (async) internal call, starts on the caller's
// lifeline, not inside the previous callee's bar; "seen at step N" is the drawn number of the view; the External order is the canonical order with the hidden calls removed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { viewOf } from '../core/trace-view.ts';
import { stepKeys } from '../core/description.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { stepsOf } from '../web/js/views/flow-steps.js';

const svc = (name: string) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' });
const leaf = (seq: number) => ({ seq, type: 'call', kind: 'leaf', operation: `op${seq}` });
const call = (seq: number, target: string, extra: object = {}) => ({ seq, type: 'call', target, ...extra });
const egress = (seq: number, target: string) => ({ seq, type: 'egress', target });

/** cp (the caller) -> ext. main: a hidden helper first, then the first POST (so a later repeat of it has a canonical number above its view number), then getTenantUsers:
 *  its seq 1 calls appAuth (mode `mode`), whose POST goes to ext again (a repeat); its seq 2 is the GET. */
function flow(mode: 'sync' | 'async') {
  const fns: Record<string, any[]> = {
    main: [call(1, 'helper'), egress(2, 'post'), call(3, 'users')], helper: [leaf(1), leaf(2)],
    users: [call(1, 'appAuth', { mode }), egress(2, 'get')], appAuth: [egress(1, 'post')],
  };
  const model: any = { env: 't', services: [svc('cp'), svc('ext')],
    functions: [...Object.entries(fns).map(([id, steps]) => ({ service: 'cp', id, name: id, steps })), { service: 'ext', id: 'a', name: 'a', steps: [leaf(1)] }, { service: 'ext', id: 'm', name: 'm', steps: [leaf(1)] }],
    ingress: [{ service: 'cp', id: 'in', bindKey: 'http:GET cp/x', transport: 'http', handler: 'main' }, { service: 'ext', id: 'in.a', bindKey: 'http:POST ext/auth', transport: 'http', handler: 'a' }, { service: 'ext', id: 'in.m', bindKey: 'http:GET ext/member', transport: 'http', handler: 'm' }],
    egress: [{ service: 'cp', id: 'post', bindKey: 'http:POST ext/auth', transport: 'http', mode: 'sync' }, { service: 'cp', id: 'get', bindKey: 'http:GET ext/member', transport: 'http', mode: 'sync' }], resources: [], channels: [], bindings: [] };
  return trace(buildIndex(model), { service: 'cp', ingress: 'in' }, { scope: 'full', maxMessages: 500 })!;
}
const http = (t: any) => t.messages.filter((m: any) => m.kind === 'egress').map((m: any) => m.label.replace(/^http:/, '').replace(/ ↩.*/, ''));

test('#89 order: a sync appAuth puts its POST before the caller\'s GET, in Full and in External; an async one is deferred after the caller (#73), in both', () => {
  for (const [mode, want] of [['sync', ['POST ext/auth', 'POST ext/auth', 'GET ext/member']], ['async', ['POST ext/auth', 'GET ext/member', 'POST ext/auth']]] as const) {
    const t = flow(mode);
    assert.deepEqual(http(t), want, `${mode}: canonical`);
    assert.deepEqual(http(viewOf(t, { detail: 'external' })), want, `${mode}: External keeps the canonical order of what it shows`);
    assert.deepEqual(http(viewOf(t, { detail: 'full', group: true })), want, `${mode}: Full too`);
  }
});

test('#89 repeatOf is the view\'s number: renumbered like n, and equal to the drawn step number of the first expansion', () => {
  const t = flow('async');
  const canon = t.messages.find((m) => m.repeatOf)!;
  const ext = viewOf(t, { detail: 'external' }), rep = ext.messages.find((m) => m.repeatOf)!;
  assert.ok(rep.repeatOf! < canon.repeatOf!, 'the hidden calls before the first POST are gone from the view, so its number is lower than the canonical one');
  assert.equal(ext.messages[rep.repeatOf! - 1].label, 'http:POST ext/auth', 'it points at the first POST of the view');
  assert.ok(rep.label.endsWith(`↩ seen at step ${rep.repeatOf}`));
  const lane = buildLane(ext.messages, { scope: ext.scope, participants: ext.participants }), steps = stepsOf(lane, stepKeys, ext.messages);
  assert.equal(steps.find((s: any) => s.event.msg === rep)!.n > rep.repeatOf!, true);
  assert.equal(steps[rep.repeatOf! - 1].event.msg, ext.messages[rep.repeatOf! - 1], 'drawn step number == message number here: the view\'s first POST is drawn as that step');
});

test('#89 lane: the POST after the GET starts on cp\'s lifeline: no self-call on ext, no second bar nested in the GET\'s', () => {
  for (const mode of ['async', 'sync'] as const) {
    const ext = viewOf(flow(mode), { detail: 'external' });
    const lane = buildLane(ext.messages, { scope: ext.scope, participants: ext.participants });
    const calls = lane.events.filter((e: any) => e.type === 'call' && e.bar);
    assert.ok(calls.every((e: any) => e.from !== e.to), `${mode}: no call from a lifeline to itself`);
    const extBars = lane.bars.filter((b: any) => b.service === 'ext');
    assert.equal(extBars.length, 3);
    assert.deepEqual(extBars.map((b: any) => b.level), [0, 0, 0], `${mode}: the bars of ext are never stacked`);
    for (const e of calls.filter((x: any) => x.bar.service === 'ext')) assert.equal(e.from.service, 'cp', `${mode}: every call into ext starts on cp`);
    const [a, b] = extBars.slice(-2);
    assert.ok(a.end < b.start || b.end < a.start, `${mode}: the last two bars do not overlap`);
  }
});

test('#89 the sample: tenant-gateway GET /tenants/{id}/users draws POST, GET, POST, each a bar of its own on ext-checkpoint-cloud', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, { service: 'tenant-gateway', ingress: 'in.tenantUsers' }, { scope: 'full', maxMessages: 500 })!, v = viewOf(t, { detail: 'external' });
  assert.deepEqual(v.messages.map((m) => m.label.replace(/^http:/, '')), ['GET tenant-gateway/api/v1/tenants/{tenantId}/users', 'POST ext-checkpoint-cloud/v2/auth/app', 'GET ext-checkpoint-cloud/api/v1/user/tenant/membership', 'POST ext-checkpoint-cloud/v2/auth/app ↩ seen at step 2']);
  assert.equal(v.messages[3].repeatOf, 2);
  const lane = buildLane(v.messages, { scope: v.scope, participants: v.participants });
  assert.deepEqual(lane.bars.filter((b: any) => b.service === 'ext-checkpoint-cloud').map((b: any) => b.level), [0, 0, 0]);
});
