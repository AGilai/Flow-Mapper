// The static preview computes marks and draft views in the browser with the same core/ as the server: for sase-hld + hld-import the marks, the draft
// list and the draft's changes equal what the server answers; drafts work in memory; Apply is refused with one sentence.
// Builds a small preview (--services 5) into dist/test-preview and imports api-local-design.js from it.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SAMPLES, startApp } from './helpers.ts';
import { seedEnvRecipes } from '../scripts/seed-envs.ts';

const root = join(import.meta.dirname, '..'), out = join(root, 'dist/test-preview');
let design: any, data: any, app: Awaited<ReturnType<typeof startApp>>;

before(async () => {
  rmSync(out, { recursive: true, force: true });
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'scripts/build-preview.ts'), '--services', '5', '--out', out], { stdio: 'pipe' });
  writeFileSync(join(out, 'package.json'), '{"type":"module"}');
  data = new Function(`const globalThis = {}; ${readFileSync(join(out, 'data.js'), 'utf8')}; return globalThis.FLOW_PREVIEW;`)();
  const { buildIndex } = await import(pathToFileURL(join(out, 'core/graph-index.js')).href);
  const { createDesign } = await import(pathToFileURL(join(out, 'js/api-local-design.js')).href);
  design = createDesign(data, (env: string) => buildIndex(data.models[env]));
  app = await startApp();
  const all = (d: string) => readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')));
  await app.call('POST', '/api/ingest', { manifests: all(SAMPLES) });
  for (const f of all(join(SAMPLES, 'dtos'))) await app.call('POST', `/api/envs/${f.env}/dtos`, { dtos: f.dtos });
  const sc = JSON.parse(readFileSync(join(SAMPLES, 'schemas/prod.json'), 'utf8'));
  await app.call('POST', `/api/envs/${sc.env}/schemas`, { schemas: sc.schemas });
  seedEnvRecipes(app.ctx, join(SAMPLES, 'envs'));
});
after(async () => { await app.close(); rmSync(out, { recursive: true, force: true }); });

const strip = (m: any) => ({ against: m.against, draft: m.draft, source: m.source, marks: m.marks, ghosts: m.ghosts, counts: m.counts });

test('marks of the demo draft equal the server\'s, in baseline and in source mode, with and without the draft', async () => {
  for (const [draft, against] of [['hld-import', 'baseline'], ['hld-import', 'source'], [null, 'baseline'], [null, 'source']] as const) {
    design.readAs('sase-hld', draft);
    const local = await design.api.marks('sase-hld', against);
    const q = `?against=${against}${draft ? `&draft=${draft}` : ''}`;
    const server = (await app.call('GET', `/api/envs/sase-hld/marks${q}`)).body;
    assert.deepEqual(strip(local), strip(server), q);
    assert.equal(local.baselineAt, data.envMeta.find((m: any) => m.name === 'sase-hld').copiedAt);
  }
  design.readAs('sase-hld', 'hld-import');
  const m = await design.api.marks('sase-hld', 'baseline');
  assert.equal(m.marks['svc:sase-agent'].mark, 'new');
  assert.equal(m.marks['svc:auth-svc'].what, '+1 endpoint · +1 function');
  design.readAs('prod', null);
  assert.deepEqual((await design.api.marks('prod', 'baseline')).marks, {}, 'a sealed environment has no marks');
});

test('draft list and changes equal the server\'s; reads with the draft see the overlay, reads without it do not', async () => {
  design.readAs('sase-hld', null);
  const list = await design.api.drafts('sase-hld'), srv = (await app.call('GET', '/api/envs/sase-hld/drafts')).body;
  assert.deepEqual(list.map((d: any) => [d.slug, d.name, d.ops, d.counts, d.authors]), srv.map((d: any) => [d.slug, d.name, d.ops, d.counts, d.authors]));
  const ch = await design.api.draftChanges('sase-hld', 'hld-import'), sch = (await app.call('GET', '/api/envs/sase-hld/drafts/hld-import/changes')).body;
  assert.deepEqual([ch.counts, ch.items.map((i: any) => [i.anchor, i.change, i.under ?? null])], [sch.counts, sch.items.map((i: any) => [i.anchor, i.change, i.under ?? null])]);
  const names = (g: any) => g.model.services.map((s: any) => s.name);
  assert.ok(!names(design.g('sase-hld')).includes('sase-agent'));
  design.readAs('sase-hld', 'hld-import');
  assert.ok(names(design.g('sase-hld')).includes('sase-agent'));
  assert.ok(design.dtosOf('sase-hld').length >= (data.dtos['sase-hld'] ?? []).length);
  design.readAs('prod', 'hld-import');
  assert.ok(!names(design.g('prod')).includes('sase-agent'), 'a draft belongs to its environment only');
});

