// 0.30.0 step details: migration 015 (title column, upgrade of a database without 014), title validation and the human-wins rule, MCP set_description with a title,
// the pure option model (URL sb= / sd=, label, row heights per option) and the Mermaid export with a title.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { stepKey, flowDescriptions, titleOf, HASH_TRACE, type DescRow } from '../core/description.ts';
import { exportMermaid } from '../core/mermaid-export.ts';
import { openDb } from '../server/db/connection.ts';
import { sampleModel, sampleManifests, startApp } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { decodeBar, decodeArrows, encodeBar, encodeArrows, summary, toggle, arrowParts, extraHeight, canon } from '../web/js/views/step-details-pure.js';

const g = buildIndex(sampleModel());
const T = () => trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, HASH_TRACE)!;
const ING = '/api/envs/prod/descriptions';
const quiet = <T>(f: () => T): T => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };
const mcp = (a: any, name: string, args: any) => a.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { env: 'prod', ...args } } });
const out = (r: any) => JSON.parse(r.body.result.content[0].text);
async function app() { const a = await startApp(); await a.call('POST', '/api/ingest', { manifests: sampleManifests() }); return a; }

test('migration 015 adds the title column to a database that has 001-013 but not 014; rows are kept, the backup has no title', () => {
  const MIG = join(import.meta.dirname, '../server/db/migrations');
  const all = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
  const path = join(mkdtempSync(join(tmpdir(), 'flow-mapper-mig15-')), 'old.db');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  for (const f of all.filter((f) => f < '014')) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(f, 'then', createHash('sha256').update(sql).digest('hex'));
  }
  raw.exec("INSERT INTO descriptions (env, service, ingress, callee, source, text, updated_at) VALUES ('prod', 's', 'i', '#step:a>b|x|', 'human', 'kept', 'then')");
  raw.close();
  const db = quiet(() => openDb(path));
  const row = db.prepare('SELECT text, title FROM descriptions').get() as any;
  assert.equal(row.text, 'kept'); assert.equal(row.title, null);
  assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE name = '015_step_titles.sql'").get());
  db.close();
  const b = new DatabaseSync(`${path}.pre-015.bak`, { readOnly: true });
  assert.ok(!(b.prepare("PRAGMA table_info(descriptions)").all() as any[]).some((c) => c.name === 'title'));
  b.close();
});

test('REST: a step title is trimmed, limited to 80 characters, kept when omitted, cleared with empty; a title-only note survives; ignored off a step', async () => {
  const a = await app();
  try {
    const k = stepKey(T().messages[1]);
    const w = (body: any) => a.call('PUT', ING, { service: 'api-gateway', ingress: 'in.createOrder', callee: k, ...body });
    const one = await w({ text: 'Words.', title: '  Reserve stock  ' });
    assert.equal(one.body.callees[k].human.title, 'Reserve stock');
    assert.equal((await w({ text: 'New words.' })).body.callees[k].human.title, 'Reserve stock', 'omitted title is kept');
    assert.equal((await w({ text: '', title: 'Only a title' })).body.callees[k].human.text, '', 'a title with empty text stays');
    assert.equal((await w({ text: '', title: '' })).body.callees[k]?.human ?? null, null, 'no text and no title removes the record');
    assert.equal((await w({ text: 'x', title: 'y'.repeat(81) })).status, 400);
    assert.equal((await w({ text: 'x', title: 5 })).status, 400);
    assert.equal((await w({ text: 'x', title: 'y'.repeat(80) })).status, 200);
    const flow = await a.call('PUT', ING, { service: 'api-gateway', ingress: 'in.createOrder', text: 'Flow.', title: 'Ignored' });
    assert.equal(flow.body.flow.human.title, null, 'a title belongs to a step');
  } finally { await a.close(); }
});

