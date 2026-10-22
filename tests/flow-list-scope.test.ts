// #65: in a design the Flows list shows flows only (a name, a description or entryPoint: true) unless "All endpoints" is on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFlowPoint, scopePoints } from '../web/js/views/flow-list-filter.js';

const pts = [
  { service: 'a', id: 'in.named', name: 'Login' },
  { service: 'a', id: 'in.described', summary: 'Opens a tunnel' },
  { service: 'a', id: 'in.marked', entryPoint: true },
  { service: 'b', id: 'in.copied', entryPoint: false },
];

test('a flow has a name, a description or entryPoint: true', () => {
  assert.deepEqual(pts.filter(isFlowPoint).map((p) => p.id), ['in.named', 'in.described', 'in.marked']);
});

test('only a design list without a component and without endpoints=all is scoped', () => {
  assert.equal(scopePoints(pts, { design: true, service: null, all: false }).length, 3);
  assert.equal(scopePoints(pts, { design: true, service: null, all: true }).length, 4);
  assert.equal(scopePoints(pts, { design: true, service: 'b', all: false }).length, 4, 'a component lists its own endpoints');
  assert.equal(scopePoints(pts, { design: false, service: null, all: false }).length, 4, 'harvested envs are unchanged');
});