test('drafts live in memory: create, edit, undo, revert, discard; Apply is refused with one sentence', async () => {
  design.readAs('sase-hld', null);
  const d = await design.api.createDraft('sase-hld', 'My try', 'me');
  assert.equal(d.slug, 'my-try'); assert.equal((await design.api.createDraft('sase-hld', 'My try', 'me')).slug, 'my-try-2');
  await assert.rejects(() => design.api.createDraft('prod', 'x'), /sealed/);
  design.readAs('sase-hld', 'my-try');
  const op = { op: 'upsert', anchor: 'svc:tmp-svc', data: { kind: 'service', team: 't' } };
  await design.api.editDraft('sase-hld', 'my-try', [op], 'me');
  let m = await design.api.marks('sase-hld', 'baseline');
  assert.equal(m.marks['svc:tmp-svc'].mark, 'new', 'the mark follows the edit at once');
  assert.deepEqual((await design.api.draftChanges('sase-hld', 'my-try')).counts, { added: 1, removed: 0, changed: 0 });
  await design.api.editDraft('sase-hld', 'my-try', [{ op: 'delete', anchor: 'svc:users-svc' }], 'me');
  m = await design.api.marks('sase-hld', 'baseline');
  assert.equal(m.marks['svc:users-svc'].mark, 'removed'); assert.ok(m.ghosts['svc:users-svc']);
  await design.api.revertDraftItem('sase-hld', 'my-try', 'svc:users-svc');
  await design.api.undoDraft('sase-hld', 'my-try');
  assert.equal((await design.api.drafts('sase-hld')).find((x: any) => x.slug === 'my-try').ops, 0);
  await assert.rejects(() => design.api.editDraft('sase-hld', 'my-try', [{ op: 'upsert', anchor: 'nope' }], 'me'), /anchor/);
  await assert.rejects(() => design.api.applyDraft('sase-hld', 'my-try', 'me'), (e: any) => e.message === 'Apply is not available in the preview: it needs the server.');
  await design.api.discardDraft('sase-hld', 'my-try');
  assert.ok(!(await design.api.drafts('sase-hld')).some((x: any) => x.slug === 'my-try'));
  await assert.rejects(() => design.api.editDraft('sase-hld', 'my-try', [op], 'me'), /discarded/);
});

// 0.25.0: references, import, edit forms, calls and flow names in the preview equal what the server answers.
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const noAt = (refs: any) => ({ ...refs, origins: Object.fromEntries(Object.entries(refs.origins).map(([k, v]: any) => [k, { ...v, at: v.inDraft ? 'when' : v.at }])) }); // an import's time differs between the two backends
const withRefs = (m: any) => ({ ...strip(m), refs: noAt(m.refs) });
const srv = async (method: string, path: string, body?: unknown) => { const r = await app.call(method, path, body); assert.ok(r.status < 300, `${method} ${path}: ${JSON.stringify(r.body)}`); return r.body; };

