// Flow relations (0.28.2, #50): typed links between two entry-point flows. Design environments only (a sealed one answers []). Written through drafts
// (edit kind flow-relation, delete rel:<id>); see docs/API.md "Flow relations".

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { HttpError } from '../errors.ts';
import { REL_TYPES } from '../../core/flow-relations.ts';
import { relationsFor } from '../relations-read.ts';

export function registerFlowRelations(r: Router, ctx: Ctx) {
  r.get('/api/envs/:env/flow-relations', (req) => {
    const q = req.query, type = q.get('type');
    if (type && !(REL_TYPES as readonly string[]).includes(type)) throw new HttpError(422, 'INVALID', `type must be one of ${REL_TYPES.join(', ')}`);
    if (!!q.get('service') !== !!q.get('ingress')) throw new HttpError(422, 'INVALID', 'give service and ingress together (one flow), or neither');
    return relationsFor(ctx, req.params.env, q.get('draft') || null, { service: q.get('service'), ingress: q.get('ingress'), type });
  });
}
