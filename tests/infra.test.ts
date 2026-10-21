// Groundwork infrastructure: nestable transactions and the bounded graph cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, tx } from '../server/db/connection.ts';
import { ingest } from '../server/store/snapshots.ts';
import { graphFor, invalidate, size, setMax } from '../server/graph-cache.ts';
import { config } from '../server/config.ts';
import { sampleManifests } from './helpers.ts';

const rows = (db: any) => (db.prepare('SELECT v FROM t ORDER BY v').all() as { v: number }[]).map((r) => r.v);
const fresh = () => { const db = openDb(':memory:'); db.exec('CREATE TABLE t (v INTEGER)'); return db; };

test('tx: commit and rollback at the top level', () => {
  const db = fresh();
  tx(db, () => db.exec('INSERT INTO t VALUES (1)'));
  assert.throws(() => tx(db, () => { db.exec('INSERT INTO t VALUES (2)'); throw new Error('x'); }), /x/);
  assert.deepEqual(rows(db), [1]);
});

test('tx: a caught inner failure rolls back only the inner part', () => {
  const db = fresh();
  tx(db, () => {
    db.exec('INSERT INTO t VALUES (1)');
    assert.throws(() => tx(db, () => { db.exec('INSERT INTO t VALUES (2)'); throw new Error('inner'); }), /inner/);
    db.exec('INSERT INTO t VALUES (3)');
  });
  assert.deepEqual(rows(db), [1, 3]);
});

test('tx: an outer failure rolls back everything, including committed inner parts', () => {
  const db = fresh();
  assert.throws(() => tx(db, () => {
    db.exec('INSERT INTO t VALUES (1)');
    tx(db, () => db.exec('INSERT INTO t VALUES (2)'));
    tx(db, () => tx(db, () => db.exec('INSERT INTO t VALUES (3)')));
    throw new Error('outer');
  }), /outer/);
  assert.deepEqual(rows(db), []);
  tx(db, () => db.exec('INSERT INTO t VALUES (4)')); // depth is back to zero: a new top-level transaction works
  assert.deepEqual(rows(db), [4]);
});

test('tx: an uncaught inner failure propagates and undoes the outer part too', () => {
  const db = fresh();
  assert.throws(() => tx(db, () => { db.exec('INSERT INTO t VALUES (1)'); tx(db, () => { throw new Error('boom'); }); }), /boom/);
  assert.deepEqual(rows(db), []);
});

test('graph cache: LRU bound, size(), invalidation', () => {
  assert.equal(config.graphCacheMax, 8); // default; FLOW_GRAPH_CACHE_MAX overrides it
  const db = openDb(':memory:');
  for (const e of ['a', 'b', 'c', 'd']) for (const m of sampleManifests()) ingest(db, { ...m, env: e });
  setMax(3);
  graphFor(db, 'a'); graphFor(db, 'b'); graphFor(db, 'c');
  assert.equal(size(), 3);
  const a = graphFor(db, 'a'); // a is now the most recent; b the oldest
  graphFor(db, 'd'); // evicts b
  assert.equal(size(), 3);
  assert.equal(graphFor(db, 'a'), a, 'a survived: it was used last');
  assert.equal(size(), 3);
  const c = graphFor(db, 'c');
  graphFor(db, 'b'); // evicts the oldest (order was d, a, c: d goes)
  assert.equal(graphFor(db, 'c'), c);
  invalidate('c');
  assert.equal(size(), 2);
  assert.notEqual(graphFor(db, 'c'), c, 'rebuilt after invalidation');
  setMax(1);
  assert.equal(size(), 1, 'lowering the bound evicts at once');
  setMax(8);
});
