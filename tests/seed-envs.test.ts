// Seeding design recipes onto an existing environment, and plans that change nothing or carry unknown fields.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES, startApp } from './helpers.ts';
import { seedEnvRecipes } from '../scripts/seed-envs.ts';
import { copyEnv } from '../server/store/env-copy.ts';

const all = (d: string) => readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')));

test('an existing design gets its missing recipe draft, never a re-copy; an existing draft is left alone; empty plan 400; unknown fields warn', async () => {
  const app = await startApp();
  try {
    await app.call('POST', '/api/ingest', { manifests: all(SAMPLES) });
    for (const f of all(join(SAMPLES, 'dtos'))) await app.call('POST', `/api/envs/${f.env}/dtos`, { dtos: f.dtos });
    const { drafts: _d, ...recipe } = JSON.parse(readFileSync(join(SAMPLES, 'envs/sase-hld.json'), 'utf8'));
    copyEnv(app.ctx.db, recipe);
    const logs: string[] = [];
    seedEnvRecipes(app.ctx, join(SAMPLES, 'envs'), (m) => logs.push(m));
    assert.ok(logs.some((l) => /exists, left as it is/.test(l)));
    const d = (await app.call('GET', '/api/envs/sase-hld/drafts/hld-import')).body;
    assert.equal(d.status, 'open'); assert.ok(d.ops.length > 5);
    await app.call('DELETE', '/api/envs/sase-hld/drafts/hld-import/ops/last');
    const n = (await app.call('GET', '/api/envs/sase-hld/drafts/hld-import')).body.ops.length;
    seedEnvRecipes(app.ctx, join(SAMPLES, 'envs'));
    assert.equal((await app.call('GET', '/api/envs/sase-hld/drafts/hld-import')).body.ops.length, n, 'an existing draft is not touched');

    const empty = await app.call('POST', '/api/envs/sase-hld/drafts', { name: 'e', slug: 'e' });
    assert.equal(empty.status, 201);
    const r = await app.call('POST', '/api/envs/sase-hld/drafts/e/plan', { planVersion: 1 });
    assert.equal(r.status, 400); assert.match(r.body.error.message, /the plan changes nothing in sase-hld/);
    const plan = JSON.parse(readFileSync(join(SAMPLES, 'envs/sase-hld.plan.json'), 'utf8'));
    await app.call('POST', '/api/envs/sase-hld/drafts', { name: 'w', slug: 'w' });
    const w = await app.call('POST', '/api/envs/sase-hld/drafts/w/plan', { ...plan, surprise: 1, other: 2 });
    assert.equal(w.status, 201);
    assert.ok(w.body.warnings.some((x: string) => /unknown top-level plan field\(s\) ignored: surprise, other/.test(x)));
  } finally { await app.close(); }
});
