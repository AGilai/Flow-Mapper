// 0.14.0: flow descriptions. Trace hash, outdated flag, prompt text (pure); REST human write; MCP set_description
// writes the AI record only; upgrade of a database that has 001 and 002 applied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { traceHash, flowDescriptions, flowPrompt, servicePrompt, lineText, HASH_TRACE, type DescRow } from '../core/description.ts';
import { openDb } from '../server/db/connection.ts';
import { sampleModel, sampleManifests, startApp } from './helpers.ts';

const g = buildIndex(sampleModel());
const T = () => trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, HASH_TRACE)!;

test('trace hash: stable across loads, changes when the trace changes, per callee', () => {
  const a = traceHash(T()), b = traceHash(T());
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{14}$/);
  const t = T();
  const edited = { ...t, messages: t.messages.slice(0, -1) };
  assert.notEqual(traceHash(edited), a);
  const relabeled = { ...t, messages: t.messages.map((m, i) => (i === 1 ? { ...m, label: m.label + 'x' } : m)) };
  assert.notEqual(traceHash(relabeled), a);
  // a callee hash only moves when that service's messages move
  const svc = 'orders-svc';
  const ca = traceHash(t, svc);
  assert.notEqual(ca, a);
  assert.equal(traceHash(T(), svc), ca);
  assert.equal(traceHash(t, `${svc}:onThing`), ca, 'service:handler hashes by its service');
  const other = { ...t, messages: t.messages.map((m) => (m.from !== `svc:${svc}` && m.to !== `svc:${svc}` && m.target?.service !== svc ? { ...m, label: m.label + '!' } : m)) };
  assert.equal(traceHash(other, svc), ca);
});

test('outdated: an AI record is outdated when the hash it stored differs from the current trace', () => {
  const t = T(), h = traceHash(t);
  const rows: DescRow[] = [
    { callee: '', source: 'ai', text: 'x', author: null, model: 'm', traceHash: h, updatedAt: 'then' },
    { callee: 'orders-svc', source: 'ai', text: 'y', author: null, model: 'm', traceHash: 'stale', updatedAt: 'then' },
    { callee: 'orders-svc', source: 'human', text: 'note', author: 'a', model: null, traceHash: null, updatedAt: 'then' },
  ];
  const d = flowDescriptions(t, 'api-gateway', 'in.createOrder', rows);
  assert.equal(d.flow.ai!.outdated, false);
  assert.equal(d.flow.human, null);
  assert.equal(d.callees['orders-svc'].ai!.outdated, true);
  assert.equal(d.callees['orders-svc'].human!.text, 'note');
  const changed = flowDescriptions({ messages: t.messages.slice(1) }, 'api-gateway', 'in.createOrder', rows);
  assert.equal(changed.flow.ai!.outdated, true);
  assert.equal(lineText(d.callees['orders-svc'])!.who, 'human', 'a one-line spot prefers the human note');
  assert.equal(lineText(d.flow)!.who, 'ai');
  assert.equal(lineText(null), null);
});

test('prompts name the tools and fill in the arguments', () => {
  const p1 = flowPrompt({ env: 'prod', service: 'api-gateway', ingress: 'in.createOrder' });
  for (const s of ['trace_flow(env="prod", service="api-gateway", ingress="in.createOrder"', 'get_service', 'set_description(env="prod", service="api-gateway", ingress="in.createOrder"', 'callee=<service name>']) assert.ok(p1.includes(s), s);
  const p2 = servicePrompt({ env: 'prod', service: 'api-gateway', ingress: 'in.createOrder', callee: 'orders-svc' });
  for (const s of ['trace_flow(env="prod"', 'get_service(env="prod", service="orders-svc")', 'callee="orders-svc"', 'model=<your model name>']) assert.ok(p2.includes(s), s);
  assert.ok(!p2.includes('callee=<service name>'));
});

const ING = '/api/envs/prod/descriptions';
async function app() {
  const a = await startApp();
  await a.call('POST', '/api/ingest', { manifests: sampleManifests() });
  return a;
}
const mcp = (a: any, name: string, args: any) => a.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { env: 'prod', ...args } } });
const out = (r: any) => JSON.parse(r.body.result.content[0].text);

test('REST: the human record is written and read with the trace hash; AI is not writable here', async () => {
  const a = await app();
  try {
    const empty = await a.call('GET', `${ING}?service=api-gateway&ingress=in.createOrder`);
    assert.equal(empty.status, 200);
    assert.deepEqual([empty.body.flow.human, empty.body.flow.ai, empty.body.callees], [null, null, {}]);
    assert.match(empty.body.hash, /^[0-9a-f]{14}$/);
    const put = await a.call('PUT', ING, { service: 'api-gateway', ingress: 'in.createOrder', text: '  The main checkout path.  ', editedBy: 'Asaf' });
    assert.equal(put.status, 200);
    assert.equal(put.body.flow.human.text, 'The main checkout path.');
    assert.equal(put.body.flow.human.editedBy, 'Asaf');
    assert.equal(put.body.flow.ai, null);
    await a.call('PUT', ING, { service: 'api-gateway', ingress: 'in.createOrder', callee: 'orders-svc', text: 'Takes the payment.' });
    const read = await a.call('GET', `${ING}?service=api-gateway&ingress=in.createOrder`);
    assert.equal(read.body.callees['orders-svc'].human.text, 'Takes the payment.');
    // a body cannot smuggle an AI record in
    const sneaky = await a.call('PUT', ING, { service: 'api-gateway', ingress: 'in.createOrder', text: 'hi', source: 'ai', model: 'x' });
    assert.equal(sneaky.body.flow.ai, null);
    // empty text removes the human record
    const del = await a.call('PUT', ING, { service: 'api-gateway', ingress: 'in.createOrder', text: ' ' });
    assert.equal(del.body.flow.human, null);
    // errors
    assert.equal((await a.call('PUT', ING, { service: 'api-gateway', ingress: 'in.nope', text: 'x' })).status, 404);
    assert.equal((await a.call('PUT', ING, { service: 'api-gateway', ingress: 'in.createOrder', callee: 'ghost', text: 'x' })).status, 400);
    assert.equal((await a.call('PUT', ING, { service: 'api-gateway', ingress: 'in.createOrder' })).status, 400);
    assert.equal((await a.call('GET', `${ING}?service=api-gateway`)).status, 400);
  } finally { await a.close(); }
});

