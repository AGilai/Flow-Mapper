// 0.33.0 open questions: the pure collector over components and subsystems, GET /api/envs/:env/open-questions (draft-aware) and the MCP tool list_open_questions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { collectQuestions } from '../core/open-questions.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startApp, startDesign, sampleManifests, SAMPLES, readSample } from './helpers.ts';
import { seedEnvRecipes } from '../scripts/seed-envs.ts';
import { copyEnv } from '../server/store/env-copy.ts';

const Q = (text: string) => `## Open questions\n- ${text}`;

test('subsystems first in the order given, then components by name; each item\'s questions in the order written, with index and line', () => {
  const out = collectQuestions(
    [{ key: 'platform', label: 'Platform', about: `## Capabilities\n- x\n\n${Q('Split Identity?')}` }, { key: 'agent', label: 'Agent', about: 'No questions here.' }, { key: 'net', label: 'Network', about: Q('One?') + '\n- Two?' }],
    [{ name: 'zeta', about: Q('Z?'), groupPath: 'platform/identity' }, { name: 'alpha', about: Q('A1?') + '\n* A2?', groupPath: 'agent' }, { name: 'mid' }, { name: 'plain', about: '## Owners\n- me' }],
  );
  assert.deepEqual(out.map((q) => [q.kind, q.id, q.index, q.text]), [
    ['subsystem', 'platform', 0, 'Split Identity?'], ['subsystem', 'net', 0, 'One?'], ['subsystem', 'net', 1, 'Two?'],
    ['component', 'alpha', 0, 'A1?'], ['component', 'alpha', 1, 'A2?'], ['component', 'zeta', 0, 'Z?'],
  ]);
  assert.deepEqual(out.filter((q) => q.kind === 'component').map((q) => q.subsystem), ['agent', 'agent', 'platform'], 'a component carries its subsystem (the top of its groupPath)');
  assert.equal(out[0].line, 4);
  assert.equal(out[0].label, 'Platform');
  assert.deepEqual(collectQuestions([], []), []);
});

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());
const get = (q = '') => app.call('GET', `/api/envs/hld/open-questions${q}`);
const edit = (slug: string, e: object) => app.call('POST', `/api/envs/hld/drafts/${slug}/edits`, { edit: e, author: 'ana' });

test('the REST list is the environment as it is, or as a draft would leave it', async () => {
  assert.deepEqual((await get()).body, { count: 0, questions: [] });
  const slug = (await app.call('POST', '/api/envs/hld/drafts', { name: 'qs' })).body.slug as string;
  assert.equal((await edit(slug, { kind: 'component', name: 'users-svc', serviceKind: 'service', about: `## Capabilities\n- x\n\n${Q('Is it capped?')}\n- Who signs?` })).status, 201);
  assert.equal((await edit(slug, { kind: 'subsystem', key: 'platform', about: Q('Split Identity?') })).status, 201);
  assert.equal((await get()).body.count, 0, 'the draft is not the environment');
  const r = await get(`?draft=${slug}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.count, 3);
  assert.deepEqual(r.body.questions.map((q: any) => `${q.kind}:${q.id}:${q.text}`), ['subsystem:platform:Split Identity?', 'component:users-svc:Is it capped?', 'component:users-svc:Who signs?']);
  assert.equal((await get('?draft=nope')).status, 404);
  assert.equal((await app.call('GET', '/api/envs/nope/open-questions')).status, 404);
});

test('MCP list_open_questions matches REST, takes a draft, and is read-only', async () => {
  const slug = (await app.call('POST', '/api/envs/hld/drafts', { name: 'mcp qs' })).body.slug as string;
  await edit(slug, { kind: 'component', name: 'auth-svc', serviceKind: 'service', about: Q('Rotate keys?') });
  const live = await app.mcp('list_open_questions', { env: 'hld' });
  assert.equal(live.isError, false);
  assert.deepEqual(live.json, (await get()).body);
  const d = await app.mcp('list_open_questions', { env: 'hld', draft: slug });
  assert.deepEqual(d.json, (await get(`?draft=${slug}`)).body);
  assert.equal(d.json.count, 1);
  assert.equal(d.json.questions[0].text, 'Rotate keys?');
  assert.equal((await app.mcp('list_open_questions', { env: 'hld', draft: 'nope' })).isError, true);
});

test('the sase-hld sample: the "pane-demo" draft brings questions and owners (names and a Confluence id become users); the environment itself has the Network question', async () => {
  const demo = await startApp();
  try {
    await demo.call('POST', '/api/ingest', { manifests: sampleManifests() });
    for (const f of ['prod']) { const { env, dtos } = readSample(`dtos/${f}.json`); await demo.call('POST', `/api/envs/${env}/dtos`, { dtos }); }
    const { drafts: _d, ...recipe } = JSON.parse(readFileSync(join(SAMPLES, 'envs/sase-hld.json'), 'utf8'));
    copyEnv(demo.ctx.db, recipe);
    seedEnvRecipes(demo.ctx, join(SAMPLES, 'envs'));
    const base = (await demo.call('GET', '/api/envs/sase-hld/open-questions')).body;
    assert.deepEqual(base.questions.map((q: any) => `${q.kind}:${q.id}`), ['subsystem:network']);
    const d = (await demo.call('GET', '/api/envs/sase-hld/open-questions?draft=pane-demo')).body;
    assert.deepEqual(d.questions.map((q: any) => `${q.kind}:${q.id}`), ['subsystem:network', 'subsystem:platform', 'subsystem:platform', 'component:auth-svc', 'component:auth-svc']);
    const users = (await demo.call('GET', '/api/users')).body.users, name = (id: string) => users.find((u: any) => u.id === id).name;
    const subs = (await demo.call('GET', '/api/envs/sase-hld/subsystems?draft=pane-demo')).body.subsystems;
    assert.deepEqual(subs.find((s: any) => s.key === 'network').owners.map(name), ['Noa Barak', 'Einat Schanin']);
    assert.deepEqual(users.find((u: any) => u.name === 'Einat Schanin').externalIds, [{ source: 'confluence', externalId: 'conf-user-77' }]);
    assert.deepEqual((await demo.call('GET', '/api/envs/sase-hld/services/auth-svc?draft=pane-demo')).body.service.owners.map(name), ['Noa Barak', 'Einat Schanin']);
    const einat = users.find((u: any) => u.name === 'Einat Schanin');
    assert.match(subs.find((s: any) => s.key === 'platform').about, new RegExp(`Ask @\\[${einat.id}\\] about boundaries`), '@{Einat Schanin} became a token');
  } finally { await demo.close(); }
});
