// Unreleased: the design doc index (width clamp, stored state, default collapse on a narrow window).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampIndexWidth, parseIndexState, indexCollapsed, IX_DEFAULT } from '../core/index-pane.ts';

test('width is clamped to 140-480 and junk gives 200', () => {
  assert.equal(clampIndexWidth(50), 140);
  assert.equal(clampIndexWidth(900), 480);
  assert.equal(clampIndexWidth(301.4), 301);
  assert.equal(clampIndexWidth('x'), IX_DEFAULT);
  assert.equal(clampIndexWidth(undefined), IX_DEFAULT);
});

test('stored state parses defensively', () => {
  assert.deepEqual(parseIndexState('{"w":320,"collapsed":true}'), { w: 320, collapsed: true });
  assert.deepEqual(parseIndexState('{"w":9999}'), { w: 480, collapsed: null });
  assert.deepEqual(parseIndexState('nope'), { w: 200, collapsed: null });
  assert.deepEqual(parseIndexState(null), { w: 200, collapsed: null });
});

test('collapsed default depends on the window, a choice wins', () => {
  assert.equal(indexCollapsed({ w: 200, collapsed: null }, 1000), true);
  assert.equal(indexCollapsed({ w: 200, collapsed: null }, 1600), false);
  assert.equal(indexCollapsed({ w: 200, collapsed: false }, 1000), false);
  assert.equal(indexCollapsed({ w: 200, collapsed: true }, 1600), true);
});
