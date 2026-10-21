// Design environments of the samples (samples/envs/*.json): a copy recipe each, plus open drafts that import a plan
// (`"drafts": [{"slug", "name", "plan": "<file next to the recipe>"}]`). seed.ts and build-preview.ts both replay them here.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Ctx } from '../server/context.ts';
import { copyEnv } from '../server/store/env-copy.ts';
import { getEnvRow } from '../server/store/envs.ts';
import { createDraft } from '../server/store/drafts.ts';
import { ingestPlan } from '../server/store/draft-plan.ts';

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

/** Create every recipe's environment that does not exist yet (an existing design is never overwritten) and its open drafts. */
export function seedEnvRecipes(ctx: Ctx, dir: string, log: (m: string) => void = () => {}) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.plan.json')).sort()) {
    const { drafts = [], ...recipe } = readJson(join(dir, f));
    if (getEnvRow(ctx.db, recipe.name)) { log(`design environment ${recipe.name} exists, left as it is`); continue; }
    const made = copyEnv(ctx.db, recipe);
    ctx.changed(made.name);
    log(`created design environment ${made.name} from ${made.source}: ${made.counts.components} components`);
    for (const d of drafts) {
      createDraft(ctx.db, made.name, { name: d.name, slug: d.slug, createdBy: recipe.createdBy ?? 'seed' });
      const r = ingestPlan(ctx.db, made.name, d.slug, readJson(join(dir, d.plan)), { author: recipe.createdBy ?? 'seed' });
      ctx.changedDraft(made.name, d.slug);
      log(`opened draft ${d.slug} in ${made.name}: ${r.ops} ops from ${d.plan} (+${r.counts.added} -${r.counts.removed} ~${r.counts.changed}), ${r.warnings.length} warning(s)`);
    }
  }
}
