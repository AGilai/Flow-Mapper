// UI follow-ups after 0.32.0: the system user is not a sign-in / "@" choice, the "@" popup flips above the caret, `comment=<id>` links,
// and the stale environment list. Only the pure rules are tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSystemUser, pickable, filterUsers } from '../core/users-match.ts';
import { commentParam, locateComment, placeAbove } from '../web/js/comments/pure.js';
import { requestedEnv, unknownEnv } from '../web/js/env-missing.js';

test('the Assistant user is left out of the pickers, case and spacing aside, and stays in the registry', () => {
  const us = [{ name: 'Dana Levi' }, { name: 'Assistant' }, { name: '  assistant ' }, { name: 'Assistant Pro' }];
  assert.equal(isSystemUser(us[1]), true);
  assert.deepEqual(pickable(us).map((u) => u.name), ['Dana Levi', 'Assistant Pro']);
  assert.equal(us.length, 4);
  assert.deepEqual(filterUsers(pickable(us), 'assist').map((u) => u.name), ['Assistant Pro']);
});

test('comment= parses a positive whole number only', () => {
  const q = (s: string) => new URLSearchParams(s);
  assert.equal(commentParam(q('comment=42')), 42);
  for (const bad of ['comment=0', 'comment=-1', 'comment=4x', 'comment=', 'comment=1.5', 'tab=1']) assert.equal(commentParam(q(bad)), null, bad);
});

test('locateComment finds a top comment or a reply and says whether its thread is resolved', () => {
  const t = { comments: [{ id: 1, resolved: false, replies: [{ id: 2 }] }, { id: 3, resolved: true, replies: [{ id: 4 }] }] };
  assert.deepEqual(locateComment(t, 2), { resolved: false });
  assert.deepEqual(locateComment(t, 4), { resolved: true });
  assert.equal(locateComment(t, 9), null);
});

test('the "@" popup flips above only when it does not fit below and there is more room above', () => {
  assert.equal(placeAbove(200, 300, 100), false);
  assert.equal(placeAbove(200, 80, 400), true);
  assert.equal(placeAbove(200, 80, 60), false);
});

test('an environment in the URL that the list lacks is looked up again; known or absent ones are not', () => {
  const q = (s: string) => new URLSearchParams(s);
  assert.equal(requestedEnv(q('env=qa2'), ['flows']), 'qa2');
  assert.equal(requestedEnv(q(''), ['envs', 'qa2', 'settings'], { name: 'qa2' }), 'qa2');
  assert.equal(requestedEnv(q(''), ['envs', 'new'], { }), null);
  assert.equal(requestedEnv(q(''), ['flows']), null);
  assert.equal(unknownEnv('qa2', ['prod']), 'qa2');
  assert.equal(unknownEnv('prod', ['prod']), null);
  assert.equal(unknownEnv(null, ['prod']), null);
});
