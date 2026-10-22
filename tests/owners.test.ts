// 0.33.0 owners: `owners: [userId]` on a component header and on a subsystem. A writer sends names or { externalSource, externalId }; the server matches them to users
// (external id, then name or alias, else a new user) and stores ids. Pure checks, manifest ingest, design edits, plans, sealed settings, the Full copy of a group.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign, sampleManifests } from './helpers.ts';
import { ownerProbe, ownersProblem, cleanOwners, MAX_OWNERS } from '../core/owners.ts';

test('owner probes: a user id stays an id, a string is a name, an object needs a name or an external id', () => {
  assert.deepEqual(ownerProbe('u_0a1b2c3d'), { id: 'u_0a1b2c3d' });
  assert.deepEqual(ownerProbe(' Dana Levi '), { name: 'Dana Levi' });
  assert.deepEqual(ownerProbe({ externalSource: 'confluence', externalId: '77' }), { source: 'confluence', externalId: '77' });
  assert.deepEqual(ownerProbe({ name: 'Dana', externalSource: 'confluence', externalId: '77' }), { name: 'Dana', source: 'confluence', externalId: '77' });
  for (const bad of ['', '   ', 'x'.repeat(81), {}, { externalSource: 'c' }, { externalId: '1' }, 5, null, ['a']]) assert.equal(typeof ownerProbe(bad), 'string', JSON.stringify(bad));
});

test('ownerProbe: anything shaped like a user id is looked up as one; names with spaces stay names', () => {
  assert.deepEqual(ownerProbe('u_abc'), { id: 'u_abc' });
  assert.deepEqual(ownerProbe('u_ Dana'), { name: 'u_ Dana' });
  assert.deepEqual(ownerProbe('Dana u_1'), { name: 'Dana u_1' });
});

test('stored owners: a list of ids up to the limit; cleaning drops duplicates and blanks, and leaves nothing for an empty list', () => {
  assert.equal(ownersProblem(undefined), null);
  assert.equal(ownersProblem(null), null);
  assert.equal(ownersProblem(['u_1']), null);
  assert.match(ownersProblem('u_1')!, /list/);
  assert.match(ownersProblem([1])!, /list/);
  assert.match(ownersProblem(Array.from({ length: MAX_OWNERS + 1 }, (_, i) => `u_${i}`))!, /more than/);
  assert.deepEqual(cleanOwners([' u_1 ', 'u_1', '', 'u_2', 3]), ['u_1', 'u_2']);
  assert.equal(cleanOwners([]), undefined);
  assert.equal(cleanOwners('x'), undefined);
});

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());
const users = async () => (await app.call('GET', '/api/users')).body.users as any[];
const current = async () => (await app.call('GET', '/api/envs/prod/services/orders-svc')).body.service.version as number;
const manifest = async (service: any, plus = 1) => { const m = structuredClone(sampleManifests().find((x: any) => x.service.name === 'orders-svc')); m.version = (await current()) + plus; Object.assign(m.service, service); return m; };
const delta = async (service: any) => { const v = await current(); return { schemaVersion: '1.0', kind: 'delta', env: 'prod', service: { name: 'orders-svc', ...service }, baseVersion: v, version: v + 1, harvestedAt: '2026-10-22T00:00:00Z' }; };

