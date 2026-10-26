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
    const out = desc.describeFlow(ctx.db, ctx.graphOf(req), req.params.env, service, ingress);
    // A draft's own flow description (0.45.0, #91): shown until the draft is applied, when no human note is stored for the flow.
    const draft = req.query.get('draft');
    const own = draft && !out.flow.human ? ctx.view(req.params.env, draft).reader.flowText(service, ingress)?.description : undefined;
    return own ? { ...out, flow: { ...out.flow, human: { text: own, title: null, editedBy: 'draft', editedAt: new Date(0).toISOString() } } } : out;
  });

  r.put('/api/envs/:env/descriptions', async (req) => {
    const b = await req.json();
    // ?draft=<slug>: the flow may exist only in that draft (#93), so it is checked against the draft's view; the record is stored for the env.
    return desc.putHuman(ctx.db, ctx.view(req.params.env, req.query.get('draft')).g, req.params.env, { service: b?.service, ingress: b?.ingress, callee: b?.callee, text: b?.text, title: b?.title, editedBy: b?.editedBy });
  });
}
