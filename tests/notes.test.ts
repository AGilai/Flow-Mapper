// 0.34.0: a flow's Notes. REST (get, put with versions, stale save, history, restore), sanitizing, events, Mentions page, Full copy, MCP get_notes / set_notes, seed data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';
import { loadNotes } from '../server/store/notes.ts';
import { notesMd } from '../server/mcp/tools/notes.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());

const A = 'flow:api-gateway/in.createOrder', B = 'flow:users-svc/in.getUser';
const get = async (anchor = A, q = '', env = 'prod') => (await app.call('GET', `/api/envs/${env}/notes?anchor=${encodeURIComponent(anchor)}${q}`));
const put = (b: object, env = 'prod', q = '') => app.call('PUT', `/api/envs/${env}/notes${q}`, { anchor: A, author: 'Ana', ...b });
const mcp = async (name: string, args: any) => { const r = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }); return { isError: r.body.result.isError as boolean, json: r.body.result.isError ? null : JSON.parse(r.body.result.content[0].text), text: r.body.result.content[0].text as string }; };

test('no notes yet: version 0 and an empty body; a flow has one document per environment', async () => {
  const r = await get();
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.version, r.body.body, r.body.author], [0, '', null]);
  assert.equal((await get('nonsense')).status, 400);
  assert.equal((await app.call('GET', '/api/envs/prod/notes')).status, 400);
  assert.equal((await get(A, '', 'nope')).status, 404);
});

test('every Save is a version; the latest is current; headings and step chips survive, the rest is sanitized', async () => {
  const one = await put({ body: '<h1>Purpose</h1><p onclick="x()">Hello <span data-step="2">step 2</span><script>alert(1)</script></p><h4>Sub</h4><p><span data-step="9-4">bad</span></p>', baseVersion: 0 });
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(one.body.version, 1);
  assert.equal(one.body.body, '<h2>Purpose</h2><p>Hello <span data-step="2">step 2</span></p><h3>Sub</h3><p>bad</p>');
  const two = await put({ body: '<h2>Purpose</h2><p>Second</p>', baseVersion: 1, author: 'Ben' });
  assert.equal(two.body.version, 2);
  assert.equal((await get()).body.body, '<h2>Purpose</h2><p>Second</p>');
  assert.equal((await get(A, '&version=1')).body.version, 1);
  assert.equal((await get(A, '&version=9')).status, 404);
  const same = await put({ body: '<h2>Purpose</h2><p>Second</p>', baseVersion: 2 });
  assert.equal(same.body.unchanged, true); assert.equal(same.body.version, 2, 'the same text again is not a version');
  assert.equal((await get(B)).body.version, 0, 'per flow');
});

test('a stale Save is a 409 STALE_NOTES with the current version; without baseVersion the writer skips the check', async () => {
  const r = await put({ body: '<p>mine</p>', baseVersion: 1 });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'STALE_NOTES');
  assert.equal(r.body.error.details.current.version, 2);
  assert.equal(r.body.error.details.current.author, 'Ben');
  const ok = await put({ body: '<p>unchecked</p>' });
  assert.equal(ok.body.version, 3);
});

test('history lists the latest versions newest first; restore writes a new version and deletes nothing', async () => {
  const h = (await app.call('GET', `/api/envs/prod/notes/history?anchor=${encodeURIComponent(A)}`)).body;
  assert.equal(h.current, 3); assert.equal(h.total, 3);
  assert.deepEqual(h.versions.map((v: any) => [v.version, v.author, v.restoredFrom]), [[3, 'Ana', null], [2, 'Ben', null], [1, 'Ana', null]]);
  const r = await app.call('POST', '/api/envs/prod/notes/restore', { anchor: A, version: 1, baseVersion: 3, author: 'Cy' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.version, 4); assert.equal(r.body.restoredFrom, 1);
  assert.equal((await get()).body.body, '<h2>Purpose</h2><p>Hello <span data-step="2">step 2</span></p><h3>Sub</h3><p>bad</p>');
  assert.equal((await get(A, '&version=3')).body.body, '<p>unchecked</p>', 'nothing was deleted');
  assert.equal((await app.call('POST', '/api/envs/prod/notes/restore', { anchor: A, version: 99 })).status, 404);
  assert.equal((await app.call('POST', '/api/envs/prod/notes/restore', { anchor: A, version: 1, baseVersion: 1, author: 'Cy' })).status, 409);
  const lim = (await app.call('GET', `/api/envs/prod/notes/history?anchor=${encodeURIComponent(A)}&limit=2`)).body;
  assert.deepEqual([lim.versions.length, lim.total], [2, 4]);
});

test('the flow must exist (a 404), the body must be text, and an empty body clears the notes (still a version)', async () => {
  assert.equal((await put({ body: 'x', anchor: 'flow:nobody/in.x' })).status, 404);
  assert.equal((await put({ body: 3 })).status, 400);
  assert.equal((await put({ body: '', anchor: B })).body.version, 1);
  const idx = (await app.call('GET', '/api/envs/prod/notes/index')).body;
  assert.equal(idx[A], 4); assert.equal(idx[B], undefined, 'an emptied document is not "has notes"');
});

test('events: notes.updated with the version and the first 300 characters', async () => {
  const last = (await app.call('GET', '/api/events/recent')).body.lastId;
  await put({ body: '<h2>Evt</h2><p>event text</p>', anchor: 'flow:orders-svc/in.touch' });
  const ev = (await app.call('GET', `/api/events/recent?types=notes.*&since=${last}`)).body.events;
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'notes.updated'); assert.equal(ev[0].env, 'prod');
  assert.deepEqual([ev[0].data.anchor, ev[0].data.version, ev[0].data.author], ['flow:orders-svc/in.touch', 1, 'Ana']);
  assert.match(ev[0].data.text, /Evt/);
});

