// 0.26.0: which form a click opens (View keeps today's panels), and what the forms send. Pure parts of web/js/design/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { formFor, editing } from '../web/js/design/edit-target.js';
// @ts-ignore
import { componentEdit } from '../web/js/design/forms/component-form.js';
// @ts-ignore
import { endpointEdit } from '../web/js/design/forms/endpoint-form.js';
// @ts-ignore
import { callTo } from '../web/js/design/forms/call-form.js';
// @ts-ignore
import { moved } from '../web/js/design/forms/flow-form.js';
// @ts-ignore
import { parseContent, looksLikeSchema } from '../web/js/design/forms/dto-parse.js';
// @ts-ignore
import { refCalloutText } from '../web/js/design/forms/ref-callout.js';
// @ts-ignore
import { atLeast, toLink } from '../web/js/design/forms/links-fields.js';
// @ts-ignore
import { comesAlong } from '../web/js/design/import-panel.js';
// @ts-ignore
import { itemLabel } from '../web/js/design/draft-review.js';

test('Edit mode needs a draft; View keeps the read-only panels', () => {
  assert.equal(editing({ mode: 'edit', draft: 'd' }), true);
  assert.equal(editing({ mode: 'edit', draft: null }), false);
  assert.equal(editing({ mode: 'view', draft: 'd' }), false);
  for (const t of [{ type: 'head', service: 'a' }, { type: 'arrow', message: { kind: 'egress', egress: 'out.x', service: 'a' } }, { type: 'add-call' }, { type: 'add-component' }])
    assert.equal(formFor(false, t), null, `${t.type} in View`);
});

test('which form for which click in Edit', () => {
  assert.equal(formFor(true, { type: 'head', service: 'pop-edge' }), 'component');
  assert.equal(formFor(true, { type: 'head' }), null, 'a queue or missing head has no component');
  assert.equal(formFor(true, { type: 'arrow', message: { kind: 'egress', egress: 'out.x', service: 'a' } }), 'call');
  assert.equal(formFor(true, { type: 'arrow', message: { kind: 'entry', service: 'a', target: { ingress: 'in.x' } } }), 'endpoint', 'the entry arrow is the endpoint');
  assert.equal(formFor(true, { type: 'arrow', message: { kind: 'deliver', service: 'a' } }), null, 'a delivery keeps its panel');
  assert.equal(formFor(true, { type: 'arrow', message: { kind: 'resource' } }), null);
  assert.equal(formFor(true, { type: 'add-call' }), 'call');
  assert.equal(formFor(true, { type: 'add-component' }), 'component');
  assert.equal(formFor(true, { type: 'title', service: 'a', ingress: 'in.x' }), 'flow');
});

test('component edit: name rule, kind, subsystem; runtime and links only when given', () => {
  const v = { name: 'pop-swg', serviceKind: 'service', groupPath: 'network', team: ' net ', description: ' d ' };
  assert.deepEqual(componentEdit(v), { kind: 'component', name: 'pop-swg', serviceKind: 'service', groupPath: 'network', team: 'net', description: 'd' });
  assert.throws(() => componentEdit({ ...v, name: 'Pop_Swg' }), (e: any) => e.field === 'name');
  assert.deepEqual(componentEdit({ ...v, runtime: 'k8s-pod', links: null }).runtime, 'k8s-pod');
  assert.equal(componentEdit({ ...v, links: null }).links, null, 'null removes the links');
  assert.ok(!('links' in componentEdit(v)), 'absent keeps them');
});

test('endpoint edit: a bind key unless the transport is not decided; events one per line', () => {
  const base = { service: 'a', transport: 'socket', bindKey: ' socket:tls/a/x ', handler: '', entryPoint: true, events: 'Ping\nPong a.pong' };
  assert.deepEqual(endpointEdit(base), { service: 'a', transport: 'socket', bindKey: 'socket:tls/a/x', entryPoint: true, events: [{ type: 'Ping' }, { type: 'Pong', handler: 'a.pong' }] });
  assert.throws(() => endpointEdit({ ...base, bindKey: '' }), (e: any) => e.field === 'bindKey');
  assert.equal(endpointEdit({ ...base, transport: 'undecided', bindKey: '', entryPoint: false }).entryPoint, false, 'unticking writes false');
});

