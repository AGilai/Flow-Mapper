// GET /api/envs/:env/marks?against=baseline|source&draft=<slug>: what is new / changed / removed, per anchor. See docs/API.md "Marks".

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { againstOf, marksFor } from '../marks.ts';

export function registerMarks(r: Router, ctx: Ctx) {
  r.get('/api/envs/:env/marks', (req) => marksFor(ctx, req.params.env, { against: againstOf(req.query.get('against')), draft: req.query.get('draft') }));
}
