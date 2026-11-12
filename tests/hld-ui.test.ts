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

test('#113: the hazard button opens a balloon (dialog, aria-labelledby) that the X, Esc, an outside click or the button closes; no section is left in the pane', () => {
  const why = src('js/views/incomplete-why.js'), panel = src('js/views/flow-panel.js'), store = src('js/views/store-panel.js'), bal = src('js/views/incomplete-balloon.js'), css = src('css/incomplete.css');
  assert.match(why, /export function whyHazard/);
  assert.match(why, /'aria-expanded': 'false'/);
  assert.match(why, /'aria-controls': 'why-balloon'/);
  assert.match(why, /`Why incomplete: \$\{n\} blocked`/);
  assert.match(why, /if \(open\) \{ open\.close\(\); return; \}/, 'a second click closes');
  assert.doesNotMatch(panel, /why\?\.section/);
  assert.doesNotMatch(store, /why\?\.section/);
  assert.match(panel, /why\?\.btn/); assert.match(store, /whyHazard\(ctx\.trace\)/);
  assert.match(bal, /role: 'dialog', 'aria-labelledby': 'why-balloon-h'/);
  assert.match(bal, /'aria-label': 'Close'/);
  assert.match(bal, /e\.key === 'Escape'/);
  assert.match(bal, /pointerdown/);
  assert.match(bal, /anchor\.focus\(/, 'focus goes back to the hazard button');
  assert.match(bal, /x\.focus\(/, 'focus goes into the balloon');
  assert.match(css, /\.inc-balloon \{[^}]*z-index: 60/, 'above the Maximize pill (44)');
  assert.match(src('js/views/flow-tab-view.js'), /whySection\(trace\)\)/, 'the flow header badge still opens the pane with the box');
});

test('#113: placeBalloon keeps the balloon in the window: shifted, flipped above, clear of the Maximize pill', async () => {
  const { placeBalloon } = await import('../web/js/views/incomplete-balloon.js');
  const a = { left: 700, top: 90, right: 760, bottom: 112 };
  const p = placeBalloon({ anchor: a, vw: 1440, vh: 900 });
  assert.equal(p.side, 'below'); assert.equal(p.width, 360); assert.equal(p.top, 122); assert.ok(p.maxH <= 540);
  const edge = placeBalloon({ anchor: { left: 1390, top: 90, right: 1430, bottom: 112 }, vw: 1440, vh: 900 });
  assert.equal(edge.left + edge.width, 1432, 'shifted left to stay inside'); assert.ok(edge.arrowX > 300 && edge.arrowX <= 342, 'the arrow still points at the button');
  const narrow = placeBalloon({ anchor: { left: 600, top: 90, right: 640, bottom: 112 }, vw: 760, vh: 900 });
  assert.ok(narrow.left >= 8 && narrow.left + narrow.width <= 752);
  const phone = placeBalloon({ anchor: { left: 10, top: 90, right: 50, bottom: 112 }, vw: 320, vh: 700 });
  assert.equal(phone.width, 304); assert.equal(phone.left, 8);
  const flip = placeBalloon({ anchor: { left: 700, top: 560, right: 760, bottom: 580 }, vw: 1150, vh: 700 });
  assert.equal(flip.side, 'above'); assert.equal(flip.bottom, 700 - 560 + 10); assert.ok(flip.top === undefined);
  const pill = placeBalloon({ anchor: { left: 1300, top: 10, right: 1340, bottom: 30 }, vw: 1440, vh: 900, pill: { left: 1250, top: 14, right: 1422, bottom: 48 } });
  assert.ok(pill.top >= 56, 'below the pill');
});
