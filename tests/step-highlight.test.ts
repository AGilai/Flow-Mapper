// 0.32.5: the current-step highlight toggle: URL form (`hl=0` is off, anything else or nothing is on / remembered), and the band that replaced the bordered halo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-ignore plain JS modules shared with the browser
import { decodeHl, encodeHl } from '../web/js/views/step-details-pure.js';

test('hl= in the URL: 0 is off, absent defers to the remembered choice, anything else is on', () => {
  assert.equal(decodeHl(new URLSearchParams('')), null);
  assert.equal(decodeHl(new URLSearchParams('hl=0')), false);
  assert.equal(decodeHl(new URLSearchParams('hl=1')), true);
  assert.equal(decodeHl(new URLSearchParams('hl=')), true);
});

test('hl is left out of the URL when on', () => {
  assert.equal(encodeHl(true), null);
  assert.equal(encodeHl(false), '0');
});

test('the band is a filled rect from a token, with no stroke; the old bordered halo is gone', () => {
  const css = readFileSync(new URL('../web/css/flow-walk.css', import.meta.url), 'utf8'), tokens = readFileSync(new URL('../web/css/tokens.css', import.meta.url), 'utf8');
  assert.match(css, /\.stepband \{ fill: var\(--step-hl\); stroke: none; \}/);
  assert.doesNotMatch(css, /stephalo/);
  assert.equal((tokens.match(/--step-hl:/g) ?? []).length, 3, 'light, and the two dark blocks');
});
