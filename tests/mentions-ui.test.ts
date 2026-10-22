// The pure rules of the mentions UI (0.31.0): the "Mentioned me" view and its count, the user helpers the pickers use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mentionsUser, mentionedOnly, countMentions, visibleThread } from '../web/js/comments/pure.js';

const c = (id: number, body: string, replies: any[] = [], extra: any = {}) => ({ id, body, replies, deleted: false, resolved: false, ...extra });

test('mentionsUser matches the exact token only', () => {
  assert.equal(mentionsUser('hi @[u_1] ok', 'u_1'), true);
  assert.equal(mentionsUser('hi @[u_12] ok', 'u_1'), false);
  assert.equal(mentionsUser('hi @u_1', 'u_1'), false);
  assert.equal(mentionsUser('x', null), false);
});

test('Mentioned me keeps the threads where the comment or a reply mentions me', () => {
  const thread = { comments: [c(1, 'plain', [c(2, 'cc @[u_1]')]), c(2 + 1, 'no'), c(4, '@[u_1] direct'), c(5, 'resolved @[u_1]', [], { resolved: true })] };
  const vis = visibleThread(thread, false);
  const only = mentionedOnly(vis, 'u_1');
  assert.deepEqual(only.comments.map((x: any) => x.id), [1, 4]);
  assert.equal(only.count, 3); // the thread with its reply, and the direct one
  assert.equal(countMentions(thread, 'u_1'), 3); // reply, direct and the resolved one
  assert.equal(countMentions(thread, 'u_9'), 0);
});
