// 0.49.0 (#101): the Async flows list holds every derived flow, depth first, each its own top-level row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { asyncTree } from '../web/js/views/flow-async.js';

const idx = readFileSync(new URL('../web/js/views/flow-index.js', import.meta.url), 'utf8');
const render = readFileSync(new URL('../web/js/views/flow-render.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/css/flow-lane.css', import.meta.url), 'utf8');

test('the first trace already knows the nested rows: a depth-first walk lists 1, 2, 3, 3.1, 4 without any card open', () => {
  const t = trace(buildIndex(sampleModel()), { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full', maxMessages: 800 })!;
  const tree = asyncTree(t.messages);
  const walk = (groups: any[]): string[] => groups.flatMap((g) => g.rows.flatMap((r: any) => [r.label, ...walk(r.groups)]));
  assert.deepEqual(walk(tree.groups), ['1', '2', '3', '3.1', '4']);
});

test('flow-index lists derived rows recursively with a depth indent, a "from" hint and a nested-link chip', () => {
  assert.match(idx, /function emit\(r, g, depth, anc\)/);
  assert.match(idx, /r\.groups/);
  assert.match(idx, /from \$\{parentLabel\(row\)\}/);
  assert.match(idx, /button\.nest-chip/);
  assert.match(idx, /focusRow\(/);
  assert.match(css, /\.grp-rows > \.nested \{ margin-left: calc\(var\(--d, 0\) \* \d+px\); \}/);
});

test('a card diagram reveals rows in the top list (the down-arrow tile of a nested card)', () => {
  assert.match(render, /const top = \(\) => \(root \? root\(\) : index\)/);
  assert.match(render, /onNum: \(label\) => \{ top\(\)\?\.reveal\(label\); \}/);
  assert.match(render, /if \(!depth\) drawIndex\(\)/);
});
