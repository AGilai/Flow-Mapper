// References (core/references.ts): a copied endpoint whose handler is not a function of the design. Pure, on hand-made rows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originsOf, referencesOf } from '../core/references.ts';
import type { ItemRow } from '../core/item-rows.ts';

const hdr = (service: string): ItemRow => ({ service, list: 'header', key: '', data: { kind: 'service' } });
const ing = (service: string, id: string, handler: string, extra: object = {}): ItemRow => ({ service, list: 'ingress', key: id, data: { id, bindKey: `http:GET ${service}/${id}`, transport: 'http', handler, ...extra } });
const fn = (service: string, id: string): ItemRow => ({ service, list: 'functions', key: id, data: { id, name: id, steps: [] } });
const base = (rows: ItemRow[], at = 'T0', env = 'prod') => rows.filter((r) => r.list === 'ingress').map((r) => ({ service: r.service, list: r.list, key: r.key, sourceEnv: env, takenAt: at }));

test('a Components copy makes every copied endpoint a reference; the component counts them', () => {
  const rows = [hdr('users'), ing('users', 'in.a', 'a'), ing('users', 'in.b', 'b'), hdr('auth'), ing('auth', 'in.v', 'v'), fn('auth', 'v')];
  const refs = referencesOf(rows, originsOf(base(rows)), 'T0');
  assert.deepEqual(Object.keys(refs.endpoints).sort(), ['ing:users/in.a', 'ing:users/in.b']);
  assert.deepEqual(refs.endpoints['ing:users/in.a'], { service: 'users', ingress: 'in.a', bindKey: 'http:GET users/in.a', source: 'prod' });
  assert.deepEqual(refs.components, { 'svc:users': { refs: 2, endpoints: 2 } });
  assert.deepEqual(refs.origins['ing:auth/in.v'], { from: 'prod', at: 'T0', imported: false }, 'copied with its behaviour: from prod, not a reference');
});

test('a Full copy has no reference: the handler functions came along', () => {
  const rows = [hdr('users'), ing('users', 'in.a', 'a'), fn('users', 'a')];
  const refs = referencesOf(rows, originsOf(base(rows)), 'T0');
  assert.deepEqual([refs.endpoints, refs.components], [{}, {}]);
  assert.deepEqual(Object.keys(refs.origins), ['ing:users/in.a']);
});

test('a design-made endpoint with a dangling handler is not a reference (not designed yet); a handler of another service does not count', () => {
  const rows = [hdr('edge'), ing('edge', 'in.x', 'missing'), hdr('other'), fn('other', 'missing')];
  assert.deepEqual(referencesOf(rows, originsOf([]), 'T0'), { endpoints: {}, components: {}, origins: {} });
  const copied = referencesOf(rows, originsOf(base(rows)), 'T0');
  assert.ok(copied.endpoints['ing:edge/in.x'], 'the function must be in the same service');
});

test('an events-only consumer is a reference when none of its event handlers is here; one handler here is enough to make it designed', () => {
  const only = ing('users', 'in.q', '', { events: [{ type: 'A', handler: 'onA' }, { type: 'B', handler: 'onB' }] });
  const rows = [hdr('users'), only];
  assert.ok(referencesOf(rows, originsOf(base(rows)), 'T0').endpoints['ing:users/in.q']);
  const some = [hdr('users'), only, fn('users', 'onB')];
  assert.deepEqual(referencesOf(some, originsOf(base(some)), 'T0').endpoints, {});
});

test('an ingress with no handler at all is not a reference', () => {
  const rows = [hdr('users'), ing('users', 'in.n', '')];
  assert.deepEqual(referencesOf(rows, originsOf(base(rows)), 'T0').endpoints, {});
});

test('an import op of the draft gives the origin inDraft; imported = taken after the environment was copied', () => {
  const rows = [hdr('users'), ing('users', 'in.a', 'a'), fn('users', 'a'), ing('users', 'in.b', 'b'), fn('users', 'b')];
  const stored = base(rows.filter((r) => r.key !== 'in.b'));
  const imported = base(rows.filter((r) => r.key === 'in.b'), 'T1');
  const refs = referencesOf(rows, originsOf(stored, imported), 'T0');
  assert.deepEqual(refs.origins, { 'ing:users/in.a': { from: 'prod', at: 'T0', imported: false }, 'ing:users/in.b': { from: 'prod', at: 'T1', imported: true, inDraft: true } });
  const later = referencesOf(rows, originsOf([...stored, ...imported]), 'T0');
  assert.equal(later.origins['ing:users/in.b'].inDraft, undefined, 'after apply the origin is the baseline: no inDraft');
  assert.equal(later.origins['ing:users/in.b'].imported, true);
});
