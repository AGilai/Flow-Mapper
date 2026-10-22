// Flow descriptions over REST. Read: the records of one flow with their outdated flags. Write: the human record only;
// the AI record is written through MCP (set_description). See docs/API.md.

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest } from '../errors.ts';
import * as desc from '../store/descriptions.ts';

export function registerDescriptions(r: Router, ctx: Ctx) {
  r.get('/api/envs/:env/descriptions', (req) => {
    const service = req.query.get('service'), ingress = req.query.get('ingress');
    if (!service || !ingress) throw badRequest('service and ingress are required');
    return desc.describeFlow(ctx.db, ctx.graphOf(req), req.params.env, service, ingress);
  });

  r.put('/api/envs/:env/descriptions', async (req) => {
    const b = await req.json();
    return desc.putHuman(ctx.db, ctx.view(req.params.env).g, req.params.env, { service: b?.service, ingress: b?.ingress, callee: b?.callee, text: b?.text, title: b?.title, editedBy: b?.editedBy });
  });
}
