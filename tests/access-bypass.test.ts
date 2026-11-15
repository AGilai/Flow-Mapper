// Access rules cannot be sidestepped by spelling the path differently (encoded or doubled slashes), and a dry-run ingest does not read hidden envs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCognito, makeDesign } from './cognito-helpers.ts';
import { sampleManifests } from './helpers.ts';

let t: Awaited<ReturnType<typeof startCognito>>;
before(async () => { t = await startCognito(); await t.seed(); });
after(() => t.close());

test('alternative spellings of a path get the same answer as the plain one', async () => {
  const owner = await t.signIn('o@example.com', 'Owner'), other = await t.signIn('x@example.com', 'Other');
  await makeDesign(owner, 'secret');
  for (const p of ['/api/envs/secret/meta', '/api//envs/secret/meta', '/api/envs//secret/meta', '/api/envs/secret/meta/', '/api/envs/%73ecret/meta', '/%61pi/envs/secret/meta']) {
    assert.equal((await other.call('GET', p)).status, 404, `signed in, hidden env: ${p}`);
    assert.equal((await t.anon.call('GET', p)).status, 401, `anonymous: ${p}`);
  }
  for (const p of ['/api/envs/prod/%64tos', '/api/envs/prod//dtos', '/api/envs/prod/dtos/', '/api//envs/prod/dtos']) {
    const r = await other.call('POST', p, { dtos: [] });
    assert.equal(r.status, 403, `sealed write without harvester scope: ${p} -> ${r.status} ${JSON.stringify(r.body)}`);
  }
  assert.equal((await owner.call('DELETE', '/api/envs//secret/')).status, 200);
});

test('a dry-run ingest into an env the caller cannot read is 404', async () => {
  const owner = await t.signIn('o2@example.com', 'Owner2'), other = await t.signIn('x2@example.com', 'Other2');
  await makeDesign(owner, 'secret2');
  const m = { ...sampleManifests()[0], env: 'secret2' };
  assert.equal((await other.call('POST', '/api/ingest?dryRun=1', m)).status, 404);
  assert.equal((await other.call('POST', '/api/ingest?dryRun=1', { manifests: [m] })).status, 404);
  assert.equal((await owner.call('POST', '/api/ingest?dryRun=1', m)).status, 200);
  assert.equal((await other.mcp('ingest_manifest', { manifest: m, dryRun: true })).isError, true);
});
