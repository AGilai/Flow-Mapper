// The subsystem level: subsystems, the roll-up map, abstract links, sealed settings and level names. See docs/API.md "Subsystems".
// Every GET takes ?draft=<slug>. Design content is written through drafts (edits of kind subsystem / abstract-link / refine-link).

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { linksFor, linkViewFor, subsystemMapFor, subsystemsFor } from '../subsystems-read.ts';
import { putLevels, putSealedSubsystems } from '../store/subsystem-settings.ts';

export function registerSubsystems(r: Router, ctx: Ctx) {
  const draft = (req: { query: URLSearchParams }) => req.query.get('draft') || null;
  r.get('/api/envs/:env/subsystems', (req) => subsystemsFor(ctx, req.params.env, draft(req)));
  r.get('/api/envs/:env/views/subsystems', (req) => subsystemMapFor(ctx, req.params.env, draft(req)));
  r.get('/api/envs/:env/abstract-links', (req) => linksFor(ctx, req.params.env, draft(req), req.query.get('subsystem')));
  r.get('/api/envs/:env/abstract-links/:id', (req) => linkViewFor(ctx, req.params.env, draft(req), req.params.id));
  r.put('/api/envs/:env/subsystems', async (req) => {
    const out = putSealedSubsystems(ctx.db, req.params.env, (await req.json())?.subsystems);
    ctx.changed(req.params.env);
    return out;
  });
  r.put('/api/envs/:env/levels', async (req) => {
    const out = putLevels(ctx.db, req.params.env, (await req.json())?.levels);
    ctx.changed(req.params.env);
    return out;
  });
}
