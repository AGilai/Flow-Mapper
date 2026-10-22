// Mermaid through REST and MCP (0.27.4): export (golden texts, every environment), preview, import into a draft, matching and create-new,
// idempotent re-import, the round trip into a blank design, undo by batch (409 when later ops depend on it), sealed refusals.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDesign } from './helpers.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => {
  app = await startDesign();
  assert.equal((await app.call('POST', '/api/envs', { name: 'blank', source: 'prod', mode: 'blank', groups: [{ key: 'platform', label: 'Platform' }] })).status, 201);
});
after(() => app.close());

const open = async (name: string, env = 'hld') => (await app.call('POST', `/api/envs/${env}/drafts`, { name })).body.slug as string;
const D = (env: string, slug: string) => `/api/envs/${env}/drafts/${slug}`;
const preview = (slug: string, body: object, env = 'hld') => app.call('POST', `${D(env, slug)}/mermaid/preview`, body);
const imp = (slug: string, body: object, env = 'hld') => app.call('POST', `${D(env, slug)}/mermaid`, body);
const exp = (env: string, service: string, ingress: string, draft = '') => app.call('GET', `/api/envs/${env}/flows/mermaid?service=${service}&ingress=${ingress}${draft ? `&draft=${draft}` : ''}`);
const ops = async (env: string, slug: string) => (await app.call('GET', D(env, slug))).body.ops as any[];

const FIXTURES = join(import.meta.dirname, 'fixtures/mermaid');
test('golden exports: a sync flow with stores, an async fan-out, a short one (UPDATE_GOLDEN=1 rewrites them)', async () => {
  mkdirSync(FIXTURES, { recursive: true });
  for (const [file, service, ingress] of [['users-posture', 'users-svc', 'in.getPosture'], ['create-order', 'api-gateway', 'in.createOrder'], ['orders-remove', 'orders-svc', 'in.remove']]) {
    const r = await exp('prod', service, ingress), path = join(FIXTURES, `${file}.mmd`);
    assert.equal(r.status, 200); assert.equal(typeof r.body, 'string');
    if (process.env.UPDATE_GOLDEN || !existsSync(path)) writeFileSync(path, r.body);
    assert.equal(r.body, readFileSync(path, 'utf8'), `${file}: the export changed (run with UPDATE_GOLDEN=1 if that is intended)`);
  }
});

test('export: text/plain, a sealed environment too, the flow name and a step note of a design as its draft leaves it; errors', async () => {
  const res = await fetch(`${app.base}/api/envs/prod/flows/mermaid?service=orders-svc&ingress=in.remove`);
  assert.match(res.headers.get('content-type') ?? '', /^text\/plain/);
  assert.match(await res.text(), /^%% Flow: orders-svc · in\.remove\nsequenceDiagram\n/);
  assert.equal((await exp('prod', 'orders-svc', 'nope')).status, 404);
  assert.equal((await app.call('GET', '/api/envs/prod/flows/mermaid?service=orders-svc')).status, 400);
  assert.equal((await exp('prod', 'orders-svc', 'in.remove', 'nodraft')).status, 404);
});

const TEXT = ['sequenceDiagram', 'title Agent connects', 'actor Agent', 'participant U as users svc', 'participant A as AuthService', 'participant PE as policy-engine', 'participant R as risk-scorer',
  'Agent->>U: GET /users/{id}/posture: asks for the posture', 'U->>A: POST /verify', 'A-->>U: ok', 'Note over U,A: verifies the token', 'U->>PE: Evaluate', 'alt allowed', 'PE-)R: Score: how risky', 'end'].join('\n');

test('preview: matches, creates, counts and warnings, and it writes nothing', async () => {
  const d = await open('mm-1');
  const r = await preview(d, { text: TEXT });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const how = Object.fromEntries(r.body.participants.map((p: any) => [p.id, [p.how, p.match]]));
  assert.deepEqual(how, { Agent: ['actor', null], U: ['normalized', 'users-svc'], A: ['normalized', 'auth-svc'], PE: ['none', null], R: ['none', null] });
  assert.deepEqual(r.body.creates, ['policy-engine', 'risk-scorer']);
  assert.equal(r.body.matches.Agent.client, true); assert.deepEqual(r.body.matches.PE, { create: true, name: 'policy-engine' });
  assert.equal(r.body.counts.components, 2); assert.equal(r.body.counts.calls, 3); assert.equal(r.body.title, 'Agent connects');
  assert.ok(r.body.warnings.some((w: any) => /no function in this design/.test(w.text)), 'the posture endpoint is a reference: its handler is not here');
  assert.ok(r.body.undecided.includes('Evaluate') && r.body.undecided.includes('Score'));
  assert.equal((await ops('hld', d)).length, 0);
});

