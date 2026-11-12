// #109 (the checkbox pref), #111 (an arrow for a call wholly inside a fold column), #112 (the entry-point list is a 36px band, never gone): the pure parts and source checks.

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
  assert.match(src('js/views/flows.js'), /One arrow per target/);
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

test('#112: the collapsed entry-point list is a 36px band with the chevron (aria-expanded=false, "Show entry points") and the count; a side panel leaves the band, not nothing', () => {
  const css = src('css/sequence.css'), lane = src('css/flow-lane.css'), list = src('js/views/flow-list.js');
  assert.match(css, /\.flows\.list-c \{ grid-template-columns: 36px/);
  assert.match(css, /\.fl-count/);
  assert.match(list, /'Show entry points'/);
  assert.match(list, /aria-expanded', String\(!c\)/);
  assert.doesNotMatch(lane, /\.flows\.fi-open > \.flows-list, \.flows\.mp-open > \.flows-list \{ display: none; \}/);
  assert.match(lane, /fi-open:not\(\.list-open\)[^{]*\{ grid-template-columns: 36px/);
});
