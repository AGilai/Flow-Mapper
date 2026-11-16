// QA of frame 28 stages 2-3: the notes sanitizer against XSS payloads through the real PUT API, the 1,000,000 character cap, events that never carry a
// whole huge body, and the MCP access to the design doc (get_notes / set_notes with `doc: "env"`), with the cognito access rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';
import { startCognito } from './cognito-helpers.ts';
import { notesMd } from '../server/mcp/tools/notes.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());
const put = (b: object, env = 'prod') => app.call('PUT', `/api/envs/${env}/notes`, { anchor: 'env', author: 'Fuzz', ...b });
const mcpOf = (a: { call: (m: string, p: string, b?: unknown) => Promise<{ body: any }> }) => async (name: string, args: any) => { const r = await a.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }); return { isError: r.body.result.isError as boolean, json: r.body.result.isError ? null : JSON.parse(r.body.result.content[0].text), text: r.body.result.content[0].text as string }; };

const PAYLOADS = [
  '<pre data-mermaid>a</pre><script>alert(1)</script><pre data-mermaid>x</pre><script>b</script>',
  '<pre data-mermaid="1">graph TD</pre ><script>alert(1)</script>',
  '<pre data-mermaid="1"></pre><script>alert(1)</script>',
  '<pre data-mermaid="1"><img src=x onerror=alert(1)></pre>',
  '<div data-callout="risk" data-step="2"><div data-callout="key"><span data-ref="svc:a&quot; onmouseover=&quot;alert(1)">x</span></div></div>',
  '<span data-ref="svc:a" onclick="alert(1)" style="x">x</span>',
  '<span data-ref="javascript:alert(1)">x</span>',
  '<span data-ref="svc:<img src=x onerror=alert(1)>">x</span>',
  '<span data-ref="flow:a/b&#x22; onmouseover=alert(1)//">x</span>',
  '<svg onload=alert(1)><script>alert(1)</script></svg><math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<div data-callout="risk" style="x" onclick="alert(1)" data-step="1&quot;onclick=&quot;x">t</div>',
  '<div data-callout="risk" data-step="2" data-key="#step:a&quot; onclick=&quot;alert(1)">t</div>',
  '<span data-step="4" data-key="#step:svc/&quot;><script>alert(1)</script>">x</span>',
  '<a href="java&#x09;script:alert(1)">x</a><a href="&#106;avascript:alert(1)">y</a><a href="data:text/html,<script>1</script>">z</a>',
  '<h1 onclick=alert(1) style="a">t</h1><img src=x onerror=alert(1)><iframe src=javascript:alert(1)></iframe>',
  '<textarea><div data-callout="risk"></textarea><script>1</script>',
  '<!--<div data-callout="key">--><script>1</script>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<div data-callout="risk"><table><tr><td><div data-callout="watch" onclick=1>x</div></td></tr></table></div>',
];

