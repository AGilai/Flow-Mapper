// 0.71.0: a step note whose step key no message has any more ("detached") can be listed, moved and cleared; writing text to such a key stays refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { stepKey, stepLabelOf, HASH_TRACE } from '../core/description.ts';
import { sampleModel, sampleManifests, startApp } from './helpers.ts';

const T = trace(buildIndex(sampleModel()), { service: 'api-gateway', ingress: 'in.createOrder' }, HASH_TRACE)!;
const LIVE = stepKey(T.messages[1]), OLD = '#step:svc:vault>svc:vault|sign user certificate · Signs the User Scope Certificate|';
const ING = '/api/envs/prod/descriptions', FLOW = { service: 'api-gateway', ingress: 'in.createOrder' };
const mcp = (a: any, name: string, args: any) => a.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { env: 'prod', ...args } } });
const out = (r: any) => JSON.parse(r.body.result.content[0].text);
async function app() {
  const a = await startApp();
  await a.call('POST', '/api/ingest', { manifests: sampleManifests() });
  const put = (callee: string, source: string, text: string, title: string | null = null) => a.ctx.db.prepare(
    `INSERT INTO descriptions (env, service, ingress, callee, source, text, title, author, model, trace_hash, updated_at) VALUES ('prod', 'api-gateway', 'in.createOrder', ?, ?, ?, ?, 'ana', ?, 'old', '2026-11-01T10:00:00.000Z')`)
    .run(callee, source, text, title, source === 'ai' ? 'm' : null);
  return { ...a, put };
}
const detached = async (a: any) => (await a.call('GET', `${ING}?service=api-gateway&ingress=in.createOrder`)).body.detached;

test('detached: listed with key, label, title, text, author, updatedAt; a live step key is not', async () => {
  const a = await app();
  try {
    a.put(OLD, 'human', 'Signs it.', 'Sign'); a.put(OLD, 'ai', 'AI says.'); a.put(LIVE, 'human', 'Live note.');
    const d = await detached(a);
    assert.deepEqual(d.map((x: any) => [x.key, x.source]), [[OLD, 'ai'], [OLD, 'human']]);
    const h = d.find((x: any) => x.source === 'human');
    assert.deepEqual([h.title, h.text, h.author, h.updatedAt, h.label], ['Sign', 'Signs it.', 'ana', '2026-11-01T10:00:00.000Z', 'vault > vault · sign user certificate · Signs the User Scope Certificate']);
    const t = out(await mcp(a, 'trace_flow', { ...FLOW }));
    assert.equal(t.descriptions.detached.length, 2, 'the MCP reader reports them');
    assert.equal(stepLabelOf('#step:svc:a>svc:b|x|http~2'), 'a > b · x');
  } finally { await a.close(); }
});

test('clearing a detached key works (empty text and title); text to a detached key is still refused; a missing record stays 400', async () => {
  const a = await app();
  try {
    a.put(OLD, 'human', 'Signs it.', 'Sign');
    assert.equal((await a.call('PUT', ING, { ...FLOW, callee: OLD, text: 'new words' })).status, 400, 'non-empty write refused');
    assert.equal((await a.call('PUT', ING, { ...FLOW, callee: '#step:svc:no>svc:no|none|', text: '' })).status, 400, 'no record, no match: as before');
    const r = await a.call('PUT', ING, { ...FLOW, callee: OLD, text: '', title: '' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.detached, []);
    assert.equal(r.body.callees[OLD], undefined);
    a.put(OLD, 'human', 'Again.', 'T'); a.put(OLD, 'ai', 'AI.');
    assert.equal((await a.call('PUT', ING, { ...FLOW, callee: OLD, text: '', source: 'ai' })).body.detached.length, 1, 'source ai clears only the AI record');
    assert.equal((await a.call('PUT', ING, { ...FLOW, callee: LIVE, text: '', source: 'ai' })).status, 400, 'source ai never touches a live step');
  } finally { await a.close(); }
});

test('moveTo: both records go to a current step; refused for a live key, an unknown target, a target that has a note', async () => {
  const a = await app();
  try {
    a.put(OLD, 'human', 'Signs it.', 'Sign'); a.put(OLD, 'ai', 'AI says.');
    assert.equal((await a.call('PUT', ING, { ...FLOW, callee: LIVE, moveTo: LIVE })).status, 400, 'a live key');
    assert.equal((await a.call('PUT', ING, { ...FLOW, callee: OLD, moveTo: '#step:svc:x>svc:y|nope|' })).status, 400, 'unknown target');
    a.put(LIVE, 'human', 'Occupied.');
    assert.equal((await a.call('PUT', ING, { ...FLOW, callee: OLD, moveTo: LIVE })).status, 409, 'target has a human note');
    await a.call('PUT', ING, { ...FLOW, callee: LIVE, text: '' });
    const r = await a.call('PUT', ING, { ...FLOW, callee: OLD, moveTo: LIVE });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.callees[LIVE].human.text, r.body.callees[LIVE].human.title, r.body.callees[LIVE].ai.text, r.body.detached.length], ['Signs it.', 'Sign', 'AI says.', 0]);
    assert.equal(r.body.callees[OLD], undefined);
  } finally { await a.close(); }
});

test('MCP fix_detached_description: moves, deletes, refuses a live key', async () => {
  const a = await app();
  try {
    a.put(OLD, 'human', 'Signs it.');
    assert.equal(out(await mcp(a, 'fix_detached_description', { ...FLOW, callee: OLD, moveTo: LIVE })).callees[LIVE].human.text, 'Signs it.');
    assert.equal((await mcp(a, 'fix_detached_description', { ...FLOW, callee: LIVE })).body.result.isError, true, 'a live step is not deleted here');
    a.put(OLD, 'human', 'Again.');
    const d = out(await mcp(a, 'fix_detached_description', { ...FLOW, callee: OLD }));
    assert.deepEqual(d.detached, []);
    assert.equal(d.callees[LIVE].human.text, 'Signs it.', 'the live note stays');
  } finally { await a.close(); }
});
