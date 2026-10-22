// 0.34.0: the pure rules of the bottom pane (web/js/flow-pane/pure.js): tab choice, labels, splitter maths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS module shared with the browser
import { paneParam, initialTab, stepTab, countText, primaryLabel, dragHeight, maxPane, heightOf } from '../web/js/flow-pane/pure.js';

test('pane= is one of the three tabs, else null', () => {
  assert.equal(paneParam(new URLSearchParams('pane=notes')), 'notes');
  assert.equal(paneParam(new URLSearchParams('pane=actions&x=1')), 'actions');
  for (const bad of ['pane=other', 'pane=', 'x=1']) assert.equal(paneParam(new URLSearchParams(bad)), null);
});

test('initial tab: the URL, a comment link, the viewer\'s choice, then Notes when there are notes, else Comments', () => {
  assert.equal(initialTab({ param: 'actions', remembered: 'notes', hasNotes: true }), 'actions');
  assert.equal(initialTab({ comment: true, remembered: 'notes', hasNotes: true }), 'comments');
  assert.equal(initialTab({ remembered: 'actions', hasNotes: true }), 'actions');
  assert.equal(initialTab({ hasNotes: true }), 'notes');
  assert.equal(initialTab({ hasNotes: false }), 'comments');
  assert.equal(initialTab({ param: 'notes', available: ['comments', 'actions'] }), 'comments', 'a tab the pane does not have is ignored');
});

test('tab stepping wraps; labels and counts', () => {
  const t = ['notes', 'comments', 'actions'];
  assert.equal(stepTab(t, 'actions', 1), 'notes');
  assert.equal(stepTab(t, 'notes', -1), 'actions');
  assert.equal(countText('comments', { n: 6 }), '(6)');
  assert.equal(countText('comments', { n: 0 }), '');
  assert.equal(countText('actions', { open: 3, all: 5 }), '(3 open · 5)');
  assert.equal(countText('actions', { open: 3, all: 5 }, true), '3·5');
  assert.equal(countText('actions', {}), '');
  assert.equal(primaryLabel('notes'), '✎ Edit');
  assert.equal(primaryLabel('comments'), '+ Add comment');
  assert.equal(primaryLabel('actions', true), '+ Add');
});

test('splitter: dragging up grows the pane, clamped between the tab row and what leaves the diagram 120 px', () => {
  assert.deepEqual(dragHeight({ start: 300, dy: -50, min: 41, max: 500 }), { h: 350, collapsed: false });
  assert.deepEqual(dragHeight({ start: 300, dy: -900, min: 41, max: 500 }), { h: 500, collapsed: false });
  assert.deepEqual(dragHeight({ start: 300, dy: 900, min: 41, max: 500 }), { h: 41, collapsed: true });
  assert.equal(dragHeight({ start: 300, dy: 255, min: 41, max: 500 }).collapsed, true, 'within 8 px of the minimum folds to the tab row');
  assert.equal(maxPane({ tab: 800, others: 200 }), 480);
  assert.equal(maxPane({ tab: 200, others: 200 }), 0);
  assert.equal(heightOf('240'), 240); assert.equal(heightOf('x'), null); assert.equal(heightOf('5'), null); assert.equal(heightOf(null), null);
});
