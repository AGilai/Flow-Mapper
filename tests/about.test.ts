// `about` (0.30.2, #68): Markdown-lite rendering and the sanitizer on hostile text; the field on a component header (schema, design edit,
// diff) and on a subsystem (edit, apply, settings, copy, plan); MCP parity.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign, sampleManifests } from './helpers.ts';
import { aboutHtml, aboutProblem, ABOUT_MAX } from '../core/markdown-lite.ts';

test('aboutHtml: headings, emphasis, lists, code and https links; no HTML, no javascript: links', () => {
  const html = aboutHtml('## Capabilities\nSome **bold**, *it*, ~~gone~~ and `a<b`.\n- one\n- two\n\n1. first\n2. second\n\n[ok](https://example.com/a?x=1&y=2)');
  assert.match(html, /^<p><strong>Capabilities<\/strong><\/p><p>Some <strong>bold<\/strong>, <em>it<\/em>, <s>gone<\/s> and <code>a&lt;b<\/code>\.<\/p>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul><ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a\?x=1&amp;y=2"/);
  const bad = aboutHtml('[x](javascript:alert(1)) <script>alert(1)</script> <img src=x onerror=alert(1)> [y](data:text/html,hi) <b onclick="x()">b</b>');
  assert.ok(!/<script|<img|<a |<b /i.test(bad), bad);
  assert.ok(!/href=/i.test(bad), 'no unsafe link survives as a link');
  assert.equal(aboutHtml(''), ''); assert.equal(aboutHtml(5), '');
});

test('aboutProblem: a string up to the limit', () => {
  assert.equal(aboutProblem(undefined), null); assert.equal(aboutProblem('x'.repeat(ABOUT_MAX)), null);
  assert.match(aboutProblem('x'.repeat(ABOUT_MAX + 1))!, /longer than/); assert.match(aboutProblem(5)!, /string/);
});

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());
const edit = (slug: string, e: object, env = 'hld') => app.call('POST', `/api/envs/${env}/drafts/${slug}/edits`, { edit: e, author: 'ana' });
const draft = async (name: string, env = 'hld') => (await app.call('POST', `/api/envs/${env}/drafts`, { name })).body.slug as string;
const subsOf = async (q = '') => (await app.call('GET', `/api/envs/hld/subsystems${q}`)).body.subsystems as any[];

test('the manifest schema takes about up to 20 000 characters and refuses more', async () => {
  const m = structuredClone(sampleManifests().find((x: any) => x.service.name === 'orders-svc'));
  m.version += 1; m.service.about = '## Capabilities\n- orders';
  { const r = await app.call('POST', '/api/ingest?dryRun=1', m); assert.equal(r.status, 200, JSON.stringify(r.body)); }
  m.service.about = 'x'.repeat(ABOUT_MAX + 1);
  assert.equal((await app.call('POST', '/api/ingest?dryRun=1', m)).status, 422);
  m.service.about = 5;
  assert.equal((await app.call('POST', '/api/ingest?dryRun=1', m)).status, 422);
});

