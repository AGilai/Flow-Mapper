// #107 round 2 / #110: the diagram box always fits the window and owns both scrollbars, in the normal view and in Maximize. No DOM harness: the flex chain is checked from the sources
// (the measurements in a real browser are in the commit notes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-ignore plain JS module shared with the browser
import * as P from '../web/js/views/flow-headmin-pure.js';

const css = (f: string) => readFileSync(new URL(`../web/css/${f}`, import.meta.url), 'utf8');
const js = (f: string) => readFileSync(new URL(`../web/js/views/${f}`, import.meta.url), 'utf8');

test('the diagram box is a flex child with a small floor and no hard-coded height: the header box and the pane are capped, the box takes the rest', () => {
  const walk = css('flow-walk.css');
  assert.match(walk, /\.flow-tab > \.flow-body \{ min-height: clamp\(140px, 40%, 260px\); \}/);
  assert.doesNotMatch(walk, /\.flow-body \{ min-height: 260px/);
  assert.match(walk, /\.flow-top \{[^}]*max-height: max\(45%, 200px\)/);
  assert.match(css('flow-info.css'), /\.flow-top:has\(\.fab\) \{ max-height: max\(45%, 200px\); \}/);
  assert.match(css('flow-pane.css'), /\.flow-bottom \{ flex: 0 8 auto; min-height: 80px; max-height: 28vh;/);
  assert.match(css('sequence.css'), /\.seq-scroll \{ flex: 1; overflow: auto; overscroll-behavior: contain;/);
});

test('Maximize is the same flex column: the tab does not scroll, no display: contents, no vh arithmetic, no sticky bars', () => {
  const max = css('flow-max.css');
  assert.match(max, /body\.is-max \.flow-tab \{ overflow: hidden;/);
  assert.doesNotMatch(max, /display: contents/);
  assert.doesNotMatch(max, /100vh/);
  assert.doesNotMatch(max, /position: sticky/);
  assert.doesNotMatch(css('flow-pane.css'), /body\.is-max \.flow-bottom \{ display: block/);
  assert.doesNotMatch(css('flow-headmin.css'), /position: sticky/);
  assert.match(css('flow-pane.css'), /data-tab='notes'\]\) > \.flow-bottom \{ flex: 1 1 0; max-height: none; min-height: 0; \}/, 'the Notes document fills the window and scrolls inside');
});

test('step navigation scrolls the box only, and zoom anchors on the box', () => {
  const walk = js('flow-walk-view.js'), tab = js('flow-tab-view.js');
  assert.doesNotMatch(walk, /tab\.scrollTop/);
  assert.doesNotMatch(tab, /innerHeight/);
  assert.doesNotMatch(tab, /maxed\(\)/);
});

test('a zoomed head goes loose only when less than 80px of diagram would be left under it', () => {
  assert.equal(P.looseHead({ headH: 214, viewH: 233, zoom: 1.5 }), true);
  assert.equal(P.looseHead({ headH: 214, viewH: 400, zoom: 1.5 }), false);
  assert.equal(P.looseHead({ headH: 214, viewH: 233, zoom: 1 }), false, 'normal zoom: always pinned');
});
