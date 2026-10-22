// 0.34.0: comments on a range of steps. REST (steps instead of step, validation), the thread's `steps`, MCP add_comment, Full copy, the Mermaid export
// (rect + Note), seed data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';
import { stepKeys } from '../core/description.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
let keys: string[];
before(async () => {
  app = await startDesign();
  const t = (await app.call('GET', '/api/envs/prod/trace?service=api-gateway&ingress=in.createOrder&scope=full&maxMessages=2000')).body;
  keys = stepKeys(t.messages);
});
after(() => app.close());

const A = 'flow:api-gateway/in.createOrder';
const post = (b: object, env = 'prod') => app.call('POST', `/api/envs/${env}/comments`, { anchor: A, author: 'Ana', body: '<p>range</p>', ...b });
const thread = async (env = 'prod') => (await app.call('GET', `/api/envs/${env}/comments?anchor=${encodeURIComponent(A)}`)).body;
const mcp = async (name: string, args: any) => { const r = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }); return { isError: r.body.result.isError as boolean, text: r.body.result.content[0].text as string }; };

test('a comment on a range: steps {from, to}, step null, returned on the thread; plain comments have steps null', async () => {
  const r = await post({ steps: { from: keys[1], to: keys[5] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.step, r.body.stepsFrom, r.body.stepsTo], [null, keys[1], keys[5]]);
  await post({ body: '<p>plain</p>' }); await post({ body: '<p>pin</p>', step: keys[2] });
  const t = await thread();
  assert.deepEqual(t.comments.map((c: any) => [c.step, c.steps]), [[null, { from: keys[1], to: keys[5] }], [null, null], [keys[2], null]]);
});

test('validation: both keys in the flow, from before to, 2 or more steps, not with step, not on a reply', async () => {
  const bad = async (b: object, re: RegExp) => { const r = await post(b); assert.equal(r.status, 400, JSON.stringify(r.body)); assert.match(r.body.error.message, re); };
  await bad({ steps: { from: keys[1], to: '#step:nope>nope|x|' } }, /not in the flow/);
  await bad({ steps: { from: keys[3], to: keys[3] } }, /2 or more steps/);
  await bad({ steps: { from: keys[5], to: keys[1] } }, /must come before/);
  await bad({ steps: { from: keys[1], to: keys[3] }, step: keys[2] }, /not both/);
  await bad({ steps: { from: keys[1] } }, /\{ from, to \}/);
  await bad({ steps: 'x' }, /\{ from, to \}/);
  const top = (await post({ body: '<p>top</p>' })).body;
  await bad({ steps: { from: keys[1], to: keys[3] }, parentId: top.id }, /reply has no step range/);
});

test('resolve keeps the range (readers hide the bracket); a Full copy carries it', async () => {
  const id = (await thread()).comments.find((c: any) => c.steps)?.id;
  assert.ok(id);
  const res = await app.call('PATCH', `/api/envs/prod/comments/${id}`, { actor: 'Ana', resolved: true });
  assert.equal(res.status, 200);
  assert.equal((await thread()).comments.find((c: any) => c.id === id).steps.from, keys[1]);
  assert.equal((await app.call('POST', '/api/envs', { name: 'rng', source: 'prod', mode: 'full' })).status, 201);
  const copied = (await thread('rng')).comments.find((c: any) => c.steps);
  assert.deepEqual(copied.steps, { from: keys[1], to: keys[5] });
  assert.equal(copied.resolved, true);
});

test('MCP add_comment takes steps; list_comments returns them', async () => {
  const a = await mcp('add_comment', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder', author: 'Bot', body: 'range from an agent', steps: { from: keys[2], to: keys[4] } });
  assert.equal(a.isError, false, a.text);
  const l = JSON.parse((await mcp('list_comments', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder' })).text);
  const mine = l.comments.find((c: any) => c.author === 'Bot');
  assert.deepEqual(mine.steps, { from: keys[2], to: keys[4] });
  const bad = await mcp('add_comment', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder', body: 'x', steps: { from: keys[4], to: keys[2] } });
  assert.equal(bad.isError, true);
});

test('Mermaid export: an open range comment is a rect around its messages with a Note; resolved and plain comments are not exported', async () => {
  const r = await mcp('export_mermaid', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder' });
  const text = JSON.parse(r.text).text as string;
  assert.match(text, /rect rgb\(253, 241, 184\)\n\s+Note over [A-Za-z_,-]+: range from an agent\n/);
  assert.equal((text.match(/^rect /gm) ?? []).length, 1, 'the resolved range and the plain comments are left out');
  const rect = text.slice(text.indexOf('rect '), text.indexOf('\nend', text.indexOf('rect ')) + 4);
  assert.ok(rect.split('\n').some((l) => /->>/.test(l)), 'messages sit inside the rect');
});

test('seed data: the sample range comment is on api-gateway / in.createOrder', async () => {
  const { loadComments } = await import('../server/store/comments.ts');
  const n = loadComments(app.ctx.db, app.ctx.graph('prod'), 'prod', [{ service: 'api-gateway', ingress: 'in.createOrder', author: 'Dana Levi', steps: { from: keys[5], to: keys[7] }, body: '<p>seeded range</p>' }]);
  assert.equal(n, 1);
  assert.deepEqual((await thread()).comments.find((c: any) => c.body === '<p>seeded range</p>').steps, { from: keys[5], to: keys[7] });
});
