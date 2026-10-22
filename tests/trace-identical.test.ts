// 0.37.0 (#82): a flow without alternatives is byte-identical to what trace() gave before arms and locks existed.
// The golden file holds a sha1 of the JSON of the canonical trace per entry point (samples + deltas, env prod), recorded on 0.36.1.
// Regenerate only on purpose: GOLDEN_WRITE=1 node --disable-warning=ExperimentalWarning --test tests/trace-identical.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES } from './helpers.ts';
import { buildIndex } from '../core/graph-index.ts';
import { entryPoints, trace } from '../core/trace.ts';
import { HASH_TRACE } from '../core/description.ts';
import { viewOf } from '../core/trace-view.ts';
import { openDb } from '../server/db/connection.ts';
import { ingest } from '../server/store/snapshots-ingest.ts';
import { loadModel } from '../server/store/snapshots-read.ts';

const FILE = join(import.meta.dirname, 'fixtures/trace-identical.json');

function traces() {
  const db = openDb(':memory:');
  const all = (d: string) => readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')));
  for (const m of [...all(SAMPLES), ...all(join(SAMPLES, 'deltas'))]) ingest(db, m, 'seed');
  const g = buildIndex(loadModel(db, 'prod'));
  return entryPoints(g).map((e) => ({ id: `${e.service}/${e.id}`, t: trace(g, { service: e.service, ingress: e.id }, HASH_TRACE) })).filter((x) => x.t && !x.t.messages.some((m) => m.alternatives || m.arms));
}

test('traces without alternatives are byte-identical to the recorded ones', () => {
  const now: Record<string, string> = {};
  for (const { id, t } of traces()) now[id] = createHash('sha1').update(JSON.stringify(t)).digest('hex');
  if (process.env.GOLDEN_WRITE) writeFileSync(FILE, JSON.stringify(now, null, 1) + '\n');
  const golden = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.ok(Object.keys(golden).length > 50);
  for (const k of Object.keys(now)) if (k in golden) assert.equal(now[k], golden[k], k);
  for (const k of Object.keys(golden)) assert.ok(k in now, `${k} still has no alternatives`);
});

test('viewOf full with every decision on both leaves such a trace untouched (the page asks for exactly this)', () => {
  for (const { t } of traces()) {
    assert.equal(viewOf(t!, { detail: 'full', choose: new Map([['*', 'both']]) }), t);
    assert.equal(viewOf(t!, { detail: 'full' }), t);
  }
});