test('mentions: a @{Name} in Notes is a token, and the Mentions page lists the flow ("in Notes"), never unread', async () => {
  await put({ body: '<p>ask @{Dana Levi} about it</p>', anchor: 'flow:payments-svc/in.legacyRefund' });
  const users = (await app.call('GET', '/api/users')).body;
  const dana = (users.users ?? users).find((u: any) => u.name === 'Dana Levi');
  assert.ok(dana);
  const m = (await app.call('GET', `/api/mentions?user=${dana.id}`)).body;
  assert.equal(m.notes.length, 1);
  assert.deepEqual([m.notes[0].env, m.notes[0].service, m.notes[0].ingress], ['prod', 'payments-svc', 'in.legacyRefund']);
  assert.match(m.notes[0].text, /@Dana Levi/);
  assert.equal((await app.call('GET', `/api/mentions?user=${dana.id}&unread=1`)).body.notes.length, 0);
  assert.equal(m.unread, 0);
});

test('a Full copy carries the notes with their history; Blank and Components copies do not', async () => {
  assert.equal((await app.call('POST', '/api/envs', { name: 'nfull', source: 'prod', mode: 'full' })).status, 201);
  const h = (await app.call('GET', `/api/envs/nfull/notes/history?anchor=${encodeURIComponent(A)}`)).body;
  assert.equal(h.total, 4);
  assert.equal((await get(A, '', 'nfull')).body.version, 4);
  assert.equal((await app.call('POST', '/api/envs', { name: 'ncomp', source: 'prod', mode: 'components', services: [{ name: 'api-gateway' }] })).status, 201);
  assert.equal((await get(A, '', 'ncomp')).body.version, 0);
  const w = await put({ body: '<p>design note</p>' }, 'nfull');
  assert.equal(w.body.version, 5, 'a design environment takes notes too');
});

test('MCP get_notes / set_notes: Markdown-lite headings, base_version, history', async () => {
  const s = await mcp('set_notes', { env: 'prod', service: 'users-svc', ingress: 'in.getUser', body: '# Purpose\nLooks up a user.\n\n## Decisions\n- cache 5 min\n- **no** pagination', base_version: 1 });
  assert.equal(s.isError, false, s.text);
  assert.equal(s.json.version, 2); assert.equal(s.json.author, 'Assistant');
  const g = await mcp('get_notes', { env: 'prod', service: 'users-svc', ingress: 'in.getUser', history: true });
  assert.equal(g.json.html, '<h2>Purpose</h2><p>Looks up a user.</p><h2>Decisions</h2><ul><li>cache 5 min</li><li><strong>no</strong> pagination</li></ul>');
  assert.match(g.json.text, /Looks up a user/);
  assert.equal(g.json.history.length, 2);
  const stale = await mcp('set_notes', { env: 'prod', service: 'users-svc', ingress: 'in.getUser', body: 'x', base_version: 1 });
  assert.equal(stale.isError, true); assert.match(stale.text, /STALE_NOTES|version 2/);
  assert.equal((await mcp('get_notes', { env: 'prod', service: 'users-svc', ingress: 'none' })).json.version, 0);
  assert.equal(notesMd('<p>html</p>'), '<p>html</p>');
});

test('seed data: loadNotes writes the older versions first, and seeding twice adds nothing', async () => {
  const g = app.ctx.graph('prod');
  const list = [{ service: 'users-svc', ingress: 'in.getPosture', author: 'Dana Levi', body: '<h2>A</h2><p>new</p>', versions: [{ author: 'Asaf G.', body: '<p>old</p>', ago: 60 }] }];
  assert.equal(loadNotes(app.ctx.db, g, 'prod', list), 2);
  assert.equal(loadNotes(app.ctx.db, g, 'prod', list), 0);
  assert.equal((await get('flow:users-svc/in.getPosture')).body.version, 2);
});
