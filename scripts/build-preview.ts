// Builds a static, server-less preview of the UI into dist/preview/:
// web/ as-is, core/ type-stripped to .js, and data.js with the sample (prod) and mock (scale-test)
// systems plus example bugs and endpoint DTOs. The UI runs core/ in the browser via web/js/api-local.js.
//
//   node scripts/build-preview.ts [--services 100] [--out <dir>]

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext } from '../server/app.ts';
import { transpileCore } from '../server/http/static.ts';
import * as store from '../server/store/snapshots.ts';
import * as bugs from '../server/store/bugs.ts';
import * as dtos from '../server/store/dtos.ts';
import * as schemas from '../server/store/schemas.ts';
import * as descriptions from '../server/store/descriptions.ts';
import * as keys from '../server/store/keys.ts';
import { seedEnvRecipes } from './seed-envs.ts';
import { listEnvMeta } from '../server/store/envs.ts';
import { envItemRows, baselineRows } from '../server/store/item-rows.ts';
import { listDrafts, loadOps } from '../server/store/drafts.ts';
import { stores } from '../core/stores.ts';
import { dbReader } from '../server/draft-reader.ts';
import { generateMock } from './mock/generate.ts';
import { seedBugs } from './mock/bugs.ts';

const root = join(import.meta.dirname, '..');
const outIdx = process.argv.indexOf('--out');
const out = outIdx > 0 ? process.argv[outIdx + 1] : join(root, 'dist/preview');
const nIdx = process.argv.indexOf('--services');
const n = nIdx > 0 ? Number(process.argv[nIdx + 1]) : 100;

const tmp = mkdtempSync(join(tmpdir(), 'flow-preview-'));
const ctx = createContext({ dbPath: join(tmp, 'p.db'), dataDir: tmp });
const samples = join(root, 'samples');
const read = (d: string) => readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')));
for (const m of [...read(samples), ...read(join(samples, 'deltas')), ...generateMock({ services: n, seed: 7, env: 'scale-test' })]) store.ingest(ctx.db, m, 'seed');
for (const env of store.listEnvs(ctx.db)) ctx.changed(env);
seedBugs(ctx, 'prod');
for (const f of read(join(samples, 'dtos'))) dtos.loadDtos(ctx.db, f.env, f.dtos);
for (const f of read(join(samples, 'descriptions'))) descriptions.loadDescriptions(ctx.db, ctx.graph(f.env), f.env, f.descriptions);
for (const f of read(join(samples, 'keys'))) for (const i of f.instances) keys.putKeys(ctx.db, ctx.graph(f.env), f.env, i.instance, { keys: i.keys, producer: i.producer });
for (const f of read(join(samples, 'schemas'))) {
  const keys = new Set(stores(ctx.graph(f.env)).map((s) => s.key));
  schemas.loadSchemas(ctx.db, f.env, f.schemas, (k) => keys.has(k));
}

seedEnvRecipes(ctx, join(samples, 'envs'));

const metas = listEnvMeta(ctx.db), designs = metas.filter((e) => e.kind === 'design').map((e) => e.name);
// a design's rows, and the rows of every environment a design was taken from (an import reads them)
const withRows = [...new Set([...designs, ...metas.filter((e) => e.kind === 'design' && e.source).map((e) => e.source as string)])];
const data = {
  version: ctx.appVersion,
  envMeta: listEnvMeta(ctx.db),
  models: Object.fromEntries(store.listEnvs(ctx.db).map((env) => [env, store.loadModel(ctx.db, env)])),
  dtos: Object.fromEntries(store.listEnvs(ctx.db).map((env) => [env, dtos.listDtos(ctx.db, env)])),
  eventDtos: Object.fromEntries(store.listEnvs(ctx.db).map((env) => [env, dtos.listEventDtos(ctx.db, env)])),
  descriptions: Object.fromEntries(store.listEnvs(ctx.db).map((env) => [env, descriptions.allRows(ctx.db, env)])),
  keys: Object.fromEntries(store.listEnvs(ctx.db).map((env) => [env, keys.allForPreview(ctx.db, env)])),
  schemas: Object.fromEntries(store.listEnvs(ctx.db).map((env) => [env, schemas.listSchemas(ctx.db, env)])),
  // Design environments: their rows, their frozen baseline and their open drafts with ops, so the page can compute marks and draft views with core/.
  rows: Object.fromEntries(withRows.map((env) => [env, envItemRows(ctx.db, env)])),
  baselines: Object.fromEntries(designs.map((env) => [env, baselineRows(ctx.db, env)])),
  flowTexts: Object.fromEntries(store.listEnvs(ctx.db).map((env) => [env, [...dbReader(ctx.db, env).flowTexts()]])),
  drafts: Object.fromEntries(designs.map((env) => [env, listDrafts(ctx.db, env, 'open').map((d) => ({ ...d, ops: loadOps(ctx.db, d.id) }))])),
  bugs: bugs.listBugs(ctx.db, {}, ctx.appVersion).map((b) => {
    const full = bugs.getBug(ctx.db, b.id, ctx.appVersion);
    return { ...full, attachments: full.attachments.map((a: any) => ({ ...a, id: a.id })) };
  }),
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'core'), { recursive: true });
cpSync(join(root, 'web'), out, { recursive: true });
/** core/ and its subfolders (core/diff/): every .ts type-stripped to .js, same relative paths. */
function copyCore(dir: string, to: string) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) copyCore(join(dir, e.name), join(to, e.name));
    else if (e.name.endsWith('.ts')) writeFileSync(join(to, e.name.replace(/\.ts$/, '.js')), transpileCore(readFileSync(join(dir, e.name), 'utf8')));
  }
}
copyCore(join(root, 'core'), join(out, 'core'));
writeFileSync(join(out, 'data.js'), `globalThis.FLOW_PREVIEW = ${JSON.stringify(data)};\n`);
const html = readFileSync(join(out, 'index.html'), 'utf8').replace('<script type="module" src="js/main.js">', '<script src="data.js"></script>\n  <script type="module" src="js/main.js">');
writeFileSync(join(out, 'index.html'), html);
// Body-only variant for hosts that supply their own document skeleton (claude.ai artifacts).
const body = html.replace(/^[\s\S]*<head>/, '').replace(/<\/head>\s*<body>/, '').replace(/<\/body>\s*<\/html>\s*$/, '')
  .replace(/<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*/, '').replace('<title>Flow-Mapper</title>', '<title>Flow-Mapper Preview</title>');
writeFileSync(join(out, 'app.html'), body.trim() + '\n');
rmSync(tmp, { recursive: true, force: true });
const size = (readFileSync(join(out, 'data.js')).length / 1024 / 1024).toFixed(1);
console.log(`preview → ${out} (data.js ${size} MB, envs: ${Object.keys(data.models).join(', ')}, ${data.bugs.length} bugs)`);
