// Call notes (frame 28g): the anchor and the body (core/call-notes.ts), REST (put, versions, the listing the diagram's markers use), sanitizing, MCP, seed data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';
import { callAnchor, parseCallAnchor, isCallAnchor, serializeCall, parseCall, hasCall, callTooLong, CALL_MAX } from '../core/call-notes.ts';
import { loadNotes } from '../server/store/notes.ts';

test('the anchor: three parts, a pipe or a percent inside a part survives, never a step number', () => {
  const a = callAnchor('client', 'catalog-svc', 'GET /products/{id}/reviews');
  assert.equal(a, 'call:client|catalog-svc|GET /products/{id}/reviews');
  assert.deepEqual(parseCallAnchor(a), { from: 'client', to: 'catalog-svc', op: 'GET /products/{id}/reviews' });
  const odd = callAnchor('a|b', 'c%d', 'x | y');
  assert.deepEqual(parseCallAnchor(odd), { from: 'a|b', to: 'c%d', op: 'x | y' });
  for (const bad of ['call:', 'call:a|b', 'call:a||c', 'call:a|b|c|d', 'flow:a/b', 'env', 7, null]) assert.equal(isCallAnchor(bad), false, String(bad));
});

test('serialize and parse: fields round-trip, text is escaped, blanks are left out', () => {
  const n = { what: 'Reads <b>every</b> review.\nIndexed on productId.', contract: 'find({ productId }) → Review[] · unknown id → []', watch: { on: true, text: 'No limit & no paging' } };
  const html = serializeCall(n);
  assert.match(html, /^<h2>What it does<\/h2><p>Reads &lt;b&gt;every&lt;\/b&gt; review\.<\/p><p>Indexed on productId\.<\/p><h2>Contract<\/h2>/);
  assert.match(html, /<div data-callout="watch"><p>No limit &amp; no paging<\/p><\/div>$/);
  assert.deepEqual(parseCall(html), n);
  assert.equal(serializeCall({}), '');
  assert.equal(serializeCall({ what: 'x', watch: { on: false, text: 'ignored' } }), '<h2>What it does</h2><p>x</p>');
  assert.equal(hasCall(parseCall('')), false);
  assert.deepEqual(parseCall('<p>plain text</p>').what, 'plain text', 'a body not in the shape is all "What it does"');
});

test('limits', () => {
  assert.equal(callTooLong({ what: 'x'.repeat(CALL_MAX.what + 1), contract: '', watch: { on: false, text: '' } }), `what is longer than ${CALL_MAX.what} characters`);
  assert.equal(callTooLong({ what: 'ok', contract: '', watch: { on: true, text: 'w' } }), null);
});

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());
const A = callAnchor('api-gateway', 'orders-svc', 'POST /orders');
const put = (b: object, env = 'prod') => app.call('PUT', `/api/envs/${env}/notes`, { anchor: A, author: 'Ana', ...b });
const mcp = async (name: string, args: any) => { const r = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }); return { isError: r.body.result.isError as boolean, json: r.body.result.isError ? null : JSON.parse(r.body.result.content[0].text), text: r.body.result.content[0].text as string }; };

test('REST: a call anchor is read and written with versions, no flow is needed, the same text again changes nothing', async () => {
  const q = `/api/envs/prod/notes?anchor=${encodeURIComponent(A)}`;
  assert.equal((await app.call('GET', q)).body.version, 0);
  const body = serializeCall({ what: 'Creates the order.', contract: 'POST /orders → 201 Order · 409 duplicate', watch: { on: true, text: 'Not idempotent' } });
  const one = await put({ body, baseVersion: 0 });
  assert.equal(one.status, 200, JSON.stringify(one.body)); assert.equal(one.body.version, 1);
  assert.equal((await put({ body, baseVersion: 1 })).body.unchanged, true);
  const two = await put({ body: serializeCall({ what: 'Creates the order, once.' }), baseVersion: 1 });
  assert.equal(two.body.version, 2);
  assert.equal((await put({ body, baseVersion: 1 })).status, 409, 'a stale save is refused');
  assert.equal((await app.call('GET', q + '&version=1')).body.body, body);
  assert.equal((await put({ body: 'x'.repeat(CALL_MAX.what + 1), baseVersion: 2 })).status, 422);
  assert.equal((await app.call('GET', '/api/envs/prod/notes?anchor=call:broken')).status, 400);
});

