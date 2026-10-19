// Example bug reports so the bugs pages have realistic content.

import type { Ctx } from '../../server/context.ts';
import * as bugs from '../../server/store/bugs.ts';

export function seedBugs(ctx: Ctx, env: string): number {
  const g = ctx.graph(env);
  const svc = (i: number) => g.model.services.filter((s) => s.kind === 'service')[i % Math.max(1, g.model.services.length - 1)]?.name ?? 'unknown';
  const dangling = g.resolution.dangling[0];
  const list = [
    { title: 'Sequence view freezes on flows with more than 300 messages', severity: 'S2', appVersion: '0.1.0', reporter: 'dana', channel: 'web',
      description: 'Opening the full flow for the checkout entry point locks the tab for ~10s.', links: [{ type: 'service', id: svc(0) }] },
    { title: 'Delta ingest rejected after harvester retry', severity: 'S1', appVersion: '0.2.0', reporter: 'harvester-bot', channel: 'api',
      description: 'Harvester retried a delta after a timeout; second attempt got VERSION_MISMATCH and the fallback full ingest was never sent.',
      steps: '1. send delta v13 (base 12)\n2. network timeout, retry\n3. 409 VERSION_MISMATCH' },
    { title: `Dangling call shown for ${dangling ? dangling.service : svc(2)} after route rename`, severity: 'S3', appVersion: '0.2.0', reporter: 'agent', channel: 'mcp',
      links: dangling ? [{ type: 'egress', service: dangling.service, id: dangling.id }] : [] },
    { title: 'System view labels overlap at default zoom', severity: 'S4', appVersion: '0.2.0', reporter: 'yossi', channel: 'web' },
    { title: 'Wildcard SNS subscription not shown in service view', severity: 'S3', appVersion: '0.1.0', reporter: 'dana', channel: 'web',
      links: [{ type: 'service', id: svc(10) }] },
    { title: 'MCP trace_flow returns empty for cron entry points', severity: 'S2', appVersion: '0.2.0', reporter: 'agent', channel: 'mcp' },
  ];
  const ids = list.map((b) => bugs.createBug(ctx.db, ctx.graph, { ...b, env } as any, ctx.appVersion));
  bugs.addAttachment(ctx.db, ctx.graph, ctx.dataDir, ids[1], 'harvester.log', 'text/plain', Buffer.from(
    `2026-10-19T08:00:01Z INFO  harvest ${svc(1)} start\n2026-10-19T08:00:04Z WARN  POST /api/ingest timeout after 3000ms\n` +
    `2026-10-19T08:00:05Z INFO  retry 1/3\n2026-10-19T08:00:05Z ERROR 409 VERSION_MISMATCH currentVersion=13 base=12 service=${svc(1)}\n`));
  bugs.updateBug(ctx.db, ctx.graph, ids[0], { status: 'triaged', assignee: 'asaf' });
  bugs.updateBug(ctx.db, ctx.graph, ids[3], { status: 'in_progress' });
  bugs.updateBug(ctx.db, ctx.graph, ids[3], { status: 'fixed', fixedInVersion: '0.2.0', resolution: { type: 'code', ref: 'PR #2', note: 'collision-aware labels' } });
  bugs.addComment(ctx.db, ids[1], 'asaf', 'Harvester should treat 409 as "send full manifest". Server side looks correct.');
  return ids.length;
}