test('call target: an existing endpoint, a new endpoint, or not designed yet (which needs a key)', () => {
  assert.deepEqual(callTo('b', 'in.x', null), { service: 'b', ingress: 'in.x' });
  assert.deepEqual(callTo('b', '__new', { service: 'b', transport: 'http' }), { endpoint: { service: 'b', transport: 'http' } });
  assert.deepEqual(callTo('b', '__tbd', { bindKey: ' http:GET b/x ', transport: 'http' }), { bindKey: 'http:GET b/x', transport: 'http' });
  assert.throws(() => callTo('b', '__tbd', { bindKey: '', transport: 'http' }), (e: any) => e.field === 'to');
});

test('flow form: ↑ ↓ keep every step once; the ends do not move', () => {
  assert.deepEqual(moved([1, 2, 3], 1, -1), [2, 1, 3]);
  assert.deepEqual(moved([1, 2, 3], 1, 1), [1, 3, 2]);
  assert.deepEqual(moved([1, 2, 3], 0, -1), [1, 2, 3]);
  assert.deepEqual(moved([1, 2, 3], 2, 1), [1, 2, 3]);
});

test('DTO form: content is JSON with an inline error; a schema shows its table', () => {
  assert.deepEqual(parseContent('{"a":1}'), { a: 1 });
  assert.throws(() => parseContent('{a'), (e: any) => e.field === 'content' && /Not valid JSON/.test(e.message));
  assert.equal(looksLikeSchema({ type: 'object', properties: {} }), true);
  assert.equal(looksLikeSchema({ id: 1, name: 'x' }), false);
});

test('the reference callout names the other side and says the edit changes the call only', () => {
  const t = refCalloutText({ service: 'users-svc', ingress: 'in.getPosture', bindKey: 'http:GET users-svc/users/{id}/posture', source: 'prod' });
  assert.match(t, /^The other side of this call is a reference: users-svc · GET users-svc\/users\/\{id\}\/posture lives in prod\./);
  assert.match(t, /Your edit changes the call only, not what users-svc does with it\.$/);
});

test('links: http(s) only, an empty label takes the host; the group needs a server with links', () => {
  assert.deepEqual(toLink('', ' https://wiki.example.com/x ', 'f'), { label: 'wiki.example.com', url: 'https://wiki.example.com/x' });
  assert.equal(toLink('A', '', 'f'), null);
  assert.throws(() => toLink('A', 'javascript:alert(1)', 'links.main'), (e: any) => e.field === 'links.main');
  assert.equal(atLeast('0.25.1', '0.25.3'), true);
  assert.equal(atLeast('0.25.1', '0.24.1'), false);
  assert.equal(atLeast('0.25.1', '0.26.0'), true);
  assert.equal(atLeast('0.25.1', ''), false, 'an unknown version reads as no');
});

test('the Import panel counts come from the preview, never a fixed number', () => {
  const p = { anchor: 'ing:users-svc/in.getPosture', level: 'endpoint', total: 2, counts: { dtos: 0, messages: 0, channels: 0, bindings: 0 }, summary: { handler: 'get_posture', inside: 1, calls: [{ anchor: 'egr:users-svc/out.v', label: 'http:POST auth-svc/verify' }], stores: [{ key: 'postgres:users-db/users', access: 'read' }] } };
  const rows = comesAlong(p);
  assert.deepEqual(rows.map((r: any) => r[0]), ['Handler', 'Calls it makes', 'Stores']);
  assert.match(rows[0][2], /1 function it calls inside users-svc/);
  assert.equal(comesAlong({ ...p, level: 'component', counts: { headers: 1, ingress: 3, egress: 2 } })[0][0], 'Component');
});

test('Review changes names a flow-text op "Flow text: <name>"', () => {
  assert.equal(itemLabel({ anchor: 'flow:a/in.x', label: 'in.x' }, new Map([['a/in.x', 'Agent connects']])), 'Flow text: Agent connects');
  assert.equal(itemLabel({ anchor: 'flow:a/in.x', label: 'in.x' }), 'Flow text: in.x');
  assert.equal(itemLabel({ anchor: 'svc:a', label: 'a' }), 'a');
});
