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
