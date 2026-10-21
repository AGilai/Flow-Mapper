// #54 links ({main?, sub?}) on a component header, endpoint, function and flow, and #49 `runtime` on a component:
// accepted in manifests, plans and design edits, validated, returned by the service view, entry points, trace start and flow names.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readSample, startDesign } from './helpers.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());

const L = { main: { label: 'Runbook', url: 'https://wiki.example.com/users' }, sub: [{ label: 'Dashboard', url: 'http://grafana.example.com/d/1' }] };
const D = '/api/envs/hld/drafts';
const edit = (slug: string, e: object) => app.call('POST', `${D}/${slug}/edits`, { edit: e, author: 'ana' });
const view = async (q = '') => (await app.call('GET', `/api/envs/prod/services/users-svc${q}`)).body;

test('manifest: links on the header, a function and an endpoint come back from the service view; bad links are 422', async () => {
  const m = readSample('users-svc.json');
  m.version += 1; m.kind = 'full';
  m.service.links = L; m.functions[0].links = L; m.ingress[0].links = { main: L.main };
  const r = await app.call('POST', '/api/ingest', m);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const v = await view();
  assert.deepEqual(v.service.links, L);
  assert.deepEqual(v.functions.find((f: any) => f.id === m.functions[0].id).links, L);
  assert.deepEqual(v.ingress.find((i: any) => i.id === m.ingress[0].id).links, { main: L.main });
  let n = 0;
  const bad = async (links: unknown) => { const x = structuredClone(m); x.version += ++n; x.service.links = links; return (await app.call('POST', '/api/ingest', x)).status; };
  assert.equal(await bad({ main: { label: 'x', url: 'ftp://h/x' } }), 422, 'http(s) only');
  assert.equal(await bad({ main: { label: 'x'.repeat(121), url: 'https://h/x' } }), 422, 'label at most 120');
  assert.equal(await bad({ sub: Array.from({ length: 21 }, () => L.main) }), 422, 'at most 20 sub links');
  assert.equal(await bad({ sub: Array.from({ length: 20 }, () => L.main) }), 201);
  assert.equal(await bad({ main: { label: 'x', url: 'https://h/x', extra: 1 } }), 422);
  const rt = async (runtime: string) => { const x = structuredClone(m); x.version += ++n; x.service.details = { runtime }; return (await app.call('POST', '/api/ingest', x)).status; };
  assert.equal(await rt('k8s-job'), 201); assert.equal(await rt('vm'), 422, 'runtime is one of the k8s kinds');
});

test('design edits: component links and runtime, endpoint, function and flow links; reads return them', async () => {
  assert.equal((await app.call('POST', D, { name: 'Links', slug: 'links' })).status, 201);
  const ok = async (e: object) => { const r = await edit('links', e); assert.equal(r.status, 201, JSON.stringify(r.body)); };
  await ok({ kind: 'component', name: 'users-svc', serviceKind: 'service', links: L, runtime: 'k8s-deployment' });
  await ok({ kind: 'endpoint', service: 'users-svc', id: 'in.getUser', transport: 'http', links: { main: L.main } });
  await ok({ kind: 'function', service: 'users-svc', id: 'get_user', links: L });
  await ok({ kind: 'flow', service: 'users-svc', ingress: 'in.getUser', name: 'Get a user', links: L });
  const draft = async (p: string) => (await app.call('GET', `/api/envs/hld${p}${p.includes('?') ? '&' : '?'}draft=links`)).body;
  const sv = await draft('/services/users-svc');
  assert.deepEqual([sv.service.links, sv.service.details?.runtime], [L, 'k8s-deployment']);
  assert.deepEqual(sv.ingress.find((i: any) => i.id === 'in.getUser').links, { main: L.main });
  const ep = (await draft('/entry-points')).find((e: any) => e.id === 'in.getUser');
  assert.deepEqual([ep.links, ep.flowLinks], [{ main: L.main }, L]);
  assert.deepEqual((await draft('/trace?service=users-svc&ingress=in.getUser')).start.links, L);
  assert.deepEqual((await draft('/flow-names'))[0].links, L);
  assert.equal((await app.call('GET', '/api/envs/hld/flow-names')).body.length, 0, 'the draft wrote nothing yet');
  // errors
  assert.equal((await edit('links', { kind: 'component', name: 'users-svc', serviceKind: 'service', runtime: 'vm' })).body.error.details?.[0]?.field ?? 'runtime', 'runtime');
  assert.equal((await edit('links', { kind: 'component', name: 'users-svc', serviceKind: 'service', runtime: 'vm' })).status, 422);
  assert.equal((await edit('links', { kind: 'function', service: 'users-svc', id: 'get_user', links: { main: { label: 'x', url: 'javascript:alert(1)' } } })).status, 422);
  assert.equal((await edit('links', { kind: 'flow', service: 'users-svc', ingress: 'in.getUser', links: { sub: Array.from({ length: 21 }, () => L.main) } })).status, 422);
  // apply: stored in the environment
  assert.equal((await app.call('POST', `${D}/links/apply`, {})).status, 200);
  assert.deepEqual((await app.call('GET', '/api/envs/hld/flow-names')).body[0].links, L);
  assert.deepEqual((await app.call('GET', '/api/envs/hld/trace?service=users-svc&ingress=in.getUser')).body.start.links, L);
  const ep2 = ((await app.call('GET', '/api/envs/hld/entry-points')).body as any[]).find((e) => e.id === 'in.getUser');
  assert.deepEqual(ep2.flowLinks, L);
  // null clears
  assert.equal((await app.call('POST', D, { name: 'Clear', slug: 'clear' })).status, 201);
  assert.equal((await edit('clear', { kind: 'flow', service: 'users-svc', ingress: 'in.getUser', links: null })).status, 201);
  assert.equal((await app.call('POST', `${D}/clear/apply`, {})).status, 200);
  assert.equal((await app.call('GET', '/api/envs/hld/trace?service=users-svc&ingress=in.getUser')).body.start.links, undefined);
});

test('flow-names PUT takes links; a plan takes flow links and details.runtime', async () => {
  const put = await app.call('PUT', '/api/envs/hld/flow-names', { service: 'auth-svc', ingress: 'in.verify', name: 'Verify', links: L });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual((await app.call('GET', '/api/envs/hld/flow-names')).body.find((x: any) => x.service === 'auth-svc').links, L);
  assert.equal((await app.call('PUT', '/api/envs/hld/flow-names', { service: 'auth-svc', ingress: 'in.verify', name: 'Verify', links: { main: { label: 'x', url: 'nope' } } })).status, 422);
  assert.equal((await app.call('POST', D, { name: 'Plan', slug: 'plan' })).status, 201);
  const plan = (extra: object) => ({ planVersion: 1, planId: 'p', createdAt: '2026-10-21T12:00:00Z', createdBy: 'test', environment: { name: 'hld' }, flows: [{ entry: { service: 'auth-svc', ingress: 'in.verify' }, name: 'V', links: L, ...extra }] });
  const r = await app.call('POST', `${D}/plan/plan?dryRun=1`, plan({}));
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  const bad = await app.call('POST', `${D}/plan/plan`, plan({ links: { main: { label: 'x', url: 'ftp://x' } } }));
  assert.equal(bad.status, 422, JSON.stringify(bad.body));
});