test('import: one batch of ops, the flow is there with its name, notes, http and undecided endpoints; re-import adds nothing', async () => {
  const d = await open('mm-2');
  const r = await imp(d, { text: TEXT, groupPath: 'platform', author: 'tester' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.batch, /^[0-9a-f]{8}$/); assert.deepEqual(r.body.flow.service, 'users-svc');
  const stored = await ops('hld', d);
  assert.equal(stored.length, r.body.added);
  assert.ok(stored.every((o) => o.origin?.kind === 'mermaid' && o.origin.batch === r.body.batch && o.author === 'tester'));
  const t = (await app.call('GET', `/api/envs/hld/trace?detail=full&service=users-svc&ingress=${r.body.flow.ingress}&choose=*:both&draft=${d}`)).body;
  assert.equal(t.start.name, 'Agent connects');
  const calls = t.messages.filter((m: any) => m.kind === 'egress').map((m: any) => `${m.from}>${m.to}|${m.note ?? ''}`);
  assert.ok(calls.some((c: string) => c.startsWith('svc:users-svc>svc:auth-svc')), JSON.stringify(calls));
  assert.ok(t.messages.some((m: any) => m.kind === 'leaf' && m.label === 'verifies the token' && m.over?.join() === 'users-svc,auth-svc'), 'the note is a step spanning both');
  assert.ok(t.messages.some((m: any) => m.kind === 'egress' && m.to === 'svc:auth-svc' && m.returns?.label === 'ok'), 'the return is the response of the call');
  assert.ok(calls.some((c: string) => c.startsWith('svc:users-svc>svc:policy-engine')));
  assert.ok(calls.some((c: string) => c.endsWith('|how risky')), JSON.stringify(calls));
  assert.ok(t.messages.some((m: any) => m.note === 'how risky' && m.alt?.condition === 'allowed'), 'the alt is a group of the step');
  const header = stored.find((o) => o.anchor === 'svc:policy-engine');
  assert.equal(header.data.groupPath, 'platform'); assert.equal(header.data.kind, 'service');
  const again = await imp(d, { text: TEXT, groupPath: 'platform' });
  assert.equal(again.status, 201);
  assert.deepEqual([again.body.batch, again.body.added], [null, 0], 'nothing new: no batch');
  assert.deepEqual(again.body.counts, { components: 0, endpoints: 0, calls: 0, notes: 0, reused: 4 });
  assert.equal((await ops('hld', d)).length, stored.length);
  // a stronger text over it adds only the new call
  const more = await imp(d, { text: TEXT + '\nU->>A: POST /refresh', groupPath: 'platform' });
  assert.equal(more.body.counts.calls, 1); assert.equal(more.body.counts.endpoints, 1);
});

test('matches: a component name, create with a name, skip, fromSource (one level, same batch); bad input', async () => {
  const d = await open('mm-3');
  const text = ['sequenceDiagram', 'actor Agent', 'participant S as orders-svc', 'participant DB as orders-db.orders', 'participant X as Auth', 'Agent->>S: POST /orders', 'S->>DB: insertOne', 'S->>X: POST /verify'].join('\n');
  const p = (await preview(d, { text })).body;
  assert.deepEqual([p.participants[1].how, p.participants[1].source], ['in-prod', 'orders-svc']);
  assert.deepEqual(p.matches.S, { create: true, name: 'orders-svc' }, 'a name found only in prod is created by default');
  const by = (await preview(d, { text, matches: { S: { fromSource: true }, X: 'auth-svc' } })).body;
  assert.deepEqual(by.imports.map((i: any) => i.component), ['orders-svc']); assert.ok(by.imports[0].total > 3);
  assert.ok(by.warnings.some((w: any) => /'DB' is a channel or data store/.test(w.text)));
  const r = await imp(d, { text, matches: { S: { fromSource: true }, X: 'auth-svc' }, groupPath: 'platform' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const stored = await ops('hld', d);
  assert.ok(stored.some((o) => o.origin?.env === 'prod' && o.origin.batch === r.body.batch), 'imported ops carry the batch too');
  assert.equal((await app.call('DELETE', `${D('hld', d)}/mermaid/${r.body.batch}`)).body.removed, stored.length);
  assert.equal((await ops('hld', d)).length, 0);
  assert.equal((await preview(d, { text: '' })).status, 400);
  assert.equal((await preview(d, { text, matches: [] })).status, 400);
  assert.equal((await preview(d, { text, groupPath: 'nope' })).body.error.code, 'NO_GROUP');
  const none = await imp(d, { text: 'sequenceDiagram\nparticipant A' });
  assert.deepEqual([none.status, none.body.error.code], [422, 'NO_MESSAGES']);
});

/** The component participants and the calls between them (the entry client is just `client`): what a round trip must keep. */
const shape = (text: string) => {
  const names = new Map<string, string>(), parts: string[] = [];
  for (const l of text.split('\n')) {
    const p = /^(participant|actor) (\S+) as (.*)$/.exec(l);
    if (!p) continue;
    names.set(p[2], p[1] === 'actor' ? 'client' : p[3]);
    if (p[1] === 'participant' && !/[:{.]/.test(p[3])) parts.push(p[3]);
  }
  const ok = (n?: string) => n === 'client' || parts.includes(n ?? '');
  const calls = text.split('\n').flatMap((l) => { const m = /^(\S+?)(->>|-\))(\S+?): (.*)$/.exec(l); return m && ok(names.get(m[1])) && ok(names.get(m[3])) ? [`${names.get(m[1])}${m[2]}${names.get(m[3])}: ${m[4]}`] : []; });
  return { parts, calls };
};

test('round trip: export a flow, import it into a blank design, export again: the same components and calls', async () => {
  const first = (await exp('prod', 'users-svc', 'in.getPosture')).body;
  const d = await open('rt', 'blank');
  const r = await imp(d, { text: first, groupPath: 'platform' }, 'blank');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.creates, ['users-svc', 'auth-svc']);
  const second = (await exp('blank', r.body.flow.service, r.body.flow.ingress, d)).body;
  const a = shape(first), b = shape(second);
  assert.deepEqual(a.parts, ['users-svc', 'auth-svc']);
  assert.deepEqual(b.parts, a.parts); assert.deepEqual(b.calls, a.calls);
  assert.deepEqual(a.calls, ['client->>users-svc: GET /users/{id}/posture', 'users-svc->>auth-svc: POST /verify']);
  const again = await imp(d, { text: first, groupPath: 'platform' }, 'blank');
  assert.equal(again.body.added, 0, 'idempotent');
});

test('undo import: removes the batch; 409 DEPENDENT_OPS lists the later ops that touch it; 404 for an unknown batch', async () => {
  const d = await open('mm-undo');
  const r = await imp(d, { text: TEXT, groupPath: 'platform' });
  const batch = r.body.batch;
  const edit = await app.call('POST', `${D('hld', d)}/edits`, { edit: { kind: 'component', name: 'policy-engine', serviceKind: 'service', groupPath: 'platform', description: 'by hand' } });
  assert.equal(edit.status, 201, JSON.stringify(edit.body));
  const blocked = await app.call('DELETE', `${D('hld', d)}/mermaid/${batch}`);
  assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'DEPENDENT_OPS');
  assert.equal(blocked.body.error.details.blocking[0].anchor, 'svc:policy-engine');
  assert.equal((await ops('hld', d)).length, r.body.added + 1, 'nothing was removed');
  await app.call('DELETE', `${D('hld', d)}/ops/last`);   // the user undoes their own edit first
  const ok = await app.call('DELETE', `${D('hld', d)}/mermaid/${batch}`);
  assert.deepEqual([ok.status, ok.body.removed], [200, r.body.added]);
  assert.equal((await ops('hld', d)).length, 0);
  assert.equal((await app.call('DELETE', `${D('hld', d)}/mermaid/${batch}`)).status, 404);
  const changes = (await app.call('GET', `${D('hld', d)}/changes`)).body;
  assert.deepEqual(changes.counts, { added: 0, removed: 0, changed: 0 });
});

test('sealed environments: export works, preview / import / undo answer 409 ENV_SEALED', async () => {
  assert.equal((await exp('prod', 'orders-svc', 'in.remove')).status, 200);
  for (const [method, path] of [['POST', '/api/envs/prod/drafts/x/mermaid/preview'], ['POST', '/api/envs/prod/drafts/x/mermaid'], ['DELETE', '/api/envs/prod/drafts/x/mermaid/abcd1234']] as const) {
    const r = await app.call(method, path, { text: TEXT });
    assert.deepEqual([r.status, r.body.error.code], [409, 'ENV_SEALED'], path);
  }
});

test('MCP: export_mermaid; import_mermaid dry run returns the proposal, the real call writes as an AI edit', async () => {
  const x = await app.mcp('export_mermaid', { env: 'prod', service: 'orders-svc', ingress: 'in.remove' });
  assert.match(x.json.text, /^%% Flow: orders-svc/);
  const d = await open('mm-mcp');
  const dry = await app.mcp('import_mermaid', { env: 'hld', draft: d, text: TEXT, dryRun: true });
  assert.ok(!dry.isError, dry.text); assert.deepEqual(dry.json.creates, ['policy-engine', 'risk-scorer']);
  assert.equal((await ops('hld', d)).length, 0);
  const matches = { ...dry.json.matches, R: { create: true, name: 'scorer' } };
  const real = await app.mcp('import_mermaid', { env: 'hld', draft: d, text: TEXT, matches });
  assert.ok(!real.isError, real.text); assert.deepEqual(real.json.creates, ['policy-engine', 'scorer']);
  assert.ok((await ops('hld', d)).every((o) => o.byAi && o.author === 'assistant'));
  const sealed = await app.mcp('import_mermaid', { env: 'prod', draft: 'x', text: TEXT });
  assert.ok(sealed.isError); assert.match(sealed.text, /ENV_SEALED|sealed/);
});
