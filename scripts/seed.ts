// Loads manifests into the database.
//   node scripts/seed.ts                 → samples/ (+ samples/deltas/)
//   node scripts/seed.ts --mock [n]      → generated mock system with n services (default 100) in env 'scale-test'
//   node scripts/seed.ts --bugs          → also creates example bug reports
// Uses FLOW_DB / FLOW_DATA_DIR like the server. Existing services are replaced (version bumped).

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../server/app.ts';
import { config } from '../server/config.ts';
import * as store from '../server/store/snapshots.ts';
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
console.log(`seeded ${manifests.length} manifests into ${[...envs].join(', ')} (${config.dbPath})`);

if (args.includes('--bugs')) {
  const n = seedBugs(ctx, [...envs][0] ?? 'default');
  console.log(`created ${n} bugs`);
}
