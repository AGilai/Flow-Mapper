// 0.29.0: the pure rules of the action items UI (web/js/action-items/pure.js) and the preview backend (web/js/api-local-action-items.js).
import { test } from 'node:test';
import { plainText } from '../core/rich-text.ts';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { todayLocal, isLate, fmtDue, headerText, headerWithDraft, prefill, stripTables, ownerNames, suggest, eventParts } from '../web/js/action-items/pure.js';

test('overdue: due before the local today and still open or in progress', () => {
  const t = '2026-10-22';
  assert.equal(todayLocal(new Date(2026, 9, 22, 23, 59)), t);
  assert.equal(isLate({ due: '2026-10-21', status: 'open' }, t), true);
  assert.equal(isLate({ due: '2026-10-21', status: 'progress' }, t), true);
  assert.equal(isLate({ due: '2026-10-22', status: 'open' }, t), false, 'due today is not overdue');
  assert.equal(isLate({ due: '2026-10-01', status: 'done' }, t), false);
  assert.equal(isLate({ due: '2026-10-01', status: 'dropped' }, t), false);
  assert.equal(isLate({ due: null, status: 'open' }, t), false);
});

test('due dates read "Oct 14", with the year when it is not this one', () => {
  assert.equal(fmtDue('2026-10-14', '2026-10-22'), 'Oct 14');
  assert.equal(fmtDue('2027-01-05', '2026-10-22'), 'Jan 5, 2027');
});

test('header: open (open + in progress) and all; the unsaved row counts as open', () => {
  const items = [{ status: 'open' }, { status: 'progress' }, { status: 'open' }, { status: 'done' }, { status: 'dropped' }];
  assert.equal(headerText(items), '(3 open · 5)');
  assert.equal(headerText([{ status: 'done' }]), '(0 open · 1)');
  assert.equal(headerWithDraft([]), '(1 open)');
});

test('prefill: plain text of a comment, whitespace collapsed, 200 characters with an ellipsis', () => {
  assert.equal(prefill(plainText('<p>Use a <b>15 min</b> TTL</p><ul><li>one</li><li>two</li></ul>')), 'Use a 15 min TTL one two');
  assert.equal(prefill(plainText(stripTables('<p>x</p><table><thead><tr><th>f</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>'))), 'x f a b');
  assert.equal(prefill(''), '');
  const long = prefill(plainText(`<p>${'word '.repeat(80)}</p>`));
  assert.ok(long.length <= 200 && long.endsWith('…'), String(long.length));
  assert.equal(prefill('x'.repeat(200)), 'x'.repeat(200), 'exactly 200 is not cut');
  assert.equal(prefill(null), '');
});

test('owner suggestions: the remembered name first, then comment authors and item people, each once; the typed text filters', () => {
  const names = ownerNames({ me: 'Asaf G.', comments: [{ author: 'Dana Levi', replies: [{ author: 'Noa B.' }] }, { author: 'Asaf G.', replies: [] }], items: [{ owner: 'Dana Levi', createdBy: 'Cy' }] });
  assert.deepEqual(names, ['Asaf G.', 'Dana Levi', 'Noa B.', 'Cy']);
  assert.deepEqual(suggest(names, 'da'), ['Dana Levi']);
  assert.deepEqual(suggest(names, 'dana levi'), [], 'an exact match needs no suggestion');
  assert.deepEqual(suggest(names, ''), names);
});

test('thread events read "created action #n from this comment", "closed #n", "dropped #n", "reopened #n"', () => {
  assert.deepEqual(eventParts({ kind: 'created' }), { verb: 'created action', tail: ' from this comment' });
  assert.deepEqual(eventParts({ kind: 'closed' }), { verb: 'closed', tail: '' });
});