/** What must never be in stored HTML: a tag that is not on the allowlist, an event handler or style attribute, a javascript: URL. */
function assertInert(html: string, label: string) {
  assert.doesNotMatch(html, /<(script|img|iframe|svg|math|style|object|embed|link|meta|textarea|noscript|form|input)/i, label);
  const tags = [...html.matchAll(/<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*>/gi)];
  const stripped = html.replace(/<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*>/gi, '').replace(/<\/[a-z0-9]+>/gi, '');
  assert.doesNotMatch(stripped, /</, `${label}: a stray '<' outside the tags I recognise: ${html}`);
  for (const [, , attrs] of tags) for (const m of attrs.replace(/="[^"]*"/g, "").matchAll(/\s+([a-z-]+)/g)) assert.match(m[1], /^(href|rel|target|colspan|rowspan|class|data-(step|key|key-to|ref|callout|mermaid))$/, `${label}: attribute ${m[1]}`);
  assert.doesNotMatch(html, /href="(?!https?:)/i, label);
}

test('XSS payloads through PUT: stored HTML is inert, canonical, and the same on read', async () => {
  for (const [i, p] of PAYLOADS.entries()) {
    const r = await put({ body: p });
    assert.equal(r.status, 200, `${i}: ${JSON.stringify(r.body).slice(0, 100)}`);
    assertInert(r.body.body, `payload ${i}`);
    const g = await app.call('GET', '/api/envs/prod/notes?anchor=env');
    assert.equal(g.body.body, r.body.body);
    const again = await put({ body: r.body.body }); // sanitize(sanitize(x)) === sanitize(x)
    assert.equal(again.body.body, r.body.body, `payload ${i} idempotent`);
  }
  // attribute values that are kept are escaped, never closing the attribute
  const q = (await put({ body: '<span data-ref="svc:a&quot; onmouseover=&quot;x">y</span><div data-callout="risk" data-key="#step:a&quot; onclick=&quot;x">t</div>' })).body.body;
  assert.doesNotMatch(q, /"[^"]*" on\w+=/);
});

test('a 2 MB body: the sanitizer returns quickly and the 1,000,000 character cap answers 422; nothing is stored', async () => {
  const before = (await app.call('GET', '/api/envs/prod/notes/history?anchor=env')).body.total;
  const t = Date.now(), m0 = process.memoryUsage().rss;
  const big = await put({ body: `<p>${'word '.repeat(400000)}</p>` });
  assert.equal(big.status, 422);
  const nest = await put({ body: '<div data-callout="risk">'.repeat(200000) + '<b>'.repeat(200000) }); // pathological nesting is cut, not an error
  assert.equal(nest.status, 200); assertInert(nest.body.body, 'nesting');
  assert.ok(Date.now() - t < 5000, `took ${Date.now() - t} ms`);
  assert.ok(process.memoryUsage().rss - m0 < 400e6, 'memory');
  assert.equal((await app.call('GET', '/api/envs/prod/notes/history?anchor=env')).body.total, before + 1, 'only the nesting save was stored');
});

test('a body just under the cap saves, and the event carries at most 300 characters of it', async () => {
  const last = (await app.call('GET', '/api/events/recent')).body.lastId;
  const r = await put({ body: `<p>${'ab '.repeat(300000)}</p>` });
  assert.equal(r.status, 200);
  const ev = (await app.call('GET', `/api/events/recent?types=notes.*&since=${last}`)).body.events;
  assert.equal(ev.length, 1);
  assert.ok(JSON.stringify(ev[0]).length < 1500, `the event is ${JSON.stringify(ev[0]).length} bytes`);
  assert.match(ev[0].summary, /the design doc/);
  const h = await app.call('GET', '/api/envs/prod/notes/history?anchor=env');
  assert.ok(JSON.stringify(h.body).length < 20000, 'history lists sizes, never bodies');
});

test('MCP: get_notes / set_notes take `doc: "env"`, with base_version, Markdown-lite (# is h1) and the document HTML', async () => {
  const mcp = mcpOf(app);
  const s = await mcp('set_notes', { env: 'prod', doc: 'env', body: '# Orders HLD\nWhy this exists.\n\n## Decisions\n- queue, not REST', author: 'Agent' });
  assert.equal(s.isError, false, s.text); assert.equal(s.json.anchor, 'env');
  const g = await mcp('get_notes', { env: 'prod', doc: 'env', history: true });
  assert.equal(g.json.html, '<h1>Orders HLD</h1><p>Why this exists.</p><h2>Decisions</h2><ul><li>queue, not REST</li></ul>');
  const v = g.json.version;
  const stale = await mcp('set_notes', { env: 'prod', doc: 'env', body: 'x', base_version: v - 1 });
  assert.equal(stale.isError, true); assert.match(stale.text, /STALE_NOTES/);
  const html = '<h1>D</h1><p>see <span data-ref="svc:users-svc">users-svc</span><script>x()</script></p><pre data-mermaid>graph TD\n A-->B</pre>';
  const ok = await mcp('set_notes', { env: 'prod', doc: 'env', body: html, base_version: v });
  assert.equal(ok.isError, false, ok.text);
  assert.equal((await mcp('get_notes', { env: 'prod', doc: 'env' })).json.html, '<h1>D</h1><p>see <span data-ref="svc:users-svc">users-svc</span></p><pre data-mermaid="1">graph TD\n A--&gt;B</pre>');
  // the same document over REST, the flow notes untouched
  assert.equal((await app.call('GET', '/api/envs/prod/notes?anchor=env')).body.version, v + 1);
  assert.equal((await mcp('get_notes', { env: 'prod', service: 'users-svc', ingress: 'in.getUser' })).json.version, 0);
  // a flow doc takes callouts
  const f = await mcp('set_notes', { env: 'prod', service: 'users-svc', ingress: 'in.getUser', body: '<p>x</p><div data-callout="risk" data-step="2"><p>careful</p></div>' });
  assert.equal(f.isError, false, f.text);
  assert.match((await mcp('get_notes', { env: 'prod', service: 'users-svc', ingress: 'in.getUser' })).json.html, /<div data-callout="risk" data-step="2"><p>careful<\/p><\/div>/);
  assert.equal(notesMd('<pre data-mermaid>x</pre>'), '<pre data-mermaid>x</pre>');
});

test('MCP: the design doc and a flow cannot be mixed, and one of them is required', async () => {
  const mcp = mcpOf(app);
  for (const args of [{ env: 'prod', doc: 'env', service: 'users-svc', ingress: 'in.getUser' }, { env: 'prod' }, { env: 'prod', service: 'users-svc' }, { env: 'prod', doc: 'flow' }]) {
    const g = await mcp('get_notes', args); assert.equal(g.isError, true, JSON.stringify(args));
    const s = await mcp('set_notes', { ...args, body: 'x' }); assert.equal(s.isError, true, JSON.stringify(args));
  }
});

test('cognito + MCP: a viewer cannot write the design doc, a stranger gets 404, events do not leak', async () => {
  const t = await startCognito();
  try {
    await t.seed();
    const owner = await t.signIn('owner@example.com', 'Olive'), viewer = await t.signIn('viewer@example.com', 'Vera'), other = await t.signIn('other@example.com', 'Otto'), editor = await t.signIn('editor@example.com', 'Eddie');
    assert.equal((await owner.call('POST', '/api/envs', { name: 'd-sec', source: 'prod', mode: 'components', behaviour: true, entryPoints: 'keep', groups: [], services: [{ name: 'users-svc' }] })).status, 201);
    await owner.call('PUT', '/api/envs/d-sec/access', { members: [{ userId: editor.id, role: 'editor' }, { userId: viewer.id, role: 'viewer' }] });
    const tok = async (p: typeof owner, n: string) => t.bearer((await t.token(p, n)).token);
    const [o, v, x, e] = [await tok(owner, 'o'), await tok(viewer, 'v'), await tok(other, 'x'), await tok(editor, 'e')];
    const set = (c: typeof o, env = 'd-sec') => mcpOf(c)('set_notes', { env, doc: 'env', body: '<h1>SECRET-HLD</h1>' });
    assert.equal((await set(o)).isError, false);
    assert.equal((await set(e)).isError, false, 'an editor writes');
    const dv = await set(v); assert.equal(dv.isError, true); assert.match(dv.text, /FORBIDDEN|read-only/i);
    const dx = await set(x); assert.equal(dx.isError, true); assert.match(dx.text, /not found|NOT_FOUND|404/i);
    assert.equal((await mcpOf(x)('get_notes', { env: 'd-sec', doc: 'env' })).isError, true);
    assert.match((await mcpOf(v)('get_notes', { env: 'd-sec', doc: 'env' })).json.html, /SECRET-HLD/);
    const ev = ((await other.call('GET', '/api/events/recent?limit=200')).body.events as any[]).filter((q) => q.env === 'd-sec');
    assert.deepEqual(ev, [], 'a stranger sees no event of the private design');
    assert.equal((await other.call('GET', '/api/envs/d-sec/notes/history?anchor=env')).status, 404);
    assert.equal((await other.call('GET', '/api/envs/d-sec/notes/index')).status, 404);
    assert.equal((await other.call('GET', '/api/envs/d-sec/notes/calls')).status, 404, 'call notes follow the same access rule');
    const cv = await mcpOf(v)('set_notes', { env: 'd-sec', call: { from: 'a', to: 'b', op: 'c' }, body: 'x' }); assert.equal(cv.isError, true, 'a viewer cannot write a call note'); assert.equal((await mcpOf(e)('set_notes', { env: 'd-sec', call: { from: 'a', to: 'b', op: 'c|d' }, body: '<img src=x onerror=1>hi' })).isError, false);
    assert.doesNotMatch((await mcpOf(o)('get_notes', { env: 'd-sec', call: { from: 'a', to: 'b', op: 'c|d' } })).json.html, /<img/); // text is escaped; the UI draws it with textContent
    assert.equal((await other.call('PUT', '/api/envs/d-sec/notes', { anchor: 'call:a|b|c', body: 'x', author: 'X' })).status, 404);
  } finally { await t.close(); }
});
