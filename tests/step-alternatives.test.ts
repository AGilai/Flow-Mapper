// Either/or alternatives on a step (0.36.1, #82 part 1): the manifest field, ingest, the trace API and MCP trace_flow. No drawing change.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createValidator } from '../core/schema-validate.ts';
import { readSample, startApp } from './helpers.ts';

const validate = createValidator(JSON.parse(readFileSync(join(import.meta.dirname, '../schema/manifest.schema.json'), 'utf8')));
const ALT = { group_id: 'g-1', name: 'when x -> A, else -> B', depends_on: 'data', llm_name: null, llm_provenance: null, guard: { text: 'x', file: 'a.js', line: 3 }, extra: 1,
  arms: [{ arm: 'then', label: 'A', guard_text: 'x', step_ids: ['s:f#1'], more: true }, { arm: 'else', step_ids: ['s:f#2'] }] };
const FIX = [{ group_id: 'g-1', arm: 'then', source: { file: 'a.js', line: 9 }, literal: 'installation_key', extra: 1 }, { group_id: 'g-2', arm: 'else' }];
const withAlt = (alternatives: unknown, where: 'top' | 'details' = 'top', fixes?: unknown) => {
  const m = readSample('api-gateway.json'); m.version += 1;
  const st = m.functions.find((f: any) => f.id === 'routeGetOrder').steps[0];
  if (where === 'top') { st.alternatives = alternatives; if (fixes) st.fixes = fixes; } else st.details = { alternatives, ...(fixes ? { fixes } : {}) };
  return m;
};

test('schema: alternatives valid, invalid, and an old manifest stays valid', () => {
  assert.deepEqual(validate(withAlt([ALT])), []);
  assert.deepEqual(validate(withAlt([ALT], 'top', FIX)), []);
  for (const bad of [[{ arm: 'then' }], [{ group_id: 'g' }], [{ group_id: 'g', arm: 'x', source: { line: 'n' } }], { group_id: 'g', arm: 'x' }]) assert.ok(validate(withAlt([ALT], 'top', bad)).length, JSON.stringify(bad));
  assert.deepEqual(validate(readSample('orders-svc.json')), []);
  for (const bad of [[{ arms: [] }], [{ group_id: 'g' }], [{ group_id: 'g', arms: [{ arm: 'then' }] }], [{ ...ALT, depends_on: 'maybe' }], [{ ...ALT, llm_name: 5 }], { group_id: 'g' }]) {
    assert.ok(validate(withAlt(bad)).length, JSON.stringify(bad));
  }
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); });
after(() => app.close());
const trace = async () => (await app.call('GET', '/api/envs/prod/trace?service=api-gateway&ingress=in.getOrder')).body.messages as any[];

test('API: ingest then trace returns alternatives verbatim with the step id; absent when the step has none', async () => {
  assert.equal((await app.call('POST', '/api/ingest', withAlt([ALT]))).status, 201);
  const msgs = await trace(); const m = msgs.find((x) => x.alternatives);
  assert.deepEqual(m.alternatives, [ALT]); assert.ok(!('fixes' in m)); assert.equal(m.stepId, 'api-gateway:routeGetOrder#1');
  const plain = (await app.call('GET', '/api/envs/prod/trace?service=api-gateway&ingress=in.createOrder')).body.messages as any[];
  assert.ok(plain.every((x) => !('alternatives' in x) || x.service === 'api-gateway'));
  assert.ok(msgs.some((x) => !('alternatives' in x) && !('stepId' in x)));
  assert.equal((await app.call('POST', '/api/ingest', { ...withAlt([{ group_id: 'g' }]), version: 99 })).status, 422);
  const f = withAlt([ALT], 'top', FIX); f.version += 3;
  assert.equal((await app.call('POST', '/api/ingest', f)).status, 201);
  assert.deepEqual((await trace()).find((x) => x.fixes).fixes, FIX);
});

test('API: details.alternatives is read the same way; the top-level field wins', async () => {
  const m = withAlt([ALT], 'details', FIX); m.version += 5;
  assert.equal((await app.call('POST', '/api/ingest', m)).status, 201);
  const d = (await trace()).find((x) => x.alternatives);
  assert.deepEqual(d.alternatives, [ALT]); assert.deepEqual(d.fixes, FIX);
  const both = withAlt([{ ...ALT, group_id: 'top' }]); both.version += 10;
  both.functions.find((f: any) => f.id === 'routeGetOrder').steps[0].details = { alternatives: [ALT] };
  both.functions.find((f: any) => f.id === 'routeGetOrder').steps[0].fixes = FIX;
  assert.equal((await app.call('POST', '/api/ingest', both)).status, 201);
  assert.equal((await trace()).find((x) => x.alternatives).alternatives[0].group_id, 'top');
});

test('MCP trace_flow returns alternatives and stepId', async () => {
  const r = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trace_flow', arguments: { env: 'prod', service: 'api-gateway', ingress: 'in.getOrder' } } });
  const out = JSON.parse(r.body.result.content[0].text);
  const m = out.messages.find((x: any) => x.alternatives);
  assert.equal(m.alternatives[0].group_id, 'top'); assert.deepEqual(m.fixes, FIX); assert.equal(m.stepId, 'api-gateway:routeGetOrder#1');
});
