// UI follow-ups after 0.32.0, the pure rules (Assistant user, popup flip, comment= link, stale environment list).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSystemUser, pickable, filterUsers } from '../core/users-match.ts';
import { placeAbove } from '../web/js/comments/pure.js';

test('the Assistant user is left out of the pickers, case and spacing aside, and stays in the registry', () => {
  const us = [{ name: 'Dana Levi' }, { name: 'Assistant' }, { name: '  assistant ' }, { name: 'Assistant Pro' }];
  assert.equal(isSystemUser(us[1]), true);
  assert.deepEqual(pickable(us).map((u) => u.name), ['Dana Levi', 'Assistant Pro']);
  assert.equal(us.length, 4);
  assert.deepEqual(filterUsers(pickable(us), 'assist').map((u) => u.name), ['Assistant Pro']);
});

test('the "@" popup flips above only when it does not fit below and there is more room above', () => {
  assert.equal(placeAbove(200, 300, 100), false);
  assert.equal(placeAbove(200, 80, 400), true);
  assert.equal(placeAbove(200, 80, 60), false);
});

