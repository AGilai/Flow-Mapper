// References on the server: marks carry `refs`, a design trace and the entry points are decorated (`reference`, `partial`, `serviceKind`),
// a reference start is 409 NO_HANDLER with details, and a sealed environment's answers carry none of it. Data: the demo (sase-hld + hld-import),
// where pop-edge's third step calls users-svc's posture endpoint, a prod endpoint the design copied without its behaviour.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { SAMPLES, sampleManifests, startApp } from './helpers.ts';
import { seedEnvRecipes } from '../scripts/seed-envs.ts';
import { entryPoints, trace } from '../core/trace.ts';
import { decorateDesignTrace, refsReached } from '../core/flow-refs.ts';
import { refsFor } from '../server/refs.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
  seedEnvRecipes(app.ctx, join(SAMPLES, 'envs'));
});
after(() => app.close());

const E = '/api/envs/sase-hld', D = 'draft=hld-import', ENTRY = 'service=sase-agent&ingress=in.tunnel.open';
const get = async (p: string) => (await app.call('GET', p)).body;
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

test('the agent flow: the message into users-svc/in.getPosture is a reference from prod, partial.steps lists it', async () => {
  const t = await get(`${E}/trace?detail=full&${ENTRY}&${D}`);
  const ms: any[] = t.messages;
  const i = ms.findIndex((m) => m.target?.service === 'users-svc' && m.target?.ingress === 'in.getPosture');
  assert.ok(i > 0, 'the flow reaches the posture endpoint');
  assert.deepEqual(ms[i].reference, { anchor: 'ing:users-svc/in.getPosture', source: 'prod' });
  assert.equal(ms[i].kind, 'egress');
  assert.deepEqual(t.partial.steps, [{ message: i, anchor: 'ing:users-svc/in.getPosture', service: 'users-svc', ingress: 'in.getPosture', label: 'http:GET users-svc/users/{id}/posture', source: 'prod' }]);
  assert.equal(ms.filter((m) => m.reference).length, 1, 'the call into the design-made auth-svc endpoint and the undecided one are not references');
  assert.equal(t.participants.find((p: any) => p.service === 'sase-agent').serviceKind, 'client-app');
  assert.equal(t.participants.find((p: any) => p.service === 'users-svc').serviceKind, 'service');
  assert.equal(t.start.name, 'Agent connects to POP', 'the flow name of the draft is on start');
});

test('tracing a reference itself: 409 NO_HANDLER with reference: true, its source and its anchor', async () => {
  const r = await app.call('GET', `${E}/trace?detail=full&service=auth-svc&ingress=in.verify`);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'NO_HANDLER');
  assert.deepEqual(r.body.error.details, { source: 'prod', service: 'auth-svc', ingress: 'in.verify', reference: true, anchor: 'ing:auth-svc/in.verify' });
  assert.match(r.body.error.message, /reference: its behaviour lives in prod/);
  const own = await app.call('GET', `${E}/trace?detail=full&service=auth-svc&ingress=in.token.device&${D}`);
  assert.equal(own.status, 200, 'a design-made endpoint with a handler traces');
});

test('entry points: name and summary where the flow has them, reference on a reference entry, partial on a flow that reaches references', async () => {
  const withDraft: any[] = await get(`${E}/entry-points?${D}`);
  const agent = withDraft.find((e) => e.service === 'sase-agent' && e.id === 'in.tunnel.open');
  assert.equal(agent.name, 'Agent connects to POP'); assert.match(agent.summary, /^The agent opens a TLS tunnel/); assert.ok(agent.summary.length <= 140);
  assert.equal(agent.partial, 1); assert.equal(agent.reference, undefined);
  const plain: any[] = await get(`${E}/entry-points`);
  const ref = plain.find((e) => e.service === 'users-svc' && e.id === 'in.getPosture');
  assert.equal(ref.reference, true); assert.equal(ref.partial, undefined);
  assert.equal(plain.find((e) => e.service === 'users-svc' && e.id === 'in.getUser').reference, true, 'every copied endpoint is a reference in a Components copy');
});

test('refsReached equals tracing every entry point and counting the references on its partial steps (sase-hld + hld-import)', () => {
  const { g } = app.ctx.view('sase-hld', 'hld-import'), refs = refsFor(app.ctx, 'sase-hld', 'hld-import');
  const brute = new Map<string, number>();
  for (const e of entryPoints(g)) {
    const t = trace(g, { service: e.service, ingress: e.id });
    const d = t && decorateDesignTrace(t, refs, () => undefined);
    if (d?.partial) brute.set(`${e.service}:${e.id}`, d.partial.steps.length);
  }
  assert.deepEqual([...refsReached(g, refs)].sort(), [...brute].sort());
  assert.ok(brute.size >= 1);
});

test('marks carry refs: the copied endpoints, the component counts, and the origins of what came with its behaviour', async () => {
  const m = await get(`${E}/marks?${D}`);
  assert.equal(m.refs.endpoints['ing:users-svc/in.getPosture'].source, 'prod');
  assert.equal(m.refs.endpoints['ing:users-svc/in.getPosture'].bindKey, 'http:GET users-svc/users/{id}/posture');
  assert.equal(m.refs.components['svc:auth-svc'].refs, 1, 'auth-svc: in.verify is a reference, in.token.device is the design\'s own');
  assert.equal(m.refs.components['svc:auth-svc'].endpoints, 2);
  assert.equal(m.refs.endpoints['ing:auth-svc/in.token.device'], undefined);
  assert.equal((await get(`${E}/marks`)).refs.components['svc:auth-svc'].refs, 1);
  const prod = await get('/api/envs/prod/marks');
  assert.deepEqual(prod.refs, { endpoints: {}, components: {}, origins: {} }, 'a sealed environment has no references');
});

test('a sealed environment: trace and entry points are what core gives, nothing added', async () => {
  const g = app.ctx.graph('prod');
  const t = await get('/api/envs/prod/trace?detail=full&service=users-svc&ingress=in.getPosture');
  assert.deepEqual(t, json(trace(g, { service: 'users-svc', ingress: 'in.getPosture' }, { scope: 'full', maxDepth: 25, maxMessages: 500 })));
  for (const k of ['partial', 'reference']) assert.ok(!(k in t) && !t.messages.some((m: any) => k in m), k);
  assert.ok(t.participants.every((p: any) => !('serviceKind' in p)));
  assert.deepEqual(await get('/api/envs/prod/entry-points'), json(entryPoints(g)), 'no name, summary, reference or partial on a sealed environment');
});
