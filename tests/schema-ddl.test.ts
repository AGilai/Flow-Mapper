// #124: store schemas as a DDL table: JSON Schema and the 'manual' shape become rows, non-DDL keys are kept apart, odd shapes warn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ddlOf, schemaWarnings } from '../core/schema-ddl.ts';
import { schemaRows } from '../core/json-schema.ts';
import { startApp, sampleManifests } from './helpers.ts';

const outbox = { // the corev5-hld UserCertificateLifecycleOutbox shape
  fields: { _id: 'ObjectId', loginInstanceId: 'NetworkDevice._id', deliveryState: 'pending | done | failed', attempts: 'int', tags: 'string[]',
    payload: { type: 'object', required: true, fields: { kind: 'string', body: { type: 'string', description: 'JSON text', required: true } } }, meta: { createdAt: 'date', by: 'string' } },
  indexes: [{ name: 'by_state', keys: { deliveryState: 1, createdAt: -1 } }, { fields: ['loginInstanceId'], unique: true }, 'attempts'],
  incomplete: true, doc: { file: 'outbox.md', section: '3.2', quote: 'the outbox keeps...', confidence: 'medium' }, $comment: 'from the design doc',
};

test('manual: fields become rows (types, enums, nesting, required), indexes their own list, doc / incomplete / $comment go to extra', () => {
  const d = ddlOf(outbox);
  assert.equal(d.kind, 'manual'); assert.deepEqual(d.warnings, []);
  const r = schemaRows(d.schema);
  assert.deepEqual(r.map((x) => [x.path, x.type, x.required, x.depth]), [['_id', 'ObjectId', false, 0], ['loginInstanceId', 'any', false, 0], ['deliveryState', 'string', false, 0], ['attempts', 'int', false, 0], ['tags', 'string[]', false, 0],
    ['payload', 'object', true, 0], ['payload.kind', 'string', false, 1], ['payload.body', 'string', true, 1], ['meta', 'object', false, 0], ['meta.createdAt', 'date', false, 1], ['meta.by', 'string', false, 1]]);
  assert.equal(r[1].description, 'NetworkDevice._id', 'free text is a description, no type is invented');
  assert.deepEqual(r[2].enum, ['pending', 'done', 'failed']);
  assert.equal(r[7].description, 'JSON text');
  assert.deepEqual(d.indexes, [{ name: 'by_state', keys: 'deliveryState, createdAt desc', unique: false, notes: '' }, { name: '', keys: 'loginInstanceId', unique: true, notes: '' }, { name: '', keys: 'attempts', unique: false, notes: '' }]);
  assert.deepEqual(d.extra.map(([k]) => k), ['incomplete', 'doc', '$comment']);
  assert.ok(!r.some((x) => ['doc', 'incomplete', '$comment'].includes(x.name)), 'notes never become fields');
});

test('JSON Schema: kept as is; $comment / x- keys / doc are extra; indexes read too', () => {
  const js = { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', required: ['a'], properties: { a: { type: 'string' } }, 'x-doc': { file: 'f' }, $comment: 'c', indexes: [{ keys: ['a'] }] };
  const d = ddlOf(js);
  assert.equal(d.kind, 'json-schema'); assert.equal(d.schema, js); assert.deepEqual(d.extra.map(([k]) => k), ['x-doc', '$comment']); assert.equal(d.indexes[0].keys, 'a');
});

test('unknown shapes warn instead of failing: no fields, wrong types, bad indexes', () => {
  assert.equal(ddlOf({ note: 'only text' }).kind, 'unknown'); assert.match(ddlOf({ note: 'x' }).warnings[0], /neither `properties`/);
  assert.equal(ddlOf([1]).kind, 'unknown'); assert.equal(ddlOf(null).schema, null); assert.equal(ddlOf('x').kind, 'unknown');
  assert.equal(ddlOf({ fields: 'a' }).kind, 'unknown');
  const w = ddlOf({ fields: { a: 5, b: null, c: ['x', 'y'], d: '' }, indexes: [7, {}, 'ok'] });
  assert.equal(w.kind, 'manual'); assert.equal(w.warnings.length, 6); assert.equal(w.indexes.length, 1);
  assert.deepEqual(schemaWarnings({ fields: { a: 'string' } }), []);
  assert.equal(ddlOf({ fields: { a: 'string' }, indexes: 'x' }).warnings.length, 1);
});

test('server: schemas that are not DDL are stored with a schema-not-ddl warning (POST, PUT, dryRun); DDL ones answer none', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
    const key = 'mongodb:orders-db/orders', good = { fields: { a: 'string' }, indexes: [{ keys: { a: 1 } }] };
    const ok = await app.call('POST', '/api/envs/prod/schemas', { schemas: [{ key, source: 'manual', content: good }] });
    assert.equal(ok.status, 201); assert.equal(ok.body.warnings, undefined);
    const bad = await app.call('POST', '/api/envs/prod/schemas?dryRun=1', { schemas: [{ key, source: 'manual', content: { note: 'x' } }] });
    assert.equal(bad.status, 200); assert.equal(bad.body.warnings[0].code, 'schema-not-ddl'); assert.equal(bad.body.warnings[0].key, key);
    const put = await app.call('PUT', `/api/envs/prod/schemas/manual/${key}`, { note: 'x' });
    assert.equal(put.status, 200); assert.equal(put.body.warnings[0].code, 'schema-not-ddl'); assert.deepEqual(put.body.content, { note: 'x' }, 'stored as sent');
  } finally { await app.close(); }
});