test('13 marks carry the same refs; the trace and the call are decorated like the server\'s', async () => {
  for (const draft of ['hld-import', null]) {
    design.readAs('sase-hld', draft);
    const local = await design.api.marks('sase-hld', 'baseline');
    assert.deepEqual(json(withRefs(local)), withRefs(await srv('GET', `/api/envs/sase-hld/marks${draft ? `?draft=${draft}` : ''}`)), String(draft));
  }
  assert.ok(json((await design.api.marks('sase-hld', 'baseline')).refs.endpoints['ing:users-svc/in.getPosture']), 'the demo reference');
  design.readAs('sase-hld', 'hld-import');
  const { trace } = await import(pathToFileURL(join(out, 'core/trace.js')).href);
  const g = design.g('sase-hld'), t = trace(g, { service: 'sase-agent', ingress: 'in.tunnel.open' }, { scope: 'full', maxDepth: 25, maxMessages: 500 });
  assert.deepEqual(json(design.traceOut('sase-hld', t, g)), await srv('GET', '/api/envs/sase-hld/trace?detail=full&service=sase-agent&ingress=in.tunnel.open&draft=hld-import'));
  assert.equal(design.traceOut('sase-hld', t, g).partial.steps.length, 1);
  assert.deepEqual(json(await design.api.call('sase-hld', 'pop-edge', 'out.users.posture')), await srv('GET', '/api/envs/sase-hld/call?service=pop-edge&egress=out.users.posture&draft=hld-import'));
  assert.equal(design.traceOut('prod', trace(design.g('prod'), { service: 'users-svc', ingress: 'in.getPosture' }, { scope: 'full' }), design.g('prod')).partial, undefined, 'a sealed environment: nothing added');
});

test('13 import preview, import and edit forms in memory equal the server (ops, changes, marks with refs)', async () => {
  await srv('POST', '/api/envs/sase-hld/drafts', { name: 'cmp', slug: 'cmp' });
  await design.api.createDraft('sase-hld', 'cmp', 'me');
  const P = { source: 'prod', anchor: 'ing:users-svc/in.getPosture' };
  design.readAs('sase-hld', 'cmp');
  assert.deepEqual(json(await design.api.importPreview('sase-hld', 'cmp', P)), await srv('GET', `/api/envs/sase-hld/drafts/cmp/import/preview?source=prod&anchor=${encodeURIComponent(P.anchor)}`));
  const li = await design.api.importIntoDraft('sase-hld', 'cmp', P, 'me'), si = await srv('POST', '/api/envs/sase-hld/drafts/cmp/import', { ...P, author: 'me' });
  assert.deepEqual(json(li.preview), si.preview); assert.deepEqual(li.counts, si.counts);
  const edits = [{ kind: 'component', name: 'pop-swg', serviceKind: 'service', groupPath: 'network' },
    { kind: 'call', from: { service: 'users-svc', fn: 'get_posture' }, to: { endpoint: { service: 'pop-swg', transport: 'socket', bindKey: 'socket:tls/pop-swg/apply' } } }];
  for (const e of edits) { const l = await design.api.designEdit('sase-hld', 'cmp', e, 'me'), s = await srv('POST', '/api/envs/sase-hld/drafts/cmp/edits', { edit: e, author: 'me' }); assert.deepEqual(json(l.ops), s.ops); assert.deepEqual(l.counts, s.counts); }
  await assert.rejects(() => design.api.designEdit('sase-hld', 'cmp', { kind: 'component', name: 'Bad Name', serviceKind: 'service' }, 'me'), (e: any) => e.status === 422 && e.code === 'BAD_NAME' && e.details.field === 'name');
  await assert.rejects(() => design.api.designEdit('sase-hld', 'cmp', { kind: 'component', name: 'x', serviceKind: 'service', groupPath: 'nope' }, 'me'), (e: any) => e.code === 'NO_GROUP');
  await assert.rejects(() => design.api.importPreview('sase-hld', 'cmp', P), (e: any) => e.status === 409 && e.code === 'NOTHING_TO_IMPORT');
  const ch = await design.api.draftChanges('sase-hld', 'cmp'), sch = await srv('GET', '/api/envs/sase-hld/drafts/cmp/changes');
  assert.deepEqual([ch.counts, ch.items.map((i: any) => [i.anchor, i.change])], [sch.counts, sch.items.map((i: any) => [i.anchor, i.change])]);
  for (const against of ['baseline', 'source']) assert.deepEqual(json(withRefs(await design.api.marks('sase-hld', against))), withRefs(await srv('GET', `/api/envs/sase-hld/marks?draft=cmp&against=${against}`)), against);
  assert.equal((await design.api.marks('sase-hld', 'baseline')).refs.endpoints['ing:users-svc/in.getPosture'], undefined, 'imported: no longer a reference');
});

