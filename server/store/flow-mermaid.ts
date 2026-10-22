// A flow as Mermaid text (0.27.4): the full trace of one entry endpoint, the flow's name and description, and its step descriptions.
// Reads only, in every environment (sealed or design, and a design as an open draft would leave it).

import type { Ctx } from '../context.ts';
import { HASH_TRACE } from '../../core/description.ts';
import { exportMermaid } from '../../core/mermaid-export.ts';
import { trace } from '../../core/trace.ts';
import { badRequest, notFound } from '../errors.ts';
import { describeFlow } from './descriptions.ts';
import { listThread } from './comments.ts';
import { flowAnchor } from '../../core/comments.ts';
import { plainText } from '../../core/rich-text-text.ts';

export function flowMermaid(ctx: Ctx, env: string, draft: string | null, service: unknown, ingress: unknown): string {
  if (typeof service !== 'string' || !service || typeof ingress !== 'string' || !ingress) throw badRequest('service and ingress are required: the flow\'s entry endpoint');
  const { g, reader } = ctx.view(env, draft);
  const t = trace(g, { service, ingress }, HASH_TRACE) ?? (() => { throw notFound(`ingress '${ingress}' of service '${service}' in env '${env}'`); })();
  const text = reader.flowText(service, ingress);
  const ranges = listThread(ctx.db, env, flowAnchor(service, ingress)).comments.filter((c) => c.steps && !c.resolved && !c.deleted).map((c) => ({ ...c.steps!, text: plainText(c.body).split('\n')[0] })); // 0.34.0: open comments on a range of steps
  return exportMermaid(t, { name: text?.name, description: text?.description, links: text?.links, descriptions: describeFlow(ctx.db, g, env, service, ingress), ranges });
}