test('MCP set_description writes the AI record only; trace_flow and get_service show it; a changed flow marks it outdated', async () => {
  const a = await app();
  try {
    await a.call('PUT', ING, { service: 'api-gateway', ingress: 'in.createOrder', text: 'Human words.' });
    const set = out(await mcp(a, 'set_description', { service: 'api-gateway', ingress: 'in.createOrder', text: 'AI words.', model: 'claude-test' }));
    assert.equal(set.flow.human.text, 'Human words.', 'the human record is untouched');
    assert.equal(set.flow.ai.text, 'AI words.');
    assert.equal(set.flow.ai.model, 'claude-test');
    assert.equal(set.flow.ai.outdated, false);
    const row = a.ctx.db.prepare("SELECT source, trace_hash FROM descriptions WHERE callee = '' ORDER BY source").all() as any[];
    assert.deepEqual(row.map((r) => r.source), ['ai', 'human']);
    assert.equal(row[0].trace_hash, set.hash);
    assert.equal(row[1].trace_hash, null);
    // a service sub-flow, and again (replaces)
    await mcp(a, 'set_description', { service: 'api-gateway', ingress: 'in.createOrder', callee: 'orders-svc', text: 'v1', model: 'm' });
    const again = out(await mcp(a, 'set_description', { service: 'api-gateway', ingress: 'in.createOrder', callee: 'orders-svc', text: 'v2', model: 'm' }));
    assert.equal(again.callees['orders-svc'].ai.text, 'v2');
    // visible to agents
    const tf = out(await mcp(a, 'trace_flow', { service: 'api-gateway', ingress: 'in.createOrder' }));
    assert.equal(tf.descriptions.flow.ai.text, 'AI words.');
    assert.equal(tf.descriptions.flow.human.text, 'Human words.');
    const gs = out(await mcp(a, 'get_service', { service: 'api-gateway' }));
    assert.deepEqual(gs.descriptions.map((d: any) => [d.ingress, d.callee, d.source]), [['in.createOrder', null, 'ai'], ['in.createOrder', null, 'human'], ['in.createOrder', 'orders-svc', 'ai']]);
    // errors: unknown ingress, no model, no text
    assert.equal(out(await mcp(a, 'set_description', { service: 'api-gateway', ingress: 'in.nope', text: 'x', model: 'm' }).then((r) => ({ body: { result: { content: [{ text: JSON.stringify({ e: r.body.result.isError }) }] } } }))).e, true);
    assert.equal((await mcp(a, 'set_description', { service: 'api-gateway', ingress: 'in.createOrder', text: 'x', model: '' })).body.result.isError, true);
    // the flow changes: the stored hash no longer matches
    a.ctx.db.prepare("UPDATE descriptions SET trace_hash = 'old' WHERE source = 'ai' AND callee = ''").run();
    const read = await a.call('GET', `${ING}?service=api-gateway&ingress=in.createOrder`);
    assert.equal(read.body.flow.ai.outdated, true);
    assert.equal(read.body.callees['orders-svc'].ai.outdated, false);
  } finally { await a.close(); }
});

test('upgrade: a database with 001 and 002 applied gets 003, data kept, backup written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-mapper-desc-'));
  const path = join(dir, 'v013.db');
  const mig = (f: string) => readFileSync(join(import.meta.dirname, '../server/db/migrations', f), 'utf8');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON');
  raw.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  for (const f of ['001_init.sql', '002_dto_status_meta.sql']) {
    const sql = mig(f);
    raw.exec('PRAGMA foreign_keys = OFF'); raw.exec(sql); raw.exec('PRAGMA foreign_keys = ON');
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(f, 'then', createHash('sha256').update(sql).digest('hex'));
  }
  raw.exec("INSERT INTO bugs (title, priority, app_version, created_at, updated_at) VALUES ('kept', 'P3', '0.13.0', 't', 't')");
  raw.close();
  const log = console.log; console.log = () => {};
  const db = openDb(path);
  console.log = log;
  assert.equal((db.prepare('SELECT count(*) AS n FROM bugs').get() as any).n, 1);
  db.prepare("INSERT INTO descriptions (env, service, ingress, callee, source, text, updated_at) VALUES ('prod', 's', 'i', '', 'human', 't', 'n')").run();
  assert.throws(() => db.prepare("INSERT INTO descriptions (env, service, ingress, callee, source, text, updated_at) VALUES ('prod', 's', 'i', '', 'robot', 't', 'n')").run());
  assert.throws(() => db.prepare("INSERT INTO descriptions (env, service, ingress, callee, source, text, updated_at) VALUES ('prod', 's', 'i', '', 'human', 'again', 'n')").run(), 'one record per source and key');
  db.close();
  assert.ok(existsSync(`${path}.pre-003.bak`));
});
