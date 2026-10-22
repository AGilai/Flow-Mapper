// POST /api/envs (#77): a blank environment needs no source; a copy mode without one is a 400 that names the field.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, sampleManifests } from './helpers.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

test('blank: no source needed, and a given source is ignored (#77)', async () => {
  const a = await app.call('POST', '/api/envs', { name: 'blank-nosrc', mode: 'blank' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.kind, 'design');
  assert.equal(a.body.source, null);
  const b = await app.call('POST', '/api/envs', { name: 'blank-ignored', source: 'no-such-env', mode: 'blank' });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal(b.body.source, null);
  const c = await app.call('POST', '/api/envs', { name: 'blank-known', source: 'prod', mode: 'blank' });
  assert.equal(c.status, 201);
  assert.equal(c.body.source, 'prod', 'a known source is still recorded (lineage, as in C1)');
});

test('copy modes without a source: 400 naming the field, not a 404 about undefined (#77)', async () => {
  for (const mode of ['components', 'full']) {
    const r = await app.call('POST', '/api/envs', { name: `nosrc-${mode}`, mode, services: [{ name: 'orders-svc' }] });
    assert.equal(r.status, 400, mode);
    assert.match(r.body.error.message, /source/);
    assert.doesNotMatch(r.body.error.message, /undefined/);
    assert.equal(r.body.error.details.field, 'source');
  }
  assert.equal((await app.call('POST', '/api/envs', { name: 'nosrc-x', source: 'nope', mode: 'full' })).status, 404);
});
