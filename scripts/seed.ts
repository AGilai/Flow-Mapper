// Loads manifests into the database.
//   node scripts/seed.ts                 → samples/ (+ samples/deltas/, DTOs from samples/dtos/, store schemas from samples/schemas/)
//                                          + design environments from samples/envs/*.json (a copy recipe each, plus its open drafts that import a plan; skipped when the environment exists, so edits to a design are never overwritten)
//   node scripts/seed.ts --mock [n]      → generated mock system with n services (default 100) in env 'scale-test'
//   node scripts/seed.ts --bugs          → also creates example bug reports
// Uses FLOW_DB / FLOW_DATA_DIR like the server. Existing services are replaced (version bumped).

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../server/app.ts';
import { config } from '../server/config.ts';
import * as store from '../server/store/snapshots.ts';
import { loadDtos } from '../server/store/dtos.ts';
import { loadSchemas } from '../server/store/schemas.ts';
import { loadDescriptions } from '../server/store/descriptions.ts';
import { loadComments } from '../server/store/comments.ts';
import { loadActionItems } from '../server/store/action-items-io.ts';
import { listFlowNames, putFlowName } from '../server/store/flow-names.ts';
import { putKeys } from '../server/store/keys.ts';
import { stores } from '../core/stores.ts';
import { seedEnvRecipes } from './seed-envs.ts';
import { generateMock } from './mock/generate.ts';
import { seedBugs } from './mock/bugs.ts';

const args = process.argv.slice(2);
const ctx = createContext({ dbPath: config.dbPath, dataDir: config.dataDir });

const readDir = (dir: string) => existsSync(dir)
  ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  : [];

let manifests: any[];
const mockIdx = args.indexOf('--mock');
if (mockIdx >= 0) {
  const n = Number(args[mockIdx + 1]) || 100;
  manifests = generateMock({ services: n, seed: 7, env: 'scale-test' });
} else {
  const root = join(import.meta.dirname, '../samples');
  manifests = [...readDir(root), ...readDir(join(root, 'deltas'))];
}

const envs = new Set<string>();
for (const m of manifests) {
  const env = m.env ?? 'default';
  const cur = store.getSnapshotRow(ctx.db, env, m.service.name);
  // Re-seeding: lift versions above what is stored so ingest accepts them.
  if (cur && m.kind === 'full' && m.version <= cur.version) m.version = cur.version + 1;
  if (cur && m.kind === 'delta' && m.baseVersion !== cur.version) continue;
  store.ingest(ctx.db, m, 'seed');
  envs.add(env);
}
envs.forEach((e) => ctx.changed(e));
if (mockIdx < 0) {
  for (const f of readDir(join(import.meta.dirname, '../samples/dtos'))) console.log(`loaded ${loadDtos(ctx.db, f.env, f.dtos).loaded} DTOs into ${f.env}`);
  for (const f of readDir(join(import.meta.dirname, '../samples/descriptions'))) {
    console.log(`loaded ${loadDescriptions(ctx.db, ctx.graph(f.env), f.env, f.descriptions, (m) => console.warn(m))} descriptions into ${f.env}`);
  }
  for (const f of readDir(join(import.meta.dirname, '../samples/comments'))) {
    console.log(`loaded ${loadComments(ctx.db, ctx.graph(f.env), f.env, f.comments, (m) => console.warn(m))} comments into ${f.env}`);
  }
  for (const f of readDir(join(import.meta.dirname, '../samples/action-items'))) {
    console.log(`loaded ${loadActionItems(ctx.db, ctx.graph(f.env), f.env, f.items, (m) => console.warn(m))} action items into ${f.env}`);
  }
  for (const f of readDir(join(import.meta.dirname, '../samples/keys'))) {
    for (const i of f.instances) console.log(`pushed ${putKeys(ctx.db, ctx.graph(f.env), f.env, i.instance, { keys: i.keys, producer: i.producer }).entries} key entries to ${i.instance} in ${f.env}`);
  }
  for (const f of readDir(join(import.meta.dirname, '../samples/schemas'))) {
    const keys = new Set(stores(ctx.graph(f.env)).map((s) => s.key));
    console.log(`loaded ${loadSchemas(ctx.db, f.env, f.schemas, (k) => keys.has(k)).loaded} store schemas into ${f.env}`);
  }
}
if (mockIdx < 0) {
  seedEnvRecipes(ctx, join(import.meta.dirname, '../samples/envs'), console.log);
  // Design environments exist only now: their descriptions (titles) load on this run, not on a second seed.
  for (const f of readDir(join(import.meta.dirname, '../samples/descriptions')).filter((x) => !envs.has(x.env))) {
    console.log(`loaded ${loadDescriptions(ctx.db, ctx.graph(f.env), f.env, f.descriptions, () => {})} descriptions into ${f.env}`);
  }
  // 0.32.5: flow names of a design (a name someone already gave is kept); they show the natural order of the Flows list.
  for (const f of readDir(join(import.meta.dirname, '../samples/flow-names'))) {
    const have = new Set(listFlowNames(ctx.db, f.env).map((n) => `${n.service}/${n.ingress}`));
    let n = 0;
    for (const x of f.names) if (!have.has(`${x.service}/${x.ingress}`)) { putFlowName(ctx.db, ctx.graph(f.env), f.env, { ...x, author: 'seed' }); n++; }
    console.log(`loaded ${n} flow names into ${f.env}`);
  }
}
console.log(`seeded ${manifests.length} manifests into ${[...envs].join(', ')} (${config.dbPath})`);

if (args.includes('--bugs')) {
  const n = seedBugs(ctx, [...envs][0] ?? 'default');
  console.log(`created ${n} bugs`);
}
