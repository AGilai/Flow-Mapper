// #59: an entry point with no handler (none named for the requested event) is an empty flow (entry participant, no steps,
// `noHandler: true`), not a 404. An unknown ingress is still 404; a handler id with no function keeps its 409 NO_HANDLER.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';
import { trace } from '../core/trace.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());

const Q = '/api/envs/prod/trace?service=inventory-svc&ingress=in.orderEvents';

test('an event the consumer lists no handler for: 200, the entry participant, no steps, noHandler', async () => {
  const r = await app.call('GET', `${Q}&event=Nope`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.noHandler, true);
  assert.deepEqual(r.body.messages, []);
  assert.equal(r.body.start.ingress, 'in.orderEvents');
  assert.equal(r.body.start.event, 'Nope');
  assert.ok(r.body.participants.some((p: any) => p.id === 'svc:inventory-svc'));
  assert.equal((await app.call('GET', `${Q}&event=Nope&scope=intra`)).status, 200);
  const ok = await app.call('GET', `${Q}&event=OrderPlaced`);
  assert.equal(ok.body.noHandler, undefined);
  assert.ok(ok.body.messages.length > 1, 'a handled event still traces');
});

test('it can be described', async () => {
  const put = await app.call('PUT', '/api/envs/prod/descriptions', { service: 'inventory-svc', ingress: 'in.orderEvents', text: 'nothing handles it', editedBy: 'me' });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const d = (await app.call('GET', '/api/envs/prod/descriptions?service=inventory-svc&ingress=in.orderEvents')).body;
  assert.equal(d.flow.human.text, 'nothing handles it');
});

test('MCP trace_flow answers it too; an unknown ingress is still 404', async () => {
  const r = await app.mcp('trace_flow', { env: 'prod', service: 'inventory-svc', ingress: 'in.orderEvents', event: 'Nope' });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.json.noHandler, true);
  assert.equal((await app.call('GET', '/api/envs/prod/trace?service=inventory-svc&ingress=in.nope')).status, 404);
  assert.equal(trace(app.ctx.graph('prod'), { service: 'inventory-svc', ingress: 'in.nope' }), null);
});

test('a copied endpoint whose handler function is missing keeps its 409 NO_HANDLER', async () => {
  const r = await app.call('GET', '/api/envs/hld/trace?service=users-svc&ingress=in.getUser');
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'NO_HANDLER');
});

test('a design-made endpoint whose handler function is missing is an empty flow; a copied one stays the 409 boundary', async () => {
  assert.equal((await app.call('POST', '/api/envs/hld/drafts', { name: 'nh', slug: 'nh' })).status, 201);
  const r = await app.call('POST', '/api/envs/hld/drafts/nh/ops', { ops: [{ op: 'upsert', anchor: 'ing:auth-svc/in.mine', data: { id: 'in.mine', transport: 'http', bindKey: 'http:GET auth-svc/mine', handler: 'not-yet', entryPoint: true } }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = await app.call('GET', '/api/envs/hld/trace?service=auth-svc&ingress=in.mine&draft=nh'); // a dangling handler is allowed in a draft, not in an applied environment
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(t.body.noHandler, true);
  assert.equal((await app.call('GET', '/api/envs/hld/trace?service=users-svc&ingress=in.getUser')).status, 409, 'copied from prod: still the boundary');
});
