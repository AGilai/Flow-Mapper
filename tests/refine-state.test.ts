// 0.28.1: the Refine grid of an abstract link's panel (web/js/design/refine-state.js, pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { NEW_CALL, refineModel, choiceEdit, callEdit, suggestionEdit, suggestionLabel } from '../web/js/design/refine-state.js';

const end = (subsystem: string, service?: string) => (service ? { anchor: `svc:${service}`, level: 'component', subsystem, service } : { anchor: `grp:${subsystem}`, level: 'subsystem', subsystem });
const view = (from = end('network'), to = end('platform')) => ({ id: 'usage-metering', name: 'usage metering', from, to, state: 'abstract', problems: [], refinedBy: [] });
const comps = (k: string) => ({ network: ['pop-edge', 'swg-api'], platform: ['auth-svc', 'activitylog'] } as any)[k] ?? [];
const sugg = [{ use: { service: 'swg-api', egress: 'policyChanged.publish' }, reason: 'x' }, { use: { service: 'sxdns', egress: 'dnsOverride.publish' }, reason: 'y' }, { from: 'svc:pop-edge', reason: 'z' }];
const none = { from: '', via: '', to: '', toEp: '' };

test('refineModel: both ends are subsystems: both selects open, Via waits for a From component', () => {
  const m = refineModel(view(), none, comps, sugg);
  assert.deepEqual([m.from.open, m.to.open, m.via.open, m.epOpen], [true, true, false, false]);
  assert.deepEqual(m.from.options, ['pop-edge', 'swg-api']);
});

test('refineModel: Via offers the existing calls of the chosen From component, and "new call"', () => {
  const m = refineModel(view(), { ...none, from: 'swg-api' }, comps, sugg);
  assert.equal(m.via.open, true);
  assert.deepEqual(m.via.options.map((o: any) => o.value), ['policyChanged.publish', NEW_CALL]);
});

test('refineModel: an end that is already a component is fixed and the endpoint select opens', () => {
  const m = refineModel(view(end('network', 'pop-edge'), end('platform', 'auth-svc')), none, comps, sugg);
  assert.deepEqual([m.from.open, m.to.open, m.epOpen, m.via.open], [false, false, true, true]);
  assert.equal(m.from.value, 'pop-edge');
});

test('choiceEdit: nothing chosen is no edit; a From component narrows; From and To narrow both', () => {
  assert.equal(choiceEdit(view(), none), null);
  assert.deepEqual(choiceEdit(view(), { ...none, from: 'pop-edge' }), { action: 'narrow', edit: { kind: 'refine-link', id: 'usage-metering', from: 'svc:pop-edge' } });
  assert.deepEqual(choiceEdit(view(), { ...none, from: 'pop-edge', to: 'auth-svc', toEp: 'in.token' }).edit, { kind: 'refine-link', id: 'usage-metering', from: 'svc:pop-edge', to: 'ing:auth-svc/in.token' });
});

test('choiceEdit: an existing call is a `use`; "new call" opens the call builder with the ends filled in', () => {
  assert.deepEqual(choiceEdit(view(), { ...none, from: 'swg-api', via: 'policyChanged.publish' }), { action: 'use', edit: { kind: 'refine-link', id: 'usage-metering', use: { service: 'swg-api', egress: 'policyChanged.publish' } } });
  assert.deepEqual(choiceEdit(view(), { ...none, from: 'pop-edge', via: NEW_CALL, to: 'auth-svc' }), { action: 'call', from: 'pop-edge', to: { service: 'auth-svc', ingress: undefined } });
  assert.equal(choiceEdit(view(), { ...none, via: 'x' }), null, 'a call needs its From component');
});

test('callEdit wraps the call builder\'s edit (without its kind); suggestions make the same edits', () => {
  assert.deepEqual(callEdit('l', { kind: 'call', from: { service: 'a', fn: 'f' }, to: { service: 'b', ingress: 'i' } }), { kind: 'refine-link', id: 'l', call: { from: { service: 'a', fn: 'f' }, to: { service: 'b', ingress: 'i' } } });
  assert.deepEqual(suggestionEdit(view(), sugg[0]), { kind: 'refine-link', id: 'usage-metering', use: sugg[0].use });
  assert.deepEqual(suggestionEdit(view(), sugg[2]), { kind: 'refine-link', id: 'usage-metering', from: 'svc:pop-edge' });
  assert.equal(suggestionLabel(sugg[0]), 'Use swg-api');
  assert.equal(suggestionLabel(sugg[2]), 'Use pop-edge');
});
