// Cognito mode: the "env is required" error of an MCP tool lists only the environments the caller can read; tools with no env still work without one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startCognito, makeDesign } from './cognito-helpers.ts';

test('missing env lists only readable envs; env-less tools need none', async () => {
  const t = await startCognito();
  try {
    await t.seed();
    const owner = await t.signIn('owner@example.com', 'Olive Owner'), other = await t.signIn('other@example.com', 'Otto Other');
    await makeDesign(owner, 'secret-design');
    const mine = await owner.mcp('list_services', {}), theirs = await other.mcp('list_services', {});
    assert.equal(mine.isError, true);
    assert.match(mine.text, /env is required/);
    assert.match(mine.text, /secret-design/);
    assert.equal(theirs.isError, true);
    assert.match(theirs.text, /env is required/);
    assert.match(theirs.text, /prod/);
    assert.doesNotMatch(theirs.text, /secret-design/);
    for (const [tool, args] of [['whoami', {}], ['list_envs', {}], ['list_users', {}], ['list_mentions', { user: owner.id }], ['list_bugs', {}]] as const)
      { const r = await other.mcp(tool, args); assert.equal(r.isError, false, tool + r.text); }
    // a non-admin's env-less report is stored under env 'default', which they cannot read back (pre-existing, open); it must not demand env
    assert.doesNotMatch((await other.mcp('report_bug', { title: 'no env here' })).text, /env is required/);
    const admin = await t.signIn('admin@example.com', 'Admin');
    assert.equal((await admin.mcp('report_bug', { title: 'admin no env' })).isError, false);
    assert.equal((await other.mcp('create_env', { name: 'other-own', mode: 'blank' })).isError, false);
  } finally { await t.close(); }
});
