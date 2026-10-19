// UI event-filter text: '!' entries render as exclusions, never as event names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain browser module
import { filterText } from '../web/js/format.js';

test('filterText renders exclusions as "all except"', () => {
  assert.equal(filterText('*'), 'all events');
  assert.equal(filterText(['a.b', 'c.d']), 'a.b, c.d');
  assert.equal(filterText(['!revision.status']), 'all except revision.status');
  assert.equal(filterText(['a.*', '!a.b', '!a.c']), 'a.* except a.b, a.c');
});