test('component edit: about is set, shows in the draft read, is Changed in the diff, and is cleared by an empty text', async () => {
  const slug = await draft('c-about');
  const r = await edit(slug, { kind: 'component', name: 'users-svc', serviceKind: 'service', groupPath: 'platform', about: '## Owners\n- team **core**' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const v = (await app.call('GET', `/api/envs/hld/services/users-svc?draft=${slug}`)).body;
  assert.equal(v.service.about, '## Owners\n- team **core**');
  const ch = (await app.call('GET', `/api/envs/hld/drafts/${slug}/changes`)).body;
  assert.ok(ch.items.some((i: any) => i.anchor === 'svc:users-svc' && i.change === 'changed'), JSON.stringify(ch.items));
  const big = await edit(slug, { kind: 'component', name: 'users-svc', serviceKind: 'service', about: 'x'.repeat(ABOUT_MAX + 1) });
  assert.equal(big.status, 422);
  await edit(slug, { kind: 'component', name: 'users-svc', serviceKind: 'service', about: '' });
  assert.equal((await app.call('GET', `/api/envs/hld/services/users-svc?draft=${slug}`)).body.service.about, undefined);
});

test('subsystem edit: about is set, kept by a label change, applied into the environment, cleared by null; too long is refused', async () => {
  const slug = await draft('s-about');
  assert.equal((await edit(slug, { kind: 'subsystem', key: 'agent', about: '## Motivation\nClose to the user' })).status, 201);
  assert.equal((await edit(slug, { kind: 'subsystem', key: 'agent', label: 'Agents' })).status, 201);
  const d = (await subsOf(`?draft=${slug}`)).find((s) => s.key === 'agent');
  assert.equal(d.about, '## Motivation\nClose to the user'); assert.equal(d.label, 'Agents');
  assert.equal((await edit(slug, { kind: 'subsystem', key: 'agent', about: 'x'.repeat(ABOUT_MAX + 1) })).status, 422);
  assert.equal((await app.call('POST', `/api/envs/hld/drafts/${slug}/apply`, {})).status, 200);
  assert.equal((await subsOf()).find((s) => s.key === 'agent').about, '## Motivation\nClose to the user');
  const s2 = await draft('s-about-2');
  await edit(s2, { kind: 'subsystem', key: 'agent', about: null });
  assert.equal((await subsOf(`?draft=${s2}`)).find((s) => s.key === 'agent').about, undefined);
});

test('a settings list without about keeps it; with about it sets it (draft and MCP)', async () => {
  const slug = await draft('s-settings');
  await edit(slug, { kind: 'subsystem', key: 'platform', about: 'Platform text' });
  const r = await app.mcp('set_subsystem_settings', { env: 'hld', draft: slug, subsystems: [{ key: 'platform', label: 'Platform core' }, { key: 'agent', label: 'Agents', about: 'Agent text' }] });
  assert.equal(r.isError, false, r.text);
  const subs = (await app.mcp('get_subsystems', { env: 'hld', draft: slug })).json.subsystems;
  assert.equal(subs.find((s: any) => s.key === 'platform').about, 'Platform text');
  assert.equal(subs.find((s: any) => s.key === 'agent').about, 'Agent text');
});

test('create_env and a sealed PUT carry about on the groups; a PUT without it keeps it', async () => {
  const c = await app.mcp('create_env', { name: 'with-about', source: 'prod', mode: 'blank', groups: [{ key: 'core', label: 'Core', about: '## Owners\n- me' }] });
  assert.equal(c.isError, false, c.text);
  assert.equal((await app.call('GET', '/api/envs/with-about/subsystems')).body.subsystems[0].about, '## Owners\n- me');
  assert.equal((await app.call('POST', '/api/envs', { name: 'bad-about', source: 'prod', mode: 'blank', groups: [{ key: 'core', label: 'Core', about: 'x'.repeat(ABOUT_MAX + 1) }] })).status, 422);
  const put = await app.call('PUT', '/api/envs/prod/subsystems', { subsystems: [{ key: 'platform', label: 'Platform', about: 'Sealed text' }] });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal((await app.call('PUT', '/api/envs/prod/subsystems', { subsystems: [{ key: 'platform', label: 'Platform 2' }] })).body.subsystems[0].about, 'Sealed text');
  assert.equal((await app.call('PUT', '/api/envs/prod/subsystems', { subsystems: [{ key: 'platform', label: 'Platform 2', about: '' }] })).body.subsystems[0].about, undefined);
});

test('MCP edit_design takes about on a component and on a subsystem', async () => {
  const slug = await draft('mcp-about');
  const a = await app.mcp('edit_design', { env: 'hld', draft: slug, edit: { kind: 'component', name: 'auth-svc', serviceKind: 'service', about: 'MCP text' } });
  assert.equal(a.isError, false, a.text);
  const b = await app.mcp('edit_design', { env: 'hld', draft: slug, edit: { kind: 'subsystem', key: 'platform', about: 'MCP subsystem' } });
  assert.equal(b.isError, false, b.text);
  assert.equal((await app.mcp('get_service', { env: 'hld', draft: slug, service: 'auth-svc' })).json.service.about, 'MCP text');
});
