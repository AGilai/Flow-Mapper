// Step labels (#76, 0.32.1): the Arrows default per environment kind, and no raw tbd: key on an arrow.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { callLabel } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { arrowsDefault, decodeArrows, encodeArrows, arrowParts } from '../web/js/views/step-details-pure.js';

test('#76: the Arrows default is Title for a design (API when a step has no title) and API for a harvested environment; sd= is omitted at the default', () => {
  assert.equal(arrowsDefault(true), 't'); assert.equal(arrowsDefault(false), 'a');
  const q = (s: string) => new URLSearchParams(s);
  assert.equal(decodeArrows(q(''), 't'), null);
  assert.equal(decodeArrows(q('sd='), 't'), 't'); assert.equal(decodeArrows(q('sd=a'), 't'), 'a');
  assert.equal(encodeArrows('t', 't'), null); assert.equal(encodeArrows('a', 't'), 'a'); assert.equal(encodeArrows('a'), null); assert.equal(encodeArrows('t'), 't');
  assert.deepEqual([arrowParts('t', { title: 'Create', desc: '' }).api, arrowParts('t', { title: 'Create', desc: '' }).title], [false, true], 'a title replaces the API');
  assert.deepEqual([arrowParts('t', { title: '', desc: '' }).api, arrowParts('t', { title: '', desc: '' }).title], [true, false], 'no title: the API line');
});

test('#76: a tbd: bind key is never a label: the operation name, else the key\'s last part; the key stays in message.label', () => {
  const m = { kind: 'egress', transport: 'undecided', label: 'tbd:pop-policy-cache/policy-get' };
  assert.equal(callLabel(m), 'policy-get');
  assert.equal(callLabel({ ...m, operation: 'Fetch policy', label: 'Fetch policy tbd:pop-policy-cache/policy-get' }), 'Fetch policy');
  assert.equal(callLabel({ kind: 'egress', transport: 'http', label: 'http:POST orders-svc/orders' }), 'POST /orders');
});

