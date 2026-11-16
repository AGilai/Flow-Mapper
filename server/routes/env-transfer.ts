// Whole-environment export / import. See docs/API.md "Export and import an environment".

import type { Router } from '../http/router.ts';
import { created } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { requireRole } from '../access.ts';
import { exportEnv } from '../env-transfer/export.ts';
import { importEnv } from '../env-transfer/import.ts';
import { getDraft } from '../store/drafts.ts';
import { APP_VERSION } from '../app.ts';

export function registerEnvTransfer(r: Router, ctx: Ctx) {
  const { db } = ctx;
  r.get('/api/envs/:env/export', (req) => {
    requireRole(db, req.params.env, 'owner', req.who); // owner or admin (auth off: everyone)
    const draft = req.query.get('draft'); // the bundle always holds every draft; ?draft= is only checked, like on every other read
    if (draft) getDraft(db, req.params.env, draft);
    return exportEnv(db, req.params.env, APP_VERSION);
  });
  r.post('/api/envs/import', async (req) => {
    const dryRun = ['1', 'true'].includes(req.query.get('dryRun') ?? '');
    const out = importEnv(db, await req.json(), { as: req.query.get('as'), owner: req.query.get('owner'), dryRun });
    if (dryRun) return out;
    ctx.changed(out.env);
    return created(out);
  });
}