test('a manifest\'s owners (names and external ids) become user ids; the same person is never created twice; [] on a delta clears', async () => {
  const before = (await users()).length;
  const r = await app.call('POST', '/api/ingest', await manifest({ owners: ['Dana Levi', { name: 'Ron', externalSource: 'confluence', externalId: '501' }] }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const head = () => app.call('GET', '/api/envs/prod/services/orders-svc').then((x) => x.body.service);
  const ids: string[] = (await head()).owners;
  assert.equal(ids.length, 2);
  const list = await users();
  assert.equal(list.length, before + 2);
  assert.deepEqual(ids.map((id) => list.find((u) => u.id === id).name), ['Dana Levi', 'Ron']);
  assert.deepEqual(list.find((u) => u.id === ids[1]).externalIds, [{ source: 'confluence', externalId: '501' }]);
  // again: by external id (a different spelling of the name), by name (case), and an id
  assert.equal((await app.call('POST', '/api/ingest', await manifest({ owners: [{ name: 'Ronald', externalSource: 'confluence', externalId: '501' }, 'dana  LEVI', ids[0]] }))).status, 201);
  assert.deepEqual((await head()).owners, [ids[1], ids[0]]);
  assert.equal((await users()).length, before + 2, 'nobody was created twice');
  // a delta: left out keeps, [] clears
  const keep = await app.call('POST', '/api/ingest', await delta({ team: 'checkout' }));
  assert.equal(keep.status, 201, JSON.stringify(keep.body));
  assert.deepEqual((await head()).owners, [ids[1], ids[0]]);
  const clear = await app.call('POST', '/api/ingest', await delta({ owners: [] }));
  assert.equal(clear.status, 201, JSON.stringify(clear.body));
  assert.equal((await head()).owners, undefined);
});

test('a bad owner is a 422 that says where; a dry run creates nobody', async () => {
  const before = (await users()).length;
  const bad = await app.call('POST', '/api/ingest', await manifest({ owners: [{ externalSource: 'confluence' }] }));
  assert.equal(bad.status, 422, JSON.stringify(bad.body));
  const unknownId = await app.call('POST', '/api/ingest', await manifest({ owners: ['u_00000000'] }));
  assert.equal(unknownId.status, 422);
  assert.match(JSON.stringify(unknownId.body), /owners\[0\]/);
  for (const looks of ['u_abc', 'u_9z9z9z9z', 'u_0A1B2C3D']) { // reads as a user id, is none: never a new user named after it
    const r = await app.call('POST', '/api/ingest', await manifest({ owners: ['Dana Levi', looks] }));
    assert.equal(r.status, 422, looks);
    assert.match(JSON.stringify(r.body), new RegExp(`owners\\[1\\].*${looks}`));
  }
  assert.equal((await users()).length, before + 0, 'a rejected entry created nobody');
  const dry = await app.call('POST', '/api/ingest?dryRun=1', await manifest({ owners: ['Somebody New'] }));
  assert.equal(dry.status, 200, JSON.stringify(dry.body));
  assert.equal((await users()).length, before, 'rolled back with the dry run');
});

const edit = (slug: string, e: object) => app.call('POST', `/api/envs/hld/drafts/${slug}/edits`, { edit: e, author: 'ana' });

test('design edits: a component and a subsystem take owners as names; they read back as ids, show in the diff as changed, and [] clears', async () => {
  const slug = (await app.call('POST', '/api/envs/hld/drafts', { name: 'owners' })).body.slug as string;
  assert.equal((await edit(slug, { kind: 'component', name: 'users-svc', serviceKind: 'service', owners: ['Noa Barak', { externalSource: 'confluence', externalId: '9', name: 'Gil' }] })).status, 201);
  assert.equal((await edit(slug, { kind: 'subsystem', key: 'platform', owners: ['Noa Barak'] })).status, 201);
  const svc = (await app.call('GET', `/api/envs/hld/services/users-svc?draft=${slug}`)).body.service;
  const list = await users();
  assert.deepEqual(svc.owners.map((id: string) => list.find((u) => u.id === id).name), ['Noa Barak', 'Gil']);
  const sub = (await app.call('GET', `/api/envs/hld/subsystems?draft=${slug}`)).body.subsystems.find((s: any) => s.key === 'platform');
  assert.deepEqual(sub.owners, [svc.owners[0]]);
  const box = (await app.call('GET', `/api/envs/hld/views/subsystems?draft=${slug}`)).body.boxes.find((b: any) => b.key === 'platform');
  assert.deepEqual(box.owners, sub.owners, 'the map box carries them too (the pane reads it)');
  const ch = (await app.call('GET', `/api/envs/hld/drafts/${slug}/changes`)).body.items;
  assert.ok(ch.some((i: any) => i.anchor === 'svc:users-svc' && i.change === 'changed'), JSON.stringify(ch));
  assert.ok(ch.some((i: any) => i.anchor === 'grp:platform' && i.change === 'changed'), JSON.stringify(ch));
  const keep = await edit(slug, { kind: 'subsystem', key: 'platform', label: 'Platform core' });
  assert.equal(keep.status, 201);
  assert.deepEqual((await app.call('GET', `/api/envs/hld/subsystems?draft=${slug}`)).body.subsystems.find((s: any) => s.key === 'platform').owners, sub.owners, 'a label change keeps the owners');
  assert.equal((await edit(slug, { kind: 'component', name: 'users-svc', serviceKind: 'service', owners: [] })).status, 201);
  assert.equal((await app.call('GET', `/api/envs/hld/services/users-svc?draft=${slug}`)).body.service.owners, undefined);
  assert.equal((await edit(slug, { kind: 'component', name: 'users-svc', serviceKind: 'service', owners: [{ externalId: '1' }] })).status, 422);
  assert.equal((await edit(slug, { kind: 'subsystem', key: 'platform', owners: 'Noa' })).status, 422);
});

test('a plan: environment.groups[].owners and extensions[].owners take names and external ids', async () => {
  const slug = (await app.call('POST', '/api/envs/hld/drafts', { name: 'plan owners' })).body.slug as string;
  const r = await app.call('POST', `/api/envs/hld/drafts/${slug}/plan`, { planVersion: 1, environment: { groups: [{ key: 'edge', label: 'Edge', owners: ['Noa Barak'] }, { key: 'platform', label: 'Platform', owners: [{ name: 'Gil', externalSource: 'confluence', externalId: '9' }] }] }, extensions: [{ service: 'auth-svc', owners: ['Noa Barak'] }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const list = await users(), name = (id: string) => list.find((u) => u.id === id).name;
  const subs = (await app.call('GET', `/api/envs/hld/subsystems?draft=${slug}`)).body.subsystems;
  assert.deepEqual(subs.find((s: any) => s.key === 'edge').owners.map(name), ['Noa Barak']);
  assert.deepEqual(subs.find((s: any) => s.key === 'platform').owners.map(name), ['Gil']);
  assert.deepEqual((await app.call('GET', `/api/envs/hld/services/auth-svc?draft=${slug}`)).body.service.owners.map(name), ['Noa Barak']);
  const again = await app.call('POST', `/api/envs/hld/drafts/${slug}/plan`, { planVersion: 1, extensions: [{ service: 'auth-svc', owners: ['noa barak'] }] });
  assert.equal(again.status, 400, 'a re-import of the same owners changes nothing');
});

test('sealed settings and a Full copy keep owners; PUT without owners keeps them', async () => {
  const put = (subsystems: any[]) => app.call('PUT', '/api/envs/prod/subsystems', { subsystems });
  assert.equal((await put([{ key: 'core', label: 'Core', owners: ['Mia Katz'] }])).status, 200);
  const get = async () => (await app.call('GET', '/api/envs/prod/subsystems')).body.subsystems.find((s: any) => s.key === 'core');
  const o = (await get()).owners;
  assert.equal(o.length, 1);
  assert.equal((await put([{ key: 'core', label: 'Core 2' }])).status, 200);
  assert.deepEqual((await get()).owners, o);
  const copy = await app.call('POST', '/api/envs', { name: 'owners-copy', source: 'prod', mode: 'blank', groups: [{ key: 'core', label: 'Core', owners: ['Mia Katz'] }] });
  assert.equal(copy.status, 201, JSON.stringify(copy.body));
  assert.deepEqual((await app.call('GET', '/api/envs/owners-copy/subsystems')).body.subsystems.find((s: any) => s.key === 'core').owners, o);
  assert.equal((await put([{ key: 'core', label: 'Core', owners: [] }])).status, 200);
  assert.equal((await get()).owners, undefined);
});
