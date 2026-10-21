// Flow names: an annotation in every environment (PUT / GET), a draft's flow op wins while the draft is read and is applied with it, the
// stored names survive a draft read (the reader falls back to the database), entry points and traces carry `name` / `summary`, MCP.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());

const put = (env: string, body: object) => app.call('PUT', `/api/envs/${env}/flow-names`, body);
const names = async (env: string, draft = '') => (await app.call('GET', `/api/envs/${env}/flow-names${draft ? `?draft=${draft}` : ''}`)).body as any[];
const entry = async (env: string, id: string, draft = '') => (await app.call('GET', `/api/envs/${env}/entry-points${draft ? `?draft=${draft}` : ''}`)).body.find((e: any) => e.id === id);
const E = { service: 'users-svc', ingress: 'in.getUser' };

test('PUT and GET on a sealed environment and on a design; \'\' removes; unknown environment 404, unknown ingress 422 NO_INGRESS', async () => {
  for (const env of ['prod', 'hld']) {
    const r = await put(env, { ...E, name: '  Look up a user  ', author: 'ana' });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(r.body, { ...E, name: 'Look up a user' });
    const l = await names(env);
    assert.deepEqual(l.map((x) => [x.service, x.ingress, x.name, x.author]), [['users-svc', 'in.getUser', 'Look up a user', 'ana']]);
    assert.ok(l[0].updatedAt);
  }
  assert.equal((await entry('prod', 'in.getUser')).name, 'Look up a user', 'entry points carry the name');
  assert.equal((await app.call('GET', '/api/envs/prod/trace?service=users-svc&ingress=in.getUser')).body.start.name, 'Look up a user', 'and so does the trace start');
  assert.equal((await put('prod', { ...E, name: '' })).body.name, null);
  assert.deepEqual(await names('prod'), []);
  assert.equal((await entry('prod', 'in.getUser')).name, undefined, 'no name: no field');
  await put('hld', { ...E, name: '' });
  assert.equal((await put('nope', { ...E, name: 'x' })).status, 404);
  const bad = await put('prod', { service: 'users-svc', ingress: 'in.zzz', name: 'x' });
  assert.deepEqual([bad.status, bad.body.error.code], [422, 'NO_INGRESS']);
  assert.equal((await put('prod', { ...E, name: 'x'.repeat(201) })).status, 422);
  assert.equal((await put('prod', { ...E })).status, 422);
});

test('entry points carry the summary: the first 140 characters of the human description', async () => {
  const text = `${'The flow looks a user up. '.repeat(10)}`;
  assert.equal((await app.call('PUT', '/api/envs/prod/descriptions', { ...E, text })).status, 200);
  const e = await entry('prod', 'in.getUser');
  assert.equal(e.summary, text.trim().slice(0, 140)); assert.equal(e.summary.length, 140);
  assert.equal((await entry('prod', 'in.getContact'))?.summary, undefined);
});

