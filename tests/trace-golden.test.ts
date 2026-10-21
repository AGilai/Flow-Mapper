// Golden traceHash of every entry point of the seeded prod env (samples + deltas). Recorded on the code before the
// design-environment drafts (1b-1); it must stay green: proves sealed environments are untouched by the new code paths.
// Regenerate only on purpose: GOLDEN_WRITE=1 node --test tests/trace-golden.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES } from './helpers.ts';
import { buildIndex } from '../core/graph-index.ts';
import { entryPoints, trace } from '../core/trace.ts';
import { HASH_TRACE, traceHash } from '../core/description.ts';
import { openDb } from '../server/db/connection.ts';
import { ingest } from '../server/store/snapshots-ingest.ts';
import { loadModel } from '../server/store/snapshots-read.ts';

const FILE = join(import.meta.dirname, 'fixtures/trace-golden.json');

function hashes(): Record<string, string> {
  const db = openDb(':memory:');
  const all = (d: string) => readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')));
  for (const m of [...all(SAMPLES), ...all(join(SAMPLES, 'deltas'))]) ingest(db, m, 'seed');
  const g = buildIndex(loadModel(db, 'prod'));
  const out: Record<string, string> = {};
  for (const e of entryPoints(g)) {
    const t = trace(g, { service: e.service, ingress: e.id }, HASH_TRACE);
    out[`${e.service}/${e.id}`] = t ? traceHash(t) : 'none';
  }
  return out;
}

test('traceHash of every prod entry point matches the golden file', () => {
  const now = hashes();
  if (process.env.GOLDEN_WRITE) writeFileSync(FILE, JSON.stringify(now, null, 1) + '\n');
  const golden = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.ok(Object.keys(golden).length > 50, 'enough entry points');
  assert.deepEqual(now, golden);
});
