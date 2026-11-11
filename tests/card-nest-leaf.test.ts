// 0.48.1 (#100): an async card holding a leaf flow (no async of its own, e.g. 1.1) must show its nested card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/css/flow-lane.css', import.meta.url), 'utf8');
const idx = readFileSync(new URL('../web/js/views/flow-index.js', import.meta.url), 'utf8');

test('.card-nest hides only when its OWN index is empty (direct child), not when a nested leaf card has an empty one', () => {
  const rule = css.match(/^\.card-nest:empty[^{]*\{[^}]*\}/m)?.[0] ?? '';
  assert.match(rule, /\.card-nest:has\(> \.flow-idx:empty\)/);
  assert.doesNotMatch(rule, /:has\(\.flow-idx/); // the descendant form matched the leaf card's empty index too
  assert.match(css, /^\.flow-idx:empty \{ display: none; \}/m);
});

test('0.49.0 (#101): a card holds only its flow; the list is flat at the top level', () => {
  assert.match(idx, /h\('div\.card-lane', f\.laneBox\)\);/);
  assert.doesNotMatch(idx, /f\.idxBox/);
});