test('13 flow names in memory; Apply stays refused', async () => {
  design.readAs('sase-hld', null);
  const r = await design.api.setFlowName('sase-hld', { service: 'users-svc', ingress: 'in.getUser', name: ' Renamed ' });
  assert.deepEqual(r, { service: 'users-svc', ingress: 'in.getUser', name: 'Renamed' });
  assert.equal(design.texts('sase-hld').get('users-svc/in.getUser').name, 'Renamed');
  assert.deepEqual((await design.api.flowNames('sase-hld')).map((x: any) => x.name), ['Renamed']);
  await design.api.setFlowName('sase-hld', { service: 'users-svc', ingress: 'in.getUser', name: '' });
  assert.deepEqual(await design.api.flowNames('sase-hld'), []);
  await assert.rejects(() => design.api.setFlowName('sase-hld', { service: 'users-svc', ingress: 'nope', name: 'x' }), (e: any) => e.code === 'NO_INGRESS');
  await assert.rejects(() => design.api.applyDraft('sase-hld', 'hld-import', 'me'), /not available in the preview/);
});

test('0.28 subsystems: the preview\'s subsystems, map, links and suggestions equal the server\'s for sase-hld + hld-import; the new edit kinds work in memory', async () => {
  const E = '/api/envs/sase-hld';
  design.readAs('sase-hld', 'hld-import');
  for (const [local, path] of [[design.api.subsystems('sase-hld'), `${E}/subsystems`], [design.api.subsystemMap('sase-hld'), `${E}/views/subsystems`],
    [design.api.flowRelations('sase-hld'), `${E}/flow-relations`],
    [design.api.abstractLinks('sase-hld'), `${E}/abstract-links`], [design.api.abstractLink('sase-hld', 'usage-metering'), `${E}/abstract-links/usage-metering`]] as const) {
    assert.deepEqual(JSON.parse(JSON.stringify(await local)), (await app.call('GET', `${path}?draft=hld-import`)).body, path);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(await design.api.flowRelations('sase-hld', { service: 'auth-svc', ingress: 'in.token.device' }))), (await app.call('GET', `${E}/flow-relations?service=auth-svc&ingress=in.token.device&draft=hld-import`)).body);
  design.readAs('sase-hld', null);
  assert.deepEqual(await design.api.flowRelations('sase-hld'), []); assert.deepEqual(await design.api.flowRelations('prod'), []);
  assert.deepEqual((await design.api.subsystemMap('sase-hld')).abstract, []);
  design.readAs('sase-hld', 'hld-import');
  await design.api.createDraft('sase-hld', 'Sub try', 'me');
  design.readAs('sase-hld', 'sub-try');
  await design.api.designEdit('sase-hld', 'sub-try', { kind: 'subsystem', key: 'agent', icon: 'cloud' });
  await design.api.designEdit('sase-hld', 'sub-try', { kind: 'abstract-link', name: 'agent to platform', from: 'grp:agent', to: 'grp:platform' });
  const l = await design.api.abstractLink('sase-hld', 'agent-to-platform');
  assert.equal(l.state, 'abstract');
  await design.api.designEdit('sase-hld', 'sub-try', { kind: 'refine-link', id: 'agent-to-platform', to: 'svc:auth-svc' });
  assert.equal((await design.api.abstractLink('sase-hld', 'agent-to-platform')).state, 'partial');
  assert.equal((await design.api.marks('sase-hld', 'baseline')).marks['link:agent-to-platform'].mark, 'new');
  await assert.rejects(() => design.api.designEdit('sase-hld', 'sub-try', { kind: 'delete', anchor: 'grp:platform' }), /still used by/);
  await assert.rejects(() => design.api.editDraft('sase-hld', 'sub-try', [{ op: 'upsert', anchor: 'svc:auth-svc', data: { kind: 'service', groupPath: 'agent', alsoIn: ['platform'] } }]), /./);
  await assert.rejects(() => design.api.applyDraft('sase-hld', 'sub-try'), /Apply is not available in the preview/);
  design.readAs('sase-hld', null);
  assert.equal((await design.api.putSubsystems('prod', [{ key: 'core', label: 'Core', icon: 'shield' }])).subsystems[0].icon, 'shield');
  await assert.rejects(() => design.api.putSubsystems('sase-hld', []), (e: any) => e.code === 'USE_DRAFT');
  assert.deepEqual(await design.api.putLevels('prod', ['A', 'B']), { levels: ['A', 'B'] });
  assert.equal((await design.api.subsystems('prod')).subsystems[0].key, 'core');
});
