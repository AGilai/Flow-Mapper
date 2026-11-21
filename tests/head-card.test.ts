// #149: what a click on a lifeline head does, which heads get the ⋮ and the hover card, and what the card says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headAction, hasMore, headCardable, firstSection, headCardModel } from '../web/js/views/head-card-pure.js';
import { aboutSections } from '../core/about-sections.ts';
import { stripMarkdown } from '../core/markdown-strip.ts';

const svc = { kind: 'service', service: 'a', label: 'a' }, fan = { kind: 'source', fan: { topic: 't' } }, store = { kind: 'resource', storeKind: 'redis', group: 'redis:c', label: 'c' };

test('a click: a service opens the info pane; fan and store heads keep theirs; others do nothing', () => {
  assert.equal(headAction(svc), 'info');
  assert.equal(headAction(fan), 'fan');
  assert.equal(headAction(store, { storeOn: true }), 'store');
  assert.equal(headAction(store), null);
  assert.equal(headAction({ kind: 'plain', label: 'x' }), null);
});

test('the ⋮ and the card: component heads only; fans, stores, client-app triggers and caller lists keep their own', () => {
  assert.ok(hasMore(svc) && headCardable(svc));
  assert.ok(!hasMore(fan) && !headCardable(fan) && !headCardable(store));
  assert.ok(!headCardable({ ...svc, trigger: 'on tap' }) && !headCardable({ ...svc, callers: ['x'] }));
});

const md = '## Purpose\nHolds the **keys**. Rotated daily.\n\n## Owners\n- platform';
test('the card shows the first About section, stripped; else the description; else nothing', () => {
  assert.deepEqual(firstSection(aboutSections(md), stripMarkdown), { heading: 'Purpose', text: 'Holds the keys. Rotated daily.' });
  assert.deepEqual(firstSection(aboutSections('Just text\n\n## B\nx'), stripMarkdown), { heading: '', text: 'Just text' });
  assert.equal(firstSection(aboutSections('## Empty\n\n## B\nsecond'), stripMarkdown)?.heading, 'B');
  const m = headCardModel({ name: 'a', type: 'Service', sections: aboutSections(md), description: 'desc' }, stripMarkdown);
  assert.equal(m.fallback, 'about'); assert.equal(m.text, 'Holds the keys. Rotated daily.');
  const d = headCardModel({ name: 'a', type: 'Lambda', sections: [], description: 'A **d**' }, stripMarkdown);
  assert.deepEqual([d.fallback, d.text, d.empty], ['description', 'A d', false]);
  assert.equal(headCardModel({ name: 'a', type: 'Service', sections: [], description: undefined }, stripMarkdown).empty, true);
});
