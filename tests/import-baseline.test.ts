// The baseline of imported items (core/import-baseline.ts): kept on the draft's ops until apply. Pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importBaseline } from '../core/import-baseline.ts';
import { rowId } from '../core/item-rows.ts';
import type { DraftOp } from '../core/draft-ops.ts';

let seq = 0;
const op = (o: Partial<DraftOp> & { service: string; list: string; key: string }): DraftOp =>
  ({ op: 'upsert', anchor: 'x', seq: ++seq, baseHash: null, author: 'a', byAi: false, at: `T${seq}`, data: {}, ...o });
const fn = (key: string, data: any, origin?: { env: string; version: number | null }) => op({ service: 's', list: 'functions', key, data, ...(origin ? { origin } : {}) });
const present = (...ops: DraftOp[]) => new Set(ops.map((o) => rowId(o)));
const P = { env: 'prod', version: 7 };

test('an import op gives a row: data as imported, source env and version, taken at the op time', () => {
  const a = fn('f', { id: 'f', steps: [] }, P), plain = fn('g', { id: 'g' });
  assert.deepEqual(importBaseline([a, plain], present(a, plain)), [{ service: 's', list: 'functions', key: 'f', data: { id: 'f', steps: [] }, sourceEnv: 'prod', sourceVersion: 7, takenAt: a.at }]);
});

test('the last origin op per item wins, and a later edit without origin does not change the baseline', () => {
  const first = fn('f', { id: 'f', v: 1 }, P), edit = fn('f', { id: 'f', v: 2 }), again = fn('f', { id: 'f', v: 3 }, { env: 'other', version: null });
  assert.equal(importBaseline([first, edit], present(first))[0].data.v, 1, 'the edit is a change against the imported baseline');
  const r = importBaseline([first, edit, again], present(first))[0];
  assert.deepEqual([r.data.v, r.sourceEnv, r.sourceVersion], [3, 'other', null]);
});

test('imported then deleted in the draft: nothing (never a Removed mark); a service delete drops what came earlier for that service', () => {
  const a = fn('f', { id: 'f' }, P), b = op({ service: 't', list: 'functions', key: 'g', data: { id: 'g' }, origin: P });
  assert.deepEqual(importBaseline([a, b], new Set([rowId(b)])).map((r) => r.service), ['t'], 'a row that is not in the draft environment any more is not kept');
  const del = op({ op: 'delete', anchor: 'svc:s', service: 's', list: 'header', key: '', data: undefined });
  assert.deepEqual(importBaseline([a, b, del], present(a, b)).map((r) => r.service), ['t'], 'delete svc:s drops the earlier import of s');
  const later = fn('f2', { id: 'f2' }, P);
  assert.deepEqual(importBaseline([a, del, later], present(a, later)).map((r) => r.key), ['f2'], 'but an import after the delete stays');
});

test('a header row is the data without groupPath (the subsystem is the design\'s own), as a copy writes it', () => {
  const h = op({ service: 's', list: 'header', key: '', anchor: 'svc:s', data: { kind: 'service', team: 't', groupPath: 'platform' }, origin: P });
  assert.deepEqual(importBaseline([h], present(h))[0].data, { kind: 'service', team: 't' });
});

test('ops arrive in any order; seq decides', () => {
  const a = fn('f', { v: 1 }, P), b = fn('f', { v: 2 }, P);
  assert.equal(importBaseline([b, a], present(a))[0].data.v, 2);
});
