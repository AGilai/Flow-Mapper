// #106 round 2: the View popover of the minimized flow header and the page chrome it hides (web/js/views/flow-headmin-pop.js, flow-headmin.css). No DOM harness: pure placement plus source checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-ignore plain JS module shared with the browser
import * as P from '../web/js/views/flow-headmin-pure.js';

const src = (f: string) => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');

test('the View popover sits under its button, at most 560px wide, always inside the window', () => {
  assert.deepEqual(P.popPlace({ rect: { bottom: 80, right: 1360 }, vw: 1380, vh: 900 }), { top: 84, right: 20, width: 560, maxHeight: 808 });
  const n = P.popPlace({ rect: { bottom: 190, right: 740 }, vw: 760, vh: 800 });
  assert.equal(n.width, 560); assert.equal(P.popPlace({ rect: { bottom: 50, right: 380 }, vw: 400, vh: 700 }).width, 384, 'narrower than 560: the window minus margins'); assert.ok(n.right >= 8 && n.right + n.width <= 760 - 8, 'inside the viewport at 760');
  assert.ok(P.popPlace({ rect: { bottom: 780, right: 700 }, vw: 760, vh: 800 }).maxHeight >= 120);
});

test('wiring: minimized hides the page head, toolbar and Harvested line; the popover moves the real nodes and gives them back; the env chip is nowrap', () => {
  const css = src('css/flow-headmin.css');
  assert.match(css, /body\.head-min \.main:has\(\.flows \.tab-slot\) > \.page-head, body\.head-min \.flows-main:has\(\.tab-slot\) > \.seq-toolbar, body\.head-min \.flows-main:has\(\.tab-slot\) > \.pen-hint \{ display: none; \}/);
  const hm = src('js/views/flow-headmin.js');
  assert.match(hm, /classList\.toggle\('head-min', on\)/); assert.match(hm, /if \(!on\) closeViewPop\(\)/); assert.match(hm, /viewButton\(\)/);
  const pop = src('js/views/flow-headmin-pop.js');
  assert.match(pop, /'aria-haspopup'/); assert.match(pop, /'aria-expanded': 'false'/); assert.match(pop, /icon\('sliders'\)/);
  assert.match(pop, /node\.replaceWith\(mark\)/); assert.match(pop, /p\.mark\.replaceWith\(p\.node\)/, 'put back on close');
  assert.match(pop, /key === 'Escape'/); assert.match(pop, /pointerdown/); assert.match(pop, /if \(open\) closeViewPop\(\); else openViewPop/, 'a second press closes');
  assert.doesNotMatch(pop, /cloneNode/, 'moved, never copied');
  assert.match(src('css/env-color.css'), /\.env-chip \{[^}]*white-space: nowrap/);
  assert.doesNotMatch(src('css/layout.css'), /\.rail-c \.env-chip/, 'the rail rules reach the sidebar button only, not the page chip');
});

test('QA fixes: the popover survives a re-keyed tab, Maximize hides the View button, a cached About text does not break a re-made tab', () => {
  assert.match(src('js/views/flow-headmin.js'), /queueMicrotask\(\(\) => \{ if \(!document\.querySelector\('\.flows \.tab-slot'\)\) closeViewPop\(\)/);
  assert.match(src('css/flow-headmin.css'), /body\.is-max \.hs-view \{ display: none; \}/);
  assert.match(src('js/views/flow-head.js'), /built = true; paint\(\);/);
});
