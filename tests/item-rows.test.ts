// ItemRow parity: rowsToModel(envItemRows(env)) must equal loadModel(env), or draft graphs drift from the real ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES } from './helpers.ts';
import { openDb } from '../server/db/connection.ts';
import { ingest } from '../server/store/snapshots-ingest.ts';
import { loadModel } from '../server/store/snapshots-read.ts';
import { envItemRows } from '../server/store/item-rows.ts';
import { rowsToModel, rowsToExtras } from '../core/item-rows.ts';
import { loadDtos, listDtos, listEventDtos } from '../server/store/dtos.ts';
import { loadSchemas, listSchemas } from '../server/store/schemas.ts';
import { generateMock } from '../scripts/mock/generate.ts';

const all = (d: string) => readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')));

test('rowsToModel(envItemRows) deep-equals loadModel on the samples and on 100 mock services', () => {
  const db = openDb(':memory:');
  for (const m of [...all(SAMPLES), ...all(join(SAMPLES, 'deltas')), ...generateMock({ services: 100, seed: 7, env: 'scale-test' })]) ingest(db, m, 'seed');
  for (const env of ['prod', 'scale-test']) {
    const m = loadModel(db, env);
    assert.ok(m.services.length > 10);
    assert.deepEqual(rowsToModel(env, envItemRows(db, env)), m, env);
  }
});

test('rowsToExtras gives the store output shapes (DTOs, event DTOs, schemas) back', () => {
  const db = openDb(':memory:');
  for (const m of [...all(SAMPLES), ...all(join(SAMPLES, 'deltas'))]) ingest(db, m, 'seed');
  for (const f of all(join(SAMPLES, 'dtos'))) loadDtos(db, f.env, f.dtos);
  for (const f of all(join(SAMPLES, 'schemas'))) loadSchemas(db, f.env, f.schemas, () => true);
  const x = rowsToExtras(envItemRows(db, 'prod'));
  const strip = (xs: any[]) => xs.map(({ updatedAt, link, ...r }) => r);
  assert.ok(x.dtos.length && x.eventDtos.length && x.schemas.length);
  assert.deepEqual(strip(x.dtos), strip(listDtos(db, 'prod')));
  assert.deepEqual(strip(x.eventDtos), strip(listEventDtos(db, 'prod')));
  assert.deepEqual(strip(x.schemas), strip(listSchemas(db, 'prod')));
});
