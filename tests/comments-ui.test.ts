// 0.27.0: the pure parts of comments: the thread tree (core/comments.ts) and the small UI rules (web/js/comments/pure.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildThread, parseFlowAnchor, flowAnchor, cleanName, type CommentRow } from '../core/comments.ts';
import { esc } from '../core/rich-text.ts';
// @ts-ignore plain JS module shared with the browser
import { relTime, initials, addressOf, textToHtml, startsOpen } from '../web/js/comments/pure.js';

const row = (id: number, o: Partial<CommentRow> = {}): CommentRow => ({ id, anchor: 'flow:s/i', step: null, parentId: null, author: 'a', body: `<p>${id}</p>`, createdAt: `2026-10-21T10:0${id}:00.000Z`, editedAt: null, deletedAt: null, externalId: null, externalSource: null, authorExternalId: null, resolvedAt: null, resolvedBy: null, ...o });

test('anchors: flow:<service>/<ingress> round trips; the ingress may hold dots and slashes', () => {
  assert.equal(flowAnchor('api-gateway', 'in.createOrder'), 'flow:api-gateway/in.createOrder');
  assert.deepEqual(parseFlowAnchor('flow:api-gateway/in.createOrder'), { service: 'api-gateway', ingress: 'in.createOrder' });
  assert.deepEqual(parseFlowAnchor('flow:s/a/b'), { service: 's', ingress: 'a/b' });
  for (const bad of ['svc:x', 'flow:', 'flow:s', 'flow:s/', 'flow:/i', '', null, 3]) assert.equal(parseFlowAnchor(bad), null, String(bad));
});

test('thread tree: oldest first, replies under their top comment oldest first, count of live comments', () => {
  const t = buildThread('flow:s/i', [row(4, { parentId: 1 }), row(2), row(1), row(3, { parentId: 1 })]);
  assert.deepEqual(t.comments.map((c) => [c.id, c.replies.map((r) => r.id)]), [[1, [3, 4]], [2, []]]);
  assert.equal(t.count, 4);
});

test('thread tree: a deleted top comment with replies stays as "deleted" (no author, no body); without replies it goes; a deleted reply goes', () => {
  const t = buildThread('flow:s/i', [row(1, { deletedAt: 'x', author: 'ana', body: '' }), row(2, { parentId: 1, author: 'ben' }), row(3, { deletedAt: 'x' }), row(4), row(5, { parentId: 4, deletedAt: 'x' })]);
  assert.deepEqual(t.comments.map((c) => [c.id, c.deleted, c.author, c.body, c.replies.length]), [[1, true, null, '', 1], [4, false, 'a', '<p>4</p>', 0]]);
  assert.equal(t.count, 2, 'live: the reply and the comment 4');
  assert.equal(buildThread('flow:s/i', []).comments.length, 0);
});

test('relative time: just now, minutes, hours, yesterday, days, then the date', () => {
  const now = Date.parse('2026-10-21T12:00:00Z'), at = (s: number) => new Date(now - s * 1000).toISOString();
  assert.equal(relTime(at(5), now), 'just now');
  assert.equal(relTime(at(20 * 60), now), '20 min ago');
  assert.equal(relTime(at(3 * 3600), now), '3 h ago');
  assert.equal(relTime(at(30 * 3600), now), 'yesterday');
  assert.equal(relTime(at(2 * 86400 + 60), now), '2 days ago');
  assert.equal(relTime(at(20 * 86400), now), '1 Oct 2026');
  assert.equal(relTime('nonsense', now), '');
});

test('initials, addresses and pasted plain text', () => {
  assert.equal(initials('Asaf G.'), 'AG'); assert.equal(initials('dana'), 'D'); assert.equal(initials('  '), '?'); assert.equal(initials('Ann Marie Lee'), 'AM');
  assert.equal(addressOf('wiki.example/x'), 'https://wiki.example/x'); assert.equal(addressOf('https://a.example'), 'https://a.example');
  assert.equal(addressOf('javascript:alert(1)'), 'javascript:alert(1)'); assert.equal(addressOf('//a.example'), '//a.example'); assert.equal(addressOf('not a link'), 'not a link');
  assert.equal(textToHtml('one\ntwo\n\n<b>three</b> & more', esc), '<p>one<br>two</p><p>&lt;b&gt;three&lt;/b&gt; &amp; more</p>');
  assert.equal(textToHtml('  ', esc), '');
});

test('names: control, bidi and zero-width characters go, whitespace and newlines collapse', () => {
  assert.equal(cleanName('  Asaf \n\t G. '), 'Asaf G.');
  assert.equal(cleanName('A\u200Bsaf\u202E G.\u0000'), 'Asaf G.');
  assert.equal(cleanName('\u200B\u200F \n'), '');
});

test('an empty Comments section starts collapsed; with comments it keeps the remembered state; a comment on the arrival step opens it', () => {
  assert.equal(startsOpen({ count: 0, remembered: true }), false);
  assert.equal(startsOpen({ count: 2, remembered: true }), true);
  assert.equal(startsOpen({ count: 2, remembered: false }), false);
  const comments = [{ step: null, replies: [{ step: '#step:a>b|x|http' }] }];
  assert.equal(startsOpen({ count: 2, remembered: false, stepKey: '#step:a>b|x|http', comments }), true);
  assert.equal(startsOpen({ count: 2, remembered: false, stepKey: '#step:other', comments }), false);
  assert.equal(startsOpen({ count: 0, remembered: true, stepKey: '#step:a>b|x|http', comments }), false);
});
