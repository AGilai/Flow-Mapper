// Flow names: GET /api/envs/:env/flow-names[?draft=] and PUT /api/envs/:env/flow-names. An annotation (any environment, no draft); see docs/API.md "Flow names".

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { listFlowNames, putFlowName } from '../store/flow-names.ts';

export function registerFlowNames(r: Router, ctx: Ctx) {
  r.get('/api/envs/:env/flow-names', (req) => listFlowNames(ctx.db, req.params.env, req.query.get('draft')));
  r.put('/api/envs/:env/flow-names', async (req) => {
    const b = await req.json();
    return putFlowName(ctx.db, ctx.graph(req.params.env), req.params.env, { service: b?.service, ingress: b?.ingress, name: b?.name, author: b?.author, links: b?.links });
  });
}