test('MCP set_description takes a title for a step; the human title wins, a title-only AI note is allowed', async () => {
  const a = await app();
  try {
    const k = stepKey(T().messages[1]), base = { service: 'api-gateway', ingress: 'in.createOrder', callee: k, model: 'm' };
    const ai = out(await mcp(a, 'set_description', { ...base, text: 'AI words.', title: 'AI title' }));
    assert.equal(ai.callees[k].ai.title, 'AI title');
    assert.equal(titleOf(ai.callees[k]), 'AI title');
    await a.call('PUT', ING, { service: 'api-gateway', ingress: 'in.createOrder', callee: k, text: '', title: 'Human title' });
    const both = out(await mcp(a, 'set_description', { ...base, text: '', title: 'AI title 2' }));
    assert.equal(both.callees[k].ai.title, 'AI title 2');
    assert.equal(titleOf(both.callees[k]), 'Human title', 'human wins');
    assert.equal((await mcp(a, 'set_description', { ...base, text: '' })).body.result.isError, false, 'a title omitted keeps the stored one, so the note is not empty');
    assert.equal((await mcp(a, 'set_description', { ...base, text: '', title: '' })).body.result.isError, true, 'clearing the title of a title-only note leaves nothing');
    assert.equal((await mcp(a, 'set_description', { ...base, text: 'x', title: 'z'.repeat(81) })).body.result.isError, true);
    assert.equal((await mcp(a, 'set_description', { service: 'api-gateway', ingress: 'in.createOrder', text: '', model: 'm' })).body.result.isError, true);
  } finally { await a.close(); }
});

test('pure: sb= and sd= parse and encode, defaults are omitted, the arrows keep one field, the label summarises both', () => {
  const q = (s: string) => new URLSearchParams(s);
  assert.equal(decodeBar(q('')), null); assert.equal(decodeBar(q('sb=-')), ''); assert.equal(decodeBar(q('sb=da')), 'ad'); assert.equal(decodeBar(q('sb=zz')), 'tad');
  assert.equal(decodeArrows(q('')), null); assert.equal(decodeArrows(q('sd=tad')), 'tad'); assert.equal(decodeArrows(q('sd=x')), 'a'); assert.equal(decodeArrows(q('sd=')), 'a');
  assert.equal(encodeBar('tad'), null); assert.equal(encodeBar(''), '-'); assert.equal(encodeBar('ad'), 'ad');
  assert.equal(encodeArrows('a'), null); assert.equal(encodeArrows('tad'), 'tad');
  assert.equal(canon('dta'), 'tad');
  assert.equal(toggle('a', 'a', 1), 'a', 'the last arrow field stays'); assert.equal(toggle('tad', 'a', 0), 'td'); assert.equal(toggle('', 't'), 't'); assert.equal(toggle('a', 't', 1), 'ta');
  assert.equal(summary('tad', 'a'), 'Step details: bar 3 · arrows API');
  assert.equal(summary('', 'ta'), 'Step details: bar stepper only · arrows Title + API');
});

test('pure: the row model per option (what a step adds above and below its arrow)', () => {
  const has = { title: 'T', desc: 'D' };
  assert.deepEqual([arrowParts('a', has).extraUp, arrowParts('a', has).extraDown], [0, 0], 'API only: the rows of 0.29');
  assert.equal(extraHeight(arrowParts('a', has)), 0);
  assert.equal(extraHeight(arrowParts('ta', has)), 17);
  assert.equal(extraHeight(arrowParts('ad', has)), 15);
  assert.equal(extraHeight(arrowParts('tad', has)), 32);
  assert.equal(extraHeight(arrowParts('td', has)), 15, 'no API: title above, description below');
  assert.equal(extraHeight(arrowParts('t', has)), 0, 'title alone takes the label slot');
  assert.equal(arrowParts('tad', { title: '', desc: '' }).extraUp + arrowParts('tad', { title: '', desc: '' }).extraDown, 0, 'a step without text is its API line');
  const none = arrowParts('t', { title: '', desc: 'D' });
  assert.equal(none.api, true, 'nothing the step has is enabled: fall back to the API'); assert.equal(none.title, false);
  assert.equal(extraHeight(null), 0);
});

test('Mermaid export: a step title is the message and the API goes into a note', () => {
  const t = T(), k = stepKey(t.messages[0]);
  const rows: DescRow[] = [{ callee: k, source: 'human', text: '', title: 'Create the order', author: 'a', model: null, traceHash: null, updatedAt: 'then' }];
  const text = exportMermaid(t, { descriptions: flowDescriptions(t, 'api-gateway', 'in.createOrder', rows) });
  assert.match(text, /->>[A-Za-z0-9_]+: Create the order\n/);
  assert.match(text, /Note over [^\n]+: POST \/api\/orders/);
  assert.ok(!exportMermaid(t).includes('Create the order'));
});
