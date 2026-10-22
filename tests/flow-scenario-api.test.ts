// 0.38.0 (#82 part 3): flows/counts carries `decisions` for a flow that reaches either/or decisions; the Mermaid export takes the view parameters.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, startApp } from './helpers.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201); });
after(async () => { await app.close(); });

test('flows/counts: only a flow that reaches decisions carries decisions, and the numbers say the three views', async () => {
  const rows = (await app.call('GET', '/api/envs/prod/flows/counts')).body as any[];
  const reg = rows.find((r) => r.service === 'member-api' && r.ingress === 'in.register');
  assert.equal(reg.decisions, 2);
  assert.ok(reg.steps >= 1 && reg.both.min <= reg.both.max && reg.full >= reg.steps);
  assert.equal(rows.filter((r) => r.decisions).every((r) => r.total > 0), true);
  const plain = rows.find((r) => !r.decisions);
  assert.equal('steps' in plain, false, 'other rows are as before');
});

test('Mermaid export: without view parameters the full trace, with them that view (first arms)', async () => {
  const q = '/api/envs/prod/flows/mermaid?service=member-api&ingress=in.register';
  const full = (await app.call('GET', q)).body as string, ext = (await app.call('GET', `${q}&detail=external`)).body as string;
  assert.ok(full.includes('welcome'), 'the canonical trace has both arms');
  assert.equal(ext.includes('welcome'), false, 'the view follows the first arm of each decision');
  assert.equal((await app.call('GET', `${q}&detail=nope`)).status, 400);
});