test('the listing: call notes with content, newest version, not in the flows index; an emptied note is gone', async () => {
  const B = callAnchor('orders-svc', 'orders-db', 'insert orders');
  await app.call('PUT', '/api/envs/prod/notes', { anchor: B, author: 'Ana', body: serializeCall({ contract: 'insert(order)' }) });
  const calls = (await app.call('GET', '/api/envs/prod/notes/calls')).body;
  assert.deepEqual(Object.keys(calls).sort(), [A, B].sort());
  assert.equal(calls[A].version, 2); assert.equal(parseCall(calls[A].body).what, 'Creates the order, once.');
  assert.equal((await app.call('GET', '/api/envs/prod/notes/index')).body[A], undefined);
  await app.call('PUT', '/api/envs/prod/notes', { anchor: B, author: 'Ana', body: '' });
  assert.deepEqual(Object.keys((await app.call('GET', '/api/envs/prod/notes/calls')).body), [A]);
  assert.equal((await app.call('GET', '/api/envs/nope/notes/calls')).status, 404);
});

test('the body is sanitized as any note', async () => {
  const r = await app.call('PUT', '/api/envs/prod/notes', { anchor: callAnchor('x', 'y', 'z'), author: 'Ana', body: '<h2>What it does</h2><p onclick="x()">hi<script>alert(1)</script></p>' });
  assert.equal(r.body.body, '<h2>What it does</h2><p>hi</p>');
});

test('MCP: set_notes / get_notes with call; contract and watch; the answer carries the fields', async () => {
  const call = { from: 'client', to: 'catalog-svc', op: 'GET /products/{id}/reviews' };
  const s = await mcp('set_notes', { env: 'prod', call, body: 'Public entry.', contract: 'GET /products/{id}/reviews → 200 Review[]', watch: 'The id is not validated here.' });
  assert.equal(s.isError, false, s.text); assert.equal(s.json.anchor, callAnchor(call.from, call.to, call.op));
  const g = await mcp('get_notes', { env: 'prod', call });
  assert.deepEqual(g.json.call, { what: 'Public entry.', contract: 'GET /products/{id}/reviews → 200 Review[]', watch: { on: true, text: 'The id is not validated here.' } });
  assert.equal((await mcp('get_notes', { env: 'prod', call: { from: 'a' } })).isError, true);
  assert.equal((await mcp('get_notes', { env: 'prod', call, doc: 'env' })).isError, true);
});

test('seed data: a sample call note loads once', () => {
  const ctx = app.ctx as any;
  const item = { call: { from: 'a', to: 'b', op: 'op', what: 'W', contract: 'C', watch: 'X' }, author: 'Seed' };
  const g = ctx.graph('prod');
  assert.equal(loadNotes(ctx.db, g, 'prod', [item]), 1);
  assert.equal(loadNotes(ctx.db, g, 'prod', [item]), 0);
});

test('docSummary: the Purpose paragraph of a flow doc, else its first paragraph, never a callout or a list', async () => {
  const { docSummary } = await import('../core/notes.ts');
  assert.equal(docSummary('<h2>Purpose</h2><p>Returns the reviews of one product.</p><p>More.</p><h2>How</h2><p>x</p>'), 'Returns the reviews of one product.');
  assert.equal(docSummary('<h2>How it works</h2><p>First.</p><h2>Purpose</h2><p>Why.</p>'), 'Why.');
  assert.equal(docSummary('<div data-callout="watch"><p>careful</p></div><h2>Decisions</h2><ul><li>a</li></ul><p>Plain</p>'), 'Plain');
  assert.equal(docSummary('<h2>Purpose</h2><p><br></p>'), '');
  assert.equal(docSummary(''), '');
});
