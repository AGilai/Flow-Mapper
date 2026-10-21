// The pure parts of the relation UI (web/js/views/flow-relations-pure.js, flow-list-filter.js): counts, the Flows list filter, the form's choices and edit, the picker.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choiceOf, parseRel, pickMatches, RELATION_CHOICES, relationEdit, relCounts, relOptions, relPasses, relTitle } from '../web/js/views/flow-relations-pure.js';
import { filterPoints, filterSummary } from '../web/js/views/flow-list-filter.js';

const f = (service: string, ingress: string) => ({ service, ingress });
const views = [
  { id: 'r1', type: 'contradicts', from: f('a', 'i'), to: f('b', 'j') }, { id: 'r2', type: 'supersedes', from: f('a', 'i'), to: f('c', 'k') },
  { id: 'r3', type: 'contradicts', from: f('c', 'k'), to: f('d', 'l') },
];
const points = ['a/i', 'b/j', 'c/k', 'd/l', 'e/m'].map((k) => { const [service, id] = k.split('/'); return { service, id, bindKey: `http:GET ${k}`, handler: 'h', name: `Flow ${k}` }; });

test('relCounts: each flow gets the count of every type it is in, from either end', () => {
  const m = relCounts(views);
  assert.deepEqual(m.get('a/i'), { contradicts: 1, supersedes: 1 }); assert.deepEqual(m.get('c/k'), { supersedes: 1, contradicts: 1 }); assert.deepEqual(m.get('b/j'), { contradicts: 1 });
  assert.equal(m.get('e/m'), undefined); assert.equal(relCounts(null).size, 0);
  assert.equal(relTitle(m.get('a/i')), '2 related flows: 1 contradicts, 1 supersedes'); assert.equal(relTitle(m.get('b/j')), '1 related flow: 1 contradicts');
});

test('the list filter: parseRel keeps a type or any; relPasses; the options list only the types in use, with the number of flows', () => {
  assert.deepEqual(['any', 'contradicts', 'rhymes', '', null].map(parseRel), ['any', 'contradicts', null, null, null]);
  const m = relCounts(views);
  assert.equal(relPasses(m.get('a/i'), null), true); assert.equal(relPasses(undefined, 'any'), false); assert.equal(relPasses(m.get('b/j'), 'supersedes'), false); assert.equal(relPasses(m.get('c/k'), 'supersedes'), true);
  assert.deepEqual(relOptions(m).map((o) => [o.value, o.n]), [['', null], ['any', 4], ['contradicts', 4], ['supersedes', 2]]);
});

test('filterPoints and filterSummary take the relation filter; with none selected nothing changes', () => {
  const relBy = relCounts(views);
  assert.equal(filterPoints(points, {}).length, 5);
  assert.deepEqual(filterPoints(points, { rel: 'any', relBy }).map((p) => p.id), ['i', 'j', 'k', 'l']);
  assert.deepEqual(filterPoints(points, { rel: 'supersedes', relBy }).map((p) => p.id), ['i', 'k']);
  assert.deepEqual(filterPoints(points, { rel: 'contradicts', relBy, q: 'flow b' }).map((p) => p.id), ['j'], 'combines with the text');
  assert.equal(filterSummary({ subs: null, comps: null, subRows: [], compRows: [], changed: null, q: '', rel: 'supersedes' }), 'supersedes');
  assert.equal(filterSummary({ subs: null, comps: null, subRows: [], compRows: [], changed: null, q: '', rel: 'any' }), 'related');
});

test('the form reads from this flow: six phrasings; "is superseded by" and "has a variant" swap the ends; choiceOf reads a view back', () => {
  const here = f('a', 'i'), other = f('b', 'j');
  const sent = (choice: string) => relationEdit({ here, other, choice, note: ' n ' });
  assert.deepEqual(sent('supersedes'), { kind: 'flow-relation', from: here, to: other, type: 'supersedes', note: 'n' });
  assert.deepEqual([sent('superseded-by').from, sent('superseded-by').to, sent('superseded-by').type], [other, here, 'supersedes']);
  assert.deepEqual([sent('has-variant').from, sent('has-variant').type], [other, 'variant-of']);
  assert.deepEqual([sent('variant-of').from, sent('contradicts').type, sent('same-topic').type], [here, 'contradicts', 'same-topic']);
  assert.equal(relationEdit({ id: 'r9', here, other, choice: 'contradicts', note: '' }).id, 'r9');
  assert.throws(() => relationEdit({ here, other: null, choice: 'contradicts' }), (e: any) => e.field === 'other');
  assert.throws(() => relationEdit({ here, other, choice: 'nope' }), (e: any) => e.field === 'type');
  const read = (type: string, direction: string) => choiceOf({ type, direction }).value;
  assert.deepEqual([read('supersedes', 'out'), read('supersedes', 'in'), read('variant-of', 'out'), read('variant-of', 'in'), read('contradicts', 'in'), read('same-topic', 'in')], ['supersedes', 'superseded-by', 'variant-of', 'has-variant', 'contradicts', 'same-topic']);
  assert.equal(RELATION_CHOICES.length, 6);
});

test('pickMatches: by name, component, endpoint or bind key; never this flow; at most max', () => {
  const here = f('a', 'i');
  assert.deepEqual(pickMatches(points, '', { here }).map((p) => p.id), ['j', 'k', 'l', 'm']);
  assert.deepEqual(pickMatches(points, 'FLOW c', { here }).map((p) => p.id), ['k']);
  assert.deepEqual(pickMatches(points, 'get d/l', { here }).map((p) => p.id), ['l']);
  assert.equal(pickMatches(points, '', { here, max: 2 }).length, 2);
});
