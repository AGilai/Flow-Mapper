// #109 (the checkbox pref), #111 (an arrow for a call wholly inside a fold column), #113 (the Why incomplete hazard button): the pure parts and source checks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eventCols, foldedInside } from '../web/js/views/flow-squeeze.js';
import { mergeStored, mergeSave } from '../web/js/views/flow-prefs.js';

const src = (f: string) => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');

test('#109: "One arrow per target" is on unless the viewer turned it off; its request key tells the two views apart', async () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
  assert.equal(mergeStored(), true);
  mergeSave(false); assert.equal(mergeStored(), false);
  mergeSave(true); assert.equal(mergeStored(), true);
  delete (globalThis as any).localStorage;
  const { requestKey } = await import('../web/js/views/flow-sub.js');
  assert.notEqual(requestKey({ service: 's', ingress: 'i', detail: 'simple' }), requestKey({ service: 's', ingress: 'i', detail: 'simple', merge: '1' }));
  assert.match(src('js/views/flow-merge-check.js'), /One arrow per target/);
  assert.match(src('js/views/flow-tab-data.js'), /merge: detail === 'simple' && getOpts\(\)\.merge/);
});

test('#111: a call between two lifelines of one fold column is wholly inside it, and the fold draws an arrow for it', () => {
  const idx = new Map([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
  const groups = [{ from: 2, to: 3, cols: [2, 3] }];
  const call = { type: 'call', from: 'c', to: 'd' };
  assert.deepEqual(eventCols(call, idx), [2, 3]);
  assert.equal(foldedInside(eventCols(call, idx), groups), 0);
  assert.equal(foldedInside(eventCols({ type: 'call', from: 'b', to: 'd' }, idx), groups), -1, 'a caller outside the fold: the edge arrow of foldRows');
  const f = src('js/views/flow-draw-fold.js');
  assert.match(f, /function inFold\(e, r, y0, g, idx\)/);
  assert.match(f, /sq-arr/);
});

test('#113: "Why incomplete" is a collapsed section after the call data, opened by a hazard button with aria-expanded and the tooltip "Why incomplete: N blocked"; the store panel has the same button', () => {
  const why = src('js/views/incomplete-why.js'), panel = src('js/views/flow-panel.js'), store = src('js/views/store-panel.js');
  assert.match(why, /export function whyHazard/);
  assert.match(why, /section\.hidden = true/, 'collapsed by default');
  assert.match(why, /'aria-expanded': 'false'/);
  assert.match(why, /`Why incomplete: \$\{n\} blocked`/);
  assert.doesNotMatch(panel, /whySection\(trace/, 'no longer first in the body');
  assert.match(panel, /why\?\.btn/);
  assert.ok(panel.indexOf('why?.section') > panel.indexOf('dto,'), 'after the call data');
  assert.match(store, /whyHazard\(ctx\.trace\)/);
  assert.match(src('js/views/flow-tab-view.js'), /whySection\(trace\)\)/, 'the flow header badge still opens the box expanded');
});
