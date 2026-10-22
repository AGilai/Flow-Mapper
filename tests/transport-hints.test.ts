// 0.30.4 (#70) transport hints: an undecided transport is a small icon on the arrow, or the text label when Transport hints is on. The pure parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { decodeHints, encodeHints, hintsDefault } from '../web/js/views/flow-hints-pure.js';
// @ts-ignore
import { markChips, chipsStack } from '../web/js/views/flow-marks-draw.js';

const q = (s: string) => new URLSearchParams(s);

test('th= in the URL: off in a design, on elsewhere, only written when it differs', () => {
  assert.equal(hintsDefault(true), false);
  assert.equal(hintsDefault(false), true);
  assert.equal(decodeHints(q(''), true), false);
  assert.equal(decodeHints(q(''), false), true);
  assert.equal(decodeHints(q('th=1'), true), true);
  assert.equal(decodeHints(q('th=0'), false), false);
  assert.equal(decodeHints(q('th=x'), true), false);
  assert.equal(encodeHints(false, true), null);
  assert.equal(encodeHints(true, true), '1');
  assert.equal(encodeHints(true, false), null);
  assert.equal(encodeHints(false, false), '0');
});

test('an undecided transport is an icon with hints off and the text chip with hints on; decided ones keep their label', () => {
  const msg = { transport: 'undecided' };
  assert.deepEqual(markChips(null, msg, true), [['transport not decided', 'tbd']]);
  assert.deepEqual(markChips(null, msg, false), [['transport not decided', 'tbd-i']]);
  assert.deepEqual(markChips(null, { transport: 'http' }, false), []);
  // the icon is small: with a draft chip beside it, it fits on an arrow where two text chips would stack
  const marks = { arrow: () => ({ inDraft: true, info: { mark: 'new' } }) };
  assert.equal(chipsStack(markChips(marks, msg, true), 240), true);
  assert.equal(chipsStack(markChips(marks, msg, false), 240), false);
});
