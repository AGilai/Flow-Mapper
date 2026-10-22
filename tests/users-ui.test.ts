// The Users page rules (0.31.0): which user survives a merge by default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { survivor } from '../web/js/views/users-pure.js';

const u = (id: string, name: string, ext = 0, n = 0) => ({ id, name, externalIds: Array.from({ length: ext }, (_, i) => ({ source: 'confluence', externalId: String(i) })), counts: { comments: n, items: 0, mentions: 0 } });

test('survivor: external ids first, then more activity', () => {
  assert.equal(survivor(u('a', 'A', 0, 14), u('b', 'B', 1, 2)).id, 'b');
  assert.equal(survivor(u('a', 'A', 0, 14), u('b', 'B', 0, 2)).id, 'a');
  assert.equal(survivor(u('a', 'A', 1, 0), u('b', 'B', 1, 0)).id, 'a'); // a tie keeps the first
});

