// #115 and #126: either/or arms are frames. Full draws every arm of a decision (`alt <guard>` / `else <arm>`), Simple keeps the arms as alt frames
// instead of a sequence, and a write never hides under a read-labelled `*N` arrow. Sample: device-hub (samples/alt-frames-demo.json).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readSample, startApp } from './helpers.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); for (const f of ['orders-svc', 'users-svc', 'inventory-svc', 'payments-svc', 'alt-frames-demo']) assert.equal((await app.call('POST', '/api/ingest', readSample(`${f}.json`))).status, 201, f); });
after(() => app.close());

const mmd = async (ingress: string, q = '') => (await app.call('GET', `/api/envs/prod/flows/mermaid?service=device-hub&ingress=${ingress}${q}`)).body as string;
const lines = (t: string) => t.split('\n').filter((l) => l && !/^(%% (Flow|flow)|participant|actor|sequenceDiagram|title)/.test(l));
const DB = 'mongodb_devices_db_networkdevices';
const DEDUP = ['client->>device_hub: POST /api/v1/devices/client', "alt config.get('deviceDedupAnalysis')", '%% guard: src/device.service.ts:177', `device_hub->>${DB}: find`, `device_hub->>${DB}: deleteMany`, 'else plain delete', `device_hub->>${DB}: deleteOne`, 'end', `device_hub->>${DB}: createOne`, 'device_hub-->>client: return'];

test('#115 Full: the if/else group is an alt frame with the guard text, every arm in order, the guard file:line as a comment', async () => {
  assert.deepEqual(lines(await mmd('in.addClientDevice', '&detail=full')), DEDUP);
});

test('#115 Full: a choice still wins (one arm, no frame), and External keeps the first arm by default', async () => {
  const g = encodeURIComponent('d3b07384-d9a0-5c2b-8c1e-115000000001:then');
  const one = await mmd('in.addClientDevice', `&detail=full&choose=${g}`), ext = await mmd('in.addClientDevice', '&detail=external');
  assert.ok(one.includes('deleteMany') && !one.includes('deleteOne') && !one.includes('alt '));
  assert.ok(ext.includes('find') && !ext.includes('deleteOne'));
});

test('#126 Simple: the either/or arms stay as alt / else frames; the folded find + deleteMany row names both ops', async () => {
  assert.deepEqual(lines(await mmd('in.addClientDevice', '&detail=simple')), DEDUP.filter((l) => !l.startsWith('%% guard') && !l.endsWith(': deleteMany')).map((l) => l.endsWith(': find') ? l.replace(': find', ': *2 find, deleteMany') : l));
});

test('#126 Simple: a gateway that forwards to one backend per request is one alt with else arms, not a sequence', async () => {
  const t = (await mmd('in.cpForward', '&detail=simple')).split('\n');
  const top = t.filter((l) => /^(alt|else) (POST \/orders|GET \/orders\/\{id\}|DELETE \/orders\/\{id\})$/.test(l));
  assert.deepEqual(top, ['alt POST /orders', 'else GET /orders/{id}', 'else DELETE /orders/{id}']);
  assert.equal(t.filter((l) => l.startsWith('device_hub->>')).length, 3);
});

test('#126 Simple trace: messages carry `alt` frames and no decisions; the arms are not merged', async () => {
  const r = (await app.call('GET', '/api/envs/prod/trace?service=device-hub&ingress=in.addClientDevice&detail=simple')).body;
  assert.equal(r.decisions, undefined);
  const del = r.messages.filter((m: any) => /delete/.test(m.label));
  assert.deepEqual(del.map((m: any) => [m.label, m.alt.branch, m.alt.of]), [['*2 find, deleteMany', 1, 2], ['deleteOne', 2, 2]]);
  assert.equal(del[0].dbGroup.access, 'read_write', '#115: the folded row is a read and write, never a read');
  assert.equal(r.messages.find((m: any) => m.label === 'createOne').alt, undefined);
});
