// Unreleased (#106 minimized flow header, #107 pinned component heads): the pure parts (web/js/views/flow-headmin-pure.js) and the wiring, read from the sources (no DOM harness exists).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-ignore plain JS module shared with the browser
import * as P from '../web/js/views/flow-headmin-pure.js';

const src = (f: string) => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');
const key = (k: string, extra: any = {}) => ({ key: k, target: { tagName: 'DIV' }, ...extra });
const mem = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, m }; };
const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };

test('H toggles, unless the caret is in a field or editor, a dialog is open, a modifier is held or the key was handled', () => {
  assert.equal(P.headKeyAction(key('h')), 'toggle');
  assert.equal(P.headKeyAction(key('H')), 'toggle');
  assert.equal(P.headKeyAction(key('x')), null);
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(P.headKeyAction(key('h', { target: { tagName } })), null);
  assert.equal(P.headKeyAction(key('h', { target: { tagName: 'DIV', isContentEditable: true } })), null);
  assert.equal(P.headKeyAction(key('h'), { dialogOpen: true }), null);
  for (const m of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) assert.equal(P.headKeyAction(key('h', { [m]: true })), null, m);
});

test('the choice is one stored value, "1" = minimized; broken storage means "not minimized" and never throws', () => {
  assert.equal(P.HEADMIN_KEY, 'flow-mapper.headMin');
  assert.equal(P.loadHeadMin(mem()), false);
  const st = mem();
  P.saveHeadMin(true, st); assert.equal(st.m.get('flow-mapper.headMin'), '1'); assert.equal(P.loadHeadMin(st), true);
  P.saveHeadMin(false, st); assert.equal(st.m.get('flow-mapper.headMin'), '0'); assert.equal(P.loadHeadMin(st), false);
  assert.equal(P.loadHeadMin(mem({ 'flow-mapper.headMin': 'yes' })), false);
  assert.equal(P.loadHeadMin(broken as any), false);
  assert.doesNotThrow(() => P.saveHeadMin(true, broken as any));
});

test('the strip step nav reads "2/44" and says "Step 2 of 44" to a screen reader', () => {
  assert.equal(P.stepShort(2, 44), '2/44'); assert.equal(P.stepShort(0, 44), '–/44');
  assert.equal(P.stepWords(2, 44), 'Step 2 of 44'); assert.equal(P.stepWords(0, 44), '44 steps, none chosen');
});

test('#107 a head goes loose only when zoomed in and taller than 80% of the view: a normal head on a short scroller stays pinned', () => {
  assert.equal(P.looseHead({ headH: 182, viewH: 260, zoom: 1 }), false, 'the bug: 182 of 260 made the old 35% line scroll the head away');
  assert.equal(P.looseHead({ headH: 250, viewH: 260, zoom: 1 }), false, 'normal zoom is never loose');
  assert.equal(P.looseHead({ headH: 220, viewH: 300, zoom: 1.5 }), false, '80px of diagram left is enough');
  assert.equal(P.looseHead({ headH: 221, viewH: 300, zoom: 1.5 }), true);
  assert.equal(P.looseHead({ headH: 400, viewH: 300, zoom: 0.5 }), false, 'zoomed out: pinned');
  assert.equal(P.looseHead({ headH: 400, viewH: 300 }), false, 'no zoom given: pinned');
});

test('wiring: loose() uses the pure rule, the strip sits before the header box, the key and toggle are wired, the max box scrolls inside itself', () => {
  const tab = src('js/views/flow-tab-view.js');
  assert.match(tab, /looseHead\(\{ headH: sk\.offsetHeight, viewH: scroller\.clientHeight, zoom: factor \}\)/);
  assert.doesNotMatch(tab, /\* 0\.35/, 'the 35% line is gone');
  assert.match(tab, /h\('div\.flow-tab', maxBar, backBar, xnote, hm\.strip, h\('div\.flow-top'/);
  assert.match(tab, /summary: \[hm\.button\(\), root/); assert.match(tab, /ts\.ui\.el, host\.max\?\.button\(\)/);
  const hm = src('js/views/flow-headmin.js');
  assert.match(hm, /'Expand flow header'/); assert.match(hm, /'aria-expanded': 'false'/);
  assert.match(hm, /'Collapse flow header'/); assert.match(hm, /icon\('chevup'\)/); assert.match(hm, /icon\('chevdown'\)/);
  assert.match(hm, /addEventListener\('keydown', onKey\)/); assert.match(hm, /headKeyAction/);
  assert.match(hm, /stepShort/); assert.match(hm, /walk\?\.move\('prev'\)/); assert.match(hm, /walk\?\.move\('next'\)/);
  assert.match(hm, /host\.max\?\.button\(\)/, 'Maximize stays reachable from the strip');
  const css = src('css/flow-headmin.css');
  assert.match(css, /\.flow-tab\.head-min > \.flow-top \{ display: none; \}/);
  assert.match(css, /height: 36px/); assert.match(css, /white-space: nowrap/);
  assert.match(css, /--ec/, 'the env colour cue');
  assert.doesNotMatch(css, /:\s*[^;{]*#[0-9a-fA-F]{3,8}\b[^;{]*;/, 'tokens only');
  assert.match(src('index.html'), /css\/flow-headmin\.css/);
});
