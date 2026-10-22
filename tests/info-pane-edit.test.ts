// 0.33.0 info pane, editing the About in place (frame 19d): the template of an empty about, the toolbar's insertions, the dirty check, and the edit a Save sends
// (accepted by the draft edit API for a component and a subsystem; harvested environments refuse, so the pane stays read-only there).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { TEMPLATE, TEMPLATE_CARET, ABOUT_MAX, wantsTemplate, isDirty, applyFormat, aboutEdit, lineOf } from '../web/js/pane/pane-edit-pure.js';
// @ts-ignore
import { pencilAllowed } from '../web/js/design/pencil-pure.js';
import { aboutSections, openQuestions } from '../core/about-sections.ts';

test('the template is offered only for an empty about, has the five sections, and puts the caret in the first bullet', () => {
  assert.equal(wantsTemplate(''), true);
  assert.equal(wantsTemplate('  \n '), true);
  assert.equal(wantsTemplate(undefined), true);
  assert.equal(wantsTemplate('## Owners\nx'), false);
  assert.deepEqual(aboutSections(TEMPLATE).map((s) => s.title), ['Capabilities', 'Motivation', 'Roles and responsibilities', 'Owners', 'Open questions']);
  assert.equal(TEMPLATE.slice(TEMPLATE_CARET - 2, TEMPLATE_CARET), '- ');
  assert.equal(lineOf(TEMPLATE, TEMPLATE_CARET), 1);
  assert.deepEqual(openQuestions(TEMPLATE), []); // an empty bullet is not a question yet
});

test('dirty: any change from what the editor started with', () => {
  assert.equal(isDirty('a', 'a'), false);
  assert.equal(isDirty('a', 'b'), true);
  assert.equal(isDirty(undefined, ''), false);
  assert.equal(isDirty('', TEMPLATE), true);
});

test('toolbar: wrapping kinds wrap a selection, put the caret inside an empty pair, and unwrap a wrapped selection', () => {
  assert.deepEqual(applyFormat('say hi now', 4, 6, 'bold'), { value: 'say **hi** now', start: 6, end: 8 });
  assert.deepEqual(applyFormat('say hi now', 4, 4, 'italic'), { value: 'say **hi now', start: 5, end: 5 });
  assert.deepEqual(applyFormat('a **b** c', 4, 5, 'bold'), { value: 'a b c', start: 2, end: 3 });
  assert.equal(applyFormat('x', 0, 1, 'strike').value, '~~x~~');
  assert.equal(applyFormat('x', 0, 1, 'code').value, '`x`');
  assert.deepEqual(applyFormat('go', 0, 2, 'link'), { value: '[go](https://)', start: 5, end: 13 });
  assert.equal(applyFormat('', 0, 0, 'link').value, '[text](https://)');
});

test('toolbar: heading and list kinds toggle their prefix on every selected line', () => {
  assert.equal(applyFormat('Title', 0, 0, 'h').value, '## Title');
  assert.equal(applyFormat('## Title', 3, 3, 'h').value, 'Title');
  assert.equal(applyFormat('a\nb\nc', 0, 5, 'ul').value, '- a\n- b\n- c');
  assert.equal(applyFormat('- a\n- b', 0, 7, 'ul').value, 'a\nb');
  assert.equal(applyFormat('a\nb', 0, 3, 'ol').value, '1. a\n2. b');
  assert.equal(applyFormat('1. a\n2. b', 0, 9, 'ol').value, 'a\nb');
  assert.equal(applyFormat('x\n\ny', 0, 4, 'ul').value, '- x\n\n- y'); // a blank line stays blank
  assert.equal(applyFormat('before\nmid\nafter', 7, 10, 'ul').value, 'before\n- mid\nafter'); // only the selected line
  assert.equal(applyFormat('x', 0, 1, 'nope').value, 'x');
});

test('the edit a Save sends: about only, trimmed, empty clears; too long is refused with the field', () => {
  assert.deepEqual(aboutEdit({ kind: 'component', name: 'users-svc' }, '  ## A\n- b \n', { kind: 'gateway' }), { kind: 'component', name: 'users-svc', serviceKind: 'gateway', about: '## A\n- b' });
  assert.deepEqual(aboutEdit({ kind: 'component', name: 'users-svc' }, ''), { kind: 'component', name: 'users-svc', serviceKind: 'service', about: '' });
  assert.deepEqual(aboutEdit({ kind: 'subsystem', key: 'agent' }, 'x'), { kind: 'subsystem', key: 'agent', about: 'x' });
  assert.throws(() => aboutEdit({ kind: 'subsystem', key: 'agent' }, 'x'.repeat(ABOUT_MAX + 1)), (e: any) => e.field === 'about');
});

test('harvested environments get no about pencil, designs do', () => {
  assert.equal(pencilAllowed('about', true), true);
  assert.equal(pencilAllowed('about-section', true), true);
  assert.equal(pencilAllowed('about', false), false);
  assert.equal(pencilAllowed('about-section', false), false);
});

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());
const edit = (slug: string, e: object, env = 'hld') => app.call('POST', `/api/envs/${env}/drafts/${slug}/edits`, { edit: e, author: 'ana' });

test('Save to draft: the pane\'s about-only edit is accepted for a component (the rest of the header is kept) and for a subsystem; the template round-trips', async () => {
  const slug = (await app.call('POST', '/api/envs/hld/drafts', { name: 'pane' })).body.slug as string;
  const before = (await app.call('GET', '/api/envs/hld/services/users-svc')).body.service;
  assert.equal((await edit(slug, aboutEdit({ kind: 'component', name: 'users-svc' }, TEMPLATE + 'Is it capped?', before))).status, 201);
  const after = (await app.call('GET', `/api/envs/hld/services/users-svc?draft=${slug}`)).body.service;
  assert.equal(after.team, before.team);
  assert.equal(after.groupPath, before.groupPath);
  assert.deepEqual(openQuestions(after.about).map((q) => q.text), ['Is it capped?']);
  assert.equal((await edit(slug, aboutEdit({ kind: 'subsystem', key: 'agent' }, '## Open questions\n- Which first?'))).status, 201);
  const sub = (await app.call('GET', `/api/envs/hld/subsystems?draft=${slug}`)).body.subsystems.find((s: any) => s.key === 'agent');
  assert.deepEqual(openQuestions(sub.about).map((q) => q.text), ['Which first?']);
});

test('a harvested environment refuses the same edit (the pane is read-only there)', async () => {
  const r = await app.call('POST', '/api/envs/prod/drafts', { name: 'nope' });
  assert.ok(r.status >= 400, String(r.status));
});
