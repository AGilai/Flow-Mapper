// 0.24.0: the UI state of a design environment (URL <-> mode / draft / compare), the marks store and the status-mark wording. Pure web modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { designFromQuery, designQuery, isDesign, pageEnv } from '../web/js/state.js';
// @ts-ignore
import { createMarks } from '../web/js/design/marks-store.js';
// @ts-ignore
import { markLabel, markTitle, markClass, wasText, shortDateTime } from '../web/js/components/status-mark.js';
// @ts-ignore
import { withDraft } from '../web/js/api.js';
// @ts-ignore
import { discardSentence } from '../web/js/design/draft-discard.js';
// @ts-ignore
import { byText } from '../web/js/design/draft-bar.js';
// @ts-ignore
import { pickerItems } from '../web/js/design/draft-picker.js';

const q = (s: string) => new URLSearchParams(s);
const meta = [{ name: 'prod', kind: 'sealed' }, { name: 'sase-hld', kind: 'design' }, { name: 'other', kind: 'design' }];
const S = (o: any = {}) => ({ env: 'prod', envs: ['prod', 'sase-hld', 'other'], envMeta: meta, mode: 'view', draft: null, compare: 'baseline', ...o });

test('the URL carries env, draft, mode and compare; defaults stay out of it', () => {
  assert.deepEqual(designFromQuery(q('env=sase-hld&draft=hld-import&mode=edit&compare=source'), S()), { env: 'sase-hld', draft: 'hld-import', mode: 'edit', compare: 'source' });
  assert.deepEqual(designQuery({ env: 'sase-hld', draft: 'hld-import', mode: 'edit', compare: 'source' }), { env: 'sase-hld', draft: 'hld-import', mode: 'edit', compare: 'source' });
  assert.deepEqual(designQuery({ env: 'sase-hld', draft: null, mode: 'view', compare: 'baseline' }), { env: null, draft: null, mode: null, compare: null }, 'nothing to say: nothing in the URL');
  const s = S({ env: 'sase-hld', draft: 'a', mode: 'edit' });
  assert.deepEqual(designFromQuery(q(''), s), { env: 'sase-hld', draft: 'a', mode: 'edit', compare: 'baseline' }, 'an absent parameter keeps the state: links inside the app stay in the draft');
  assert.equal(designFromQuery(q('mode=view'), s).mode, 'view');
  assert.equal(designFromQuery(q('draft='), s).draft, null, 'draft= leaves the draft');
});

test('switching env clears the design state; a sealed env is always view with no draft', () => {
  const s = S({ env: 'sase-hld', draft: 'a', mode: 'edit', compare: 'source' });
  assert.deepEqual(designFromQuery(q('env=other'), s), { env: 'other', draft: null, mode: 'view', compare: 'baseline' });
  assert.deepEqual(designFromQuery(q('env=prod&draft=x&mode=edit'), s), { env: 'prod', draft: null, mode: 'view', compare: 'baseline' }, 'sealed: no draft, no edit');
  assert.equal(designFromQuery(q('env=nope'), s).env, 'sase-hld', 'an unknown env is ignored');
  assert.ok(isDesign('sase-hld', meta) && !isDesign('prod', meta) && !isDesign('x', meta));
});

test('api reads of the current design env carry draft=<slug>, nothing else does', () => {
  assert.equal(withDraft('/api/envs/sase-hld/inventory', 'hld-import', 'sase-hld'), '/api/envs/sase-hld/inventory?draft=hld-import');
  assert.equal(withDraft('/api/envs/sase-hld/trace?detail=full&service=a', 'd', 'sase-hld'), '/api/envs/sase-hld/trace?detail=full&service=a&draft=d');
  assert.equal(withDraft('/api/envs/sase-hld/inventory', null, 'sase-hld'), '/api/envs/sase-hld/inventory');
  assert.equal(withDraft('/api/envs/prod/inventory', 'd', 'sase-hld'), '/api/envs/prod/inventory', 'another environment');
  assert.equal(withDraft('/api/envs/sase-hld/drafts', 'd', 'sase-hld'), '/api/envs/sase-hld/drafts');
  assert.equal(withDraft('/api/envs/sase-hld/drafts/d/changes', 'd', 'sase-hld'), '/api/envs/sase-hld/drafts/d/changes');
  assert.equal(withDraft('/api/bugs', 'd', 'sase-hld'), '/api/bugs');
});

const payload = {
  against: 'baseline', draft: 'd', source: 'prod', baselineAt: '2026-10-21T14:02:00.000Z', counts: {},
  marks: {
    'svc:a': { mark: 'new' }, 'svc:b': { mark: 'changed', what: '+1 endpoint' }, 'svc:c': { mark: 'removed' },
    'dto:b/response/-/in.x': { mark: 'changed', what: '1 new field' }, 'dto:b/response/-/in.x#id': { mark: 'new' }, 'dto:b/response/-/in.x#old': { mark: 'removed' },
    'dto:b/response/-/in.y#id': { mark: 'new' },
  },
  ghosts: { 'svc:c': { label: 'c' }, 'egr:b/out.gone': { label: 'out.gone', service: 'b', type: 'egress' }, 'egr:b/out.gone2': { label: 'out.gone2', service: 'b' }, 'egr:z/out.x': { label: 'out.x', service: 'z' } },
};

