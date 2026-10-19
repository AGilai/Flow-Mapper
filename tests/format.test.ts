// UI event-filter text: '!' entries render as exclusions, never as event names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain browser module
import { filterText, egressGroupLabel } from '../web/js/format.js';

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
