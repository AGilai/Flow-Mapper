// GET /healthz: liveness for CloudFront and systemd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.ts';

test('GET /healthz answers ok with the version and leaves the database alone', async () => {
  const app = await startApp();
  try {
    const dv = () => (app.ctx.db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
    const before = dv();
    const r = await app.call('GET', '/healthz');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.match(r.body.version, /^\d+\.\d+\.\d+/);
    assert.equal(dv(), before);
  } finally { await app.close(); }
});
