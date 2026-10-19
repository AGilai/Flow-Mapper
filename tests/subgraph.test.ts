import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withinHops } from '../core/subgraph.ts';

const edges = [{ from: 'a', to: 'b' }, { from: 'c', to: 'b' }, { from: 'c', to: 'd' }, { from: 'd', to: 'e' }];

test('withinHops expands undirected, one ring per hop', () => {
  assert.deepEqual([...withinHops(['a'], edges, 0)], ['a']);
  assert.deepEqual([...withinHops(['a'], edges, 1)].sort(), ['a', 'b']);
  assert.deepEqual([...withinHops(['a'], edges, 2)].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...withinHops(['a'], edges, 3)].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual([...withinHops(['a', 'e'], edges, 1)].sort(), ['a', 'b', 'd', 'e']);
  assert.deepEqual([...withinHops([], edges, 2)], []);
});