test('marks store: anchor lookup, field map per item, ghosts by prefix, components', () => {
  const m = createMarks(payload, [{ anchor: 'ing:b/in.new', change: 'added' }, { anchor: 'egr:b/out.gone', change: 'removed' }]);
  assert.deepEqual(m.markOf('svc:b'), { mark: 'changed', what: '+1 endpoint' });
  assert.equal(m.markOf('svc:zzz'), null);
  const f = m.fieldMarks('dto:b/response/-/in.x');
  assert.deepEqual([...f.keys()].sort(), ['id', 'old']);
  assert.equal(f.get('old').mark, 'removed');
  assert.equal(m.fieldMarks('dto:b/response/-/in.x#id').size, 0, 'a field anchor is no item');
  assert.deepEqual(m.ghostsUnder('egr:b/').map((g: any) => g.anchor), ['egr:b/out.gone', 'egr:b/out.gone2']);
  assert.deepEqual(m.components().map((c: any) => c.service), ['a', 'b', 'c']);
  assert.deepEqual(m.components('new'), [{ service: 'a', mark: 'new' }]);
  assert.ok(m.inDraft('ing:b/in.new') && !m.inDraft('egr:b/out.gone'));
  assert.deepEqual(m.removedInDraft('egr:').map((c: any) => c.anchor), ['egr:b/out.gone']);
  assert.equal(m.empty, false);
  assert.equal(createMarks().empty, true, 'no payload: an empty, inert store');
  assert.equal(createMarks().markOf('svc:a'), null);
});

test('status marks: words and titles; against the source an item only there is "only in <source>", never "Removed"', () => {
  const base = createMarks(payload), src = createMarks({ ...payload, against: 'source' });
  assert.equal(markLabel({ mark: 'new' }, base), 'New');
  assert.equal(markLabel({ mark: 'changed' }, base), 'Changed');
  assert.equal(markLabel({ mark: 'removed' }, base), 'Removed');
  assert.equal(markLabel({ mark: 'removed' }, src), 'only in prod');
  assert.equal(markLabel({ mark: 'new' }, src), 'New');
  assert.equal(markTitle({ mark: 'new' }, base), 'New since baseline prod, Oct 21 14:02');
  assert.equal(markTitle({ mark: 'changed' }, src), 'Changed compared with prod now');
  assert.equal(markTitle({ mark: 'removed' }, src), 'Exists only in prod now');
  assert.deepEqual(['new', 'changed', 'removed', 'x'].map((k) => markClass({ mark: k })), ['new', 'chg', 'rm', '']);
  assert.equal(wasText({ mark: 'changed', was: 'was string', what: 'x' }), 'was string');
  assert.equal(wasText({ mark: 'changed', what: '+1 endpoint' }), '+1 endpoint');
  assert.equal(shortDateTime('2026-10-21T09:05:00Z'), 'Oct 21 09:05');
  assert.equal(shortDateTime('nope'), '');
});

test('draft bar, picker and discard wording', () => {
  assert.equal(byText([]), 'no changes yet');
  assert.equal(byText(['seed']), 'by seed');
  assert.equal(byText(['a', 'b']), 'by a and 1 other');
  assert.equal(byText(['a', 'b', 'c']), 'by a and 2 others');
  assert.equal(discardSentence(4, ['me', 'Reviewer'], 'me'), 'Discard 4 changes by you and Reviewer? The draft is closed and cannot be reopened.');
  assert.match(discardSentence(1, ['me'], 'me'), /^Discard 1 change by you\?/);
  assert.match(discardSentence(2, ['seed'], 'me'), /by seed\?/);
  const items = pickerItems([{ slug: 'a', name: 'A', counts: { added: 1, removed: 0, changed: 2 }, authors: ['x'] }], 'a', { onPick() {}, onNew() {}, onNone() {} });
  assert.equal(items[0].label, 'New draft…');
  assert.ok(items.some((i: any) => i.label === 'A (open)' && /\+1 −0 ~2/.test(i.hint)));
  assert.ok(items.some((i: any) => i.label === 'No draft'), 'with a draft open, the way out is listed');
});

test('pageEnv: env-specific pages always carry env=, global pages never gain it', () => {
  for (const p of ['system', 'inventory', 'services', 'stores', 'instances', 'channels', 'events', 'flows', 'questions', 'health']) assert.equal(pageEnv([p, 'x'], 'prod'), 'prod', p);
  for (const p of ['bugs', 'users', 'mentions', 'envs']) assert.equal(pageEnv([p], 'prod'), null, p);
  assert.equal(pageEnv([], 'prod'), 'prod');
  assert.equal(pageEnv(['system'], null), null);
});
