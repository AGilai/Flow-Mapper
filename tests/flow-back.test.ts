// 0.33.2: the way back from a sub-flow, pure (which tab, which step).
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { backTarget, noteOpened } from '../web/js/views/flow-back-pure.js';

const main = 'api-gateway/in.createOrder', sub = `order-events/shipping@${main}`;

test('backTarget: a remembered opening wins, a key origin is the fallback, a plain tab has none', () => {
  assert.deepEqual(backTarget(sub, new Map()), { key: main, step: null });
  const from = noteOpened(new Map(), sub, main, 7);
  assert.deepEqual(backTarget(sub, from), { key: main, step: 7 });
  const zoom = noteOpened(from, 'shipping/in.ship!intra', sub, 0);
  assert.deepEqual(backTarget('shipping/in.ship!intra', zoom), { key: sub, step: null });
  assert.equal(backTarget('fn:a/b!full', zoom), null);
  assert.equal(backTarget(main, zoom), null);
  assert.equal(backTarget(null, zoom), null);
});

test('noteOpened: never from itself or from nothing; never mutates', () => {
  const from = new Map();
  assert.equal(noteOpened(from, 'x/y', 'x/y', 3), from);
  assert.equal(noteOpened(from, 'x/y', null, 3), from);
  const next = noteOpened(from, 'x/y', 'a/b', 3);
  assert.equal(from.size, 0);
  assert.deepEqual(next.get('x/y'), { key: 'a/b', step: 3 });
});
