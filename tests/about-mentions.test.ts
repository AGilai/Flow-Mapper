// 0.33.0 @mentions in an About: `@[userId]` in the about of a component or a subsystem counts on the Mentions page as "about of <item>" (REST `about`, MCP list_mentions),
// never as unread; the sanitizer keeps the token as text (so the pane can draw a chip).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, sampleManifests } from './helpers.ts';
import { aboutHtml } from '../core/markdown-lite.ts';
import { splitMentions, mentionIds } from '../core/mentions.ts';
import { mentionLine } from '../server/store/mentions-about.ts';

test('the token survives the Markdown-lite renderer as plain text, in a list, a paragraph and bold; the renderer finds them', () => {
  const html = aboutHtml('## Owners\n- Ask @[u_0a1b2c3d] first\n\nThen **@[u_00000001]** or @[u_00000002].');
  assert.match(html, /<li>Ask @\[u_0a1b2c3d\] first<\/li>/);
  assert.match(html, /<strong>@\[u_00000001\]<\/strong>/);
  assert.deepEqual(mentionIds(html), ['u_0a1b2c3d', 'u_00000001', 'u_00000002']);
  assert.deepEqual(splitMentions('Ask @[u_0a1b2c3d] first'), ['Ask ', { id: 'u_0a1b2c3d' }, ' first']);
  assert.ok(!/<a |<script/.test(aboutHtml('@[x](javascript:alert(1)) @[u_1]')), 'a token next to a hostile link stays text');
});

test('the line shown for an about mention: the Markdown marks are out, every token is a name', () => {
  const names = new Map([['u_1', { name: 'Dana Levi' }], ['u_2', { name: 'Ron' }]]);
  assert.equal(mentionLine('## Owners\n- Ask **@[u_1]** or @[u_2] about `format`\n- other', 'u_1', names), 'Ask @Dana Levi or @Ron about format');
  assert.equal(mentionLine('x @[u_9] y', 'u_9', names), 'x @unknown user y');
  assert.equal(mentionLine('nothing', 'u_1', names), '');
});

let app: Awaited<ReturnType<typeof startApp>>;
let dana: any, ron: any;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
  dana = (await app.call('POST', '/api/users', { name: 'Dana Levi' })).body;
  ron = (await app.call('POST', '/api/users', { name: 'Ron' })).body;
});
after(() => app.close());

test('an about that mentions a user is listed with its item and line; other users and other texts are not; it is never unread', async () => {
  const m = structuredClone(sampleManifests().find((x: any) => x.service.name === 'orders-svc'));
  m.version += 1; m.service.about = `## Owners\n- Ask @[${dana.id}] for format changes\n- or @[${ron.id}]`;
  assert.equal((await app.call('POST', '/api/ingest', m)).status, 201);
  assert.equal((await app.call('PUT', '/api/envs/prod/subsystems', { subsystems: [{ key: 'core', label: 'Core', about: `Led by @[${dana.id}].` }] })).status, 200);
  const r = (await app.call('GET', `/api/mentions?user=${dana.id}`)).body;
  assert.deepEqual(r.about.map((a: any) => [a.env, a.kind, a.id, a.label]), [['prod', 'component', 'orders-svc', 'orders-svc'], ['prod', 'subsystem', 'core', 'Core']]);
  assert.equal(r.about[0].text, 'Ask @Dana Levi for format changes');
  assert.equal(r.about[1].text, 'Led by @Dana Levi.');
  assert.equal(r.unread, 0, 'about mentions are not unread');
  assert.deepEqual(r.mentions, []);
  const ronOnly = (await app.call('GET', `/api/mentions?user=${ron.id}`)).body.about;
  assert.deepEqual(ronOnly.map((a: any) => a.id), ['orders-svc']);
  assert.deepEqual((await app.call('GET', `/api/mentions?user=${dana.id}&unread=1`)).body.about, []);
  assert.deepEqual((await app.call('GET', `/api/mentions?user=${dana.id}&env=other`)).body.about, []);
  const x = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_mentions', arguments: { user: 'Dana Levi' } } });
  assert.deepEqual(JSON.parse(x.body.result.content[0].text).about, r.about);
});

test('rename shows in the line; a text without the token is not listed', async () => {
  assert.equal((await app.call('PATCH', `/api/users/${dana.id}`, { name: 'Dana Cohen' })).status, 200);
  assert.equal((await app.call('GET', `/api/mentions?user=${dana.id}`)).body.about[0].text, 'Ask @Dana Cohen for format changes');
  const none = await app.call('POST', '/api/users', { name: 'Nobody Mentioned' });
  assert.deepEqual((await app.call('GET', `/api/mentions?user=${none.body.id}`)).body.about, []);
});

test('@{Display Name} in an about is written as the token when the user exists (name or alias); an unknown name stays plain text and creates nobody', async () => {
  const before = (await app.call('GET', '/api/users')).body.users.length;
  const m = structuredClone(sampleManifests().find((x: any) => x.service.name === 'orders-svc'));
  m.version = (await app.call('GET', '/api/envs/prod/services/orders-svc')).body.service.version + 1;
  m.service.about = '## Owners\n- @{Ron} and @{ron } and @{Nobody Known}';
  assert.equal((await app.call('POST', '/api/ingest', m)).status, 201);
  const about = (await app.call('GET', '/api/envs/prod/services/orders-svc')).body.service.about as string;
  assert.equal(about, `## Owners\n- @[${ron.id}] and @[${ron.id}] and @Nobody Known`);
  assert.equal((await app.call('GET', '/api/users')).body.users.length, before);
  // a design edit and a plan
  const e = await app.call('POST', '/api/envs', { name: 'named', source: 'prod', mode: 'blank', groups: [{ key: 'core', label: 'Core', about: 'Led by @{Ron}' }] });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal((await app.call('GET', '/api/envs/named/subsystems')).body.subsystems[0].about, `Led by @[${ron.id}]`);
  const slug = (await app.call('POST', '/api/envs/named/drafts', { name: 'n' })).body.slug as string;
  assert.equal((await app.call('POST', `/api/envs/named/drafts/${slug}/edits`, { edit: { kind: 'subsystem', key: 'core', about: 'Ask @{Dana Cohen}' }, author: 'a' })).status, 201);
  assert.equal((await app.call('GET', `/api/envs/named/subsystems?draft=${slug}`)).body.subsystems[0].about, `Ask @[${dana.id}]`);
});
