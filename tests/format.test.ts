// UI event-filter text: '!' entries render as exclusions, never as event names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain browser module
import { filterText, egressGroupLabel, ttlText, opsText } from '../web/js/format.js';

test('TTL and ops/h read the way people say them', () => {
  assert.deepEqual([45, 60, 900, 1800, 3600, 86400, 100, 1500].map(ttlText), ['45 s', '60 s', '15 min', '30 min', '1 h', '24 h', '100 s', '25 min']);
  assert.deepEqual([310, 4200, 220000, null].map(opsText), ['310', '4.2k', '220k', '']);
});

test('filterText renders exclusions as "all except"', () => {
  assert.equal(filterText('*'), 'all events');
  assert.equal(filterText(['a.b', 'c.d']), 'a.b, c.d');
  assert.equal(filterText(['!revision.status']), 'all except revision.status');
  assert.equal(filterText(['a.*', '!a.b', '!a.c']), 'a.* except a.b, a.c');
});

test('egressGroupLabel counts confirmed targets and shows maybes apart', () => {
  const maybes = (...n: string[]) => [{ maybeTargets: n.map((service) => ({ service })) }];
  const twelve = Array.from({ length: 12 }, (_, i) => `s${i}`);
  assert.equal(egressGroupLabel('Maybe ' + twelve.join(', '), maybes(...twelve)), 'Fan-out to 0 (12 maybe)');
  assert.equal(egressGroupLabel('a, b, c', maybes(...twelve)), 'Fan-out to 3 services (+12 maybe)');
  assert.equal(egressGroupLabel('a, b', maybes('a', 'x')), 'Fan-out to 2 services (+1 maybe)');
  assert.equal(egressGroupLabel('a', maybes('x')), 'a (+1 maybe)');
  assert.equal(egressGroupLabel('a, b', [{ maybeTargets: [] }]), 'Fan-out to 2 services');
});
