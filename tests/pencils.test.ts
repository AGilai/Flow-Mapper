// 0.31.1 "Edit where you read": the draft choice of a pencil click, which items carry a pencil in which kind of environment, the hint, the About landing spot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { draftChoice, pencilAllowed, pencilItems, harvestedHint, sectionOffset, pencilLabel } from '../web/js/design/pencil-pure.js';

const d = (slug: string) => ({ slug, name: slug, counts: { added: 0, removed: 0, changed: 0 }, authors: [] });

test('no open draft: offer "my edits"; one: use it; several: pick, the last used first', () => {
  assert.deepEqual(draftChoice([]), { kind: 'start', name: 'my edits' });
  assert.deepEqual(draftChoice(null), { kind: 'start', name: 'my edits' });
  assert.deepEqual(draftChoice([d('a')]), { kind: 'use', draft: d('a') });
  assert.deepEqual(draftChoice([d('a')], 'zzz'), { kind: 'use', draft: d('a') });
  const many = draftChoice([d('a'), d('b'), d('c')], 'b') as any;
  assert.equal(many.kind, 'pick');
  assert.deepEqual(many.drafts.map((x: any) => x.slug), ['b', 'a', 'c']);
  assert.deepEqual((draftChoice([d('a'), d('b')]) as any).drafts.map((x: any) => x.slug), ['a', 'b']);
});

test('a design environment gives every item a pencil', () => {
  for (const k of ['header', 'docs', 'about', 'about-section', 'owners', 'endpoint', 'flow', 'inventory', 'subsystem', 'panel-component', 'panel-subsystem', 'panel-flow', 'flow-description', 'step-description']) {
    assert.equal(pencilAllowed(k, true), true, k);
  }
  assert.equal(pencilAllowed('nonsense', true), false);
});

test('a harvested environment gives only the annotation pencils, and one hint', () => {
  assert.deepEqual(pencilItems(false), ['flow-description', 'step-description']);
  for (const k of ['header', 'docs', 'about', 'about-section', 'owners', 'endpoint', 'flow', 'inventory', 'subsystem', 'panel-component']) assert.equal(pencilAllowed(k, false), false, k);
  assert.equal(harvestedHint(false), 'Harvested — edit at the source');
  assert.equal(harvestedHint(true), null);
});

test('an About section is found by its heading; the label reads "Edit <thing>"', () => {
  const t = '## Capabilities\n- one\n\n### Roles\nx\n## Owners ##\nme';
  assert.equal(sectionOffset(t, 'Capabilities'), 0);
  assert.equal(sectionOffset(t, 'roles'), t.indexOf('### Roles'));
  assert.equal(sectionOffset(t, 'Owners'), t.indexOf('## Owners'));
  assert.equal(sectionOffset(t, 'Missing'), -1);
  assert.equal(sectionOffset('', 'x'), -1);
  assert.equal(pencilLabel('pop-swg'), 'Edit pop-swg');
});