test('a draft: its flow op name wins while it is read, the stored names survive the draft read, apply writes the name (and \'\' clears it)', async () => {
  await put('hld', { service: 'users-svc', ingress: 'in.getContact', name: 'Stored name' });
  const slug = (await app.call('POST', '/api/envs/hld/drafts', { name: 'names' })).body.slug;
  await app.call('POST', `/api/envs/hld/drafts/${slug}/edits`, { edit: { kind: 'component', name: 'bystander', serviceKind: 'service', groupPath: 'platform' } });
  assert.equal((await entry('hld', 'in.getContact', slug)).name, 'Stored name', 'a draft read does not lose the names in the database');
  assert.equal((await app.call('GET', `/api/envs/hld/trace?service=users-svc&ingress=in.getContact&draft=${slug}`)).status, 409, 'it is a reference here: nothing to trace');
  assert.equal((await names('hld', slug)).length, 1);
  const r = await app.call('POST', `/api/envs/hld/drafts/${slug}/edits`, { edit: { kind: 'flow', service: 'users-svc', ingress: 'in.getContact', name: 'Draft name', description: 'Described in the draft' }, author: 'bo' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.ops.map((o: any) => o.anchor), ['flow:users-svc/in.getContact']);
  const e = await entry('hld', 'in.getContact', slug);
  assert.deepEqual([e.name, e.summary], ['Draft name', 'Described in the draft']);
  assert.equal((await entry('hld', 'in.getContact')).name, 'Stored name', 'without the draft: the stored name');
  assert.deepEqual((await names('hld', slug)).map((x) => [x.name, x.author]), [['Draft name', 'bo']]);
  assert.equal((await app.call('POST', `/api/envs/hld/drafts/${slug}/apply`, { by: 'bo' })).status, 200);
  assert.deepEqual((await names('hld')).map((x) => [x.name, x.author]), [['Draft name', 'bo']]);
  const s2 = (await app.call('POST', '/api/envs/hld/drafts', { name: 'clear' })).body.slug;
  await app.call('POST', `/api/envs/hld/drafts/${s2}/edits`, { edit: { kind: 'flow', service: 'users-svc', ingress: 'in.getContact', name: '' } });
  assert.deepEqual(await names('hld', s2), [], 'cleared in the draft');
  assert.equal((await entry('hld', 'in.getContact', s2)).name, undefined);
  assert.equal((await names('hld')).length, 1, 'still there until apply');
  await app.call('POST', `/api/envs/hld/drafts/${s2}/apply`, { by: 'bo' });
  assert.deepEqual(await names('hld'), []);
});

test('MCP get_flow_names / set_flow_name: direct, and with draft as a flow op recorded as an AI edit', async () => {
  const set = await app.mcp('set_flow_name', { env: 'prod', ...E, name: 'By the assistant' });
  assert.equal(set.isError, false, set.text); assert.equal(set.json.name, 'By the assistant');
  assert.deepEqual((await app.mcp('get_flow_names', { env: 'prod' })).json.map((x: any) => [x.name, x.author]), [['By the assistant', 'assistant']]);
  const slug = (await app.call('POST', '/api/envs/hld/drafts', { name: 'mcp-names' })).body.slug;
  const d = await app.mcp('set_flow_name', { env: 'hld', draft: slug, service: 'users-svc', ingress: 'in.getUser', name: 'Drafted' });
  assert.equal(d.isError, false, d.text);
  const op = (await app.call('GET', `/api/envs/hld/drafts/${slug}`)).body.ops[0];
  assert.deepEqual([op.anchor, op.data.name, op.byAi, op.author], ['flow:users-svc/in.getUser', 'Drafted', true, 'assistant']);
  assert.deepEqual((await app.mcp('get_flow_names', { env: 'hld', draft: slug })).json.map((x: any) => x.name), ['Drafted']);
  assert.deepEqual((await app.mcp('get_flow_names', { env: 'hld' })).json, [], 'the draft did not write the environment');
  assert.equal((await app.mcp('set_flow_name', { env: 'prod', service: 'users-svc', ingress: 'nope', name: 'x' })).isError, true);
});

test('Fix #52: in an applied design environment (no ?draft) the flow name is read everywhere the draft reads it: entry points, flows list, search, trace header, MCP', async () => {
  assert.equal((await app.call('POST', '/api/envs', { name: 'nm', source: 'prod', mode: 'blank', groups: [{ key: 'g', label: 'G' }] })).status, 201);
  const slug = (await app.call('POST', '/api/envs/nm/drafts', { name: 'k8s' })).body.slug;
  const ed = async (e: object) => assert.equal((await app.call('POST', `/api/envs/nm/drafts/${slug}/edits`, { edit: e })).status, 201);
  await ed({ kind: 'component', name: 'kubernetes', serviceKind: 'service', groupPath: 'g' });
  await ed({ kind: 'endpoint', service: 'kubernetes', id: 'in.pods', transport: 'http', bindKey: 'http:GET kubernetes/pods', entryPoint: true });
  await ed({ kind: 'flow', service: 'kubernetes', ingress: 'in.pods', name: 'Pods inventory', description: 'Lists the pods.' });
  assert.equal((await app.call('POST', `/api/envs/nm/drafts/${slug}/apply`, { by: 'bo' })).status, 200);
  const A = '/api/envs/nm', n = 'Pods inventory';
  assert.deepEqual((await app.call('GET', `${A}/entry-points`)).body.map((e: any) => [e.id, e.name, e.summary]), [['in.pods', n, 'Lists the pods.']]);
  assert.deepEqual((await app.call('GET', `${A}/flows/counts`)).body.map((c: any) => [c.ingress, c.name]), [['in.pods', n]]);
  const hits = (await app.call('GET', `${A}/search?q=pods%20inv`)).body;
  assert.deepEqual(hits.map((h: any) => [h.type, h.id, h.name]), [['ingress', 'in.pods', n]], 'the search finds a flow by its name and says it');
  assert.equal((await app.call('GET', `${A}/search?q=pods`)).body.find((h: any) => h.type === 'ingress').name, n);
  assert.equal((await app.call('GET', `${A}/trace?service=kubernetes&ingress=in.pods`)).body.start.name, n);
  assert.equal((await app.mcp('list_entry_points', { env: 'nm' })).json[0].name, n);
  assert.equal((await app.mcp('search', { env: 'nm', query: 'Pods inventory' })).json[0].name, n);
  assert.equal((await app.mcp('trace_flow', { env: 'nm', service: 'kubernetes', ingress: 'in.pods' })).json.start.name, n);
  assert.equal((await app.call('GET', '/api/envs/prod/search?q=getPosture')).body.find((h: any) => h.type === 'ingress').name, undefined, 'an unnamed flow: no field');
});
