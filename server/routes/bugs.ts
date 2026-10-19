// Bug API: report, list/prioritize, update/fix, comments, log attachments.

import type { Router } from '../http/router.ts';
import { Reply, created } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest } from '../errors.ts';
import * as bugs from '../store/bugs.ts';

export function registerBugs(r: Router, ctx: Ctx) {
  const { db, appVersion } = ctx;
  const id = (s: string) => { const n = Number(s); if (!Number.isInteger(n) || n < 1) throw badRequest('bad bug id'); return n; };

  r.get('/api/bugs', (req) => {
    const q = req.query;
    return bugs.listBugs(db, {
      status: q.get('status') ?? undefined, priority: q.get('priority') ?? undefined, severity: q.get('severity') ?? undefined,
      service: q.get('service') ?? undefined, version: q.get('version') ?? undefined, q: q.get('q') ?? undefined,
      open: q.get('open') === 'true', limit: Math.min(Number(q.get('limit')) || 200, 1000),
      reporter: q.get('reporter') ?? undefined, updatedSince: q.get('updatedSince') ?? undefined,
    }, appVersion);
  });

  r.get('/api/bugs/stats', () => bugs.bugStats(db));

  r.post('/api/bugs', async (req) => {
    const body = await req.json();
    const bugId = bugs.createBug(db, ctx.graph, body, appVersion);
    return created(bugs.getBug(db, bugId, appVersion));
  });

  r.get('/api/bugs/:id', (req) => bugs.getBug(db, id(req.params.id), appVersion));

  r.patch('/api/bugs/:id', async (req) => {
    bugs.updateBug(db, ctx.graph, id(req.params.id), await req.json());
    return bugs.getBug(db, id(req.params.id), appVersion);
  });

  r.post('/api/bugs/:id/comments', async (req) => {
    const b = await req.json();
    bugs.addComment(db, id(req.params.id), b.author, b.body);
    return created(bugs.getBug(db, id(req.params.id), appVersion));
  });

  // Raw upload: body is the file, ?filename= names it, content-type header describes it.
  r.post('/api/bugs/:id/attachments', async (req) => {
    const filename = req.query.get('filename') ?? '';
    const out = bugs.addAttachment(db, ctx.graph, ctx.dataDir, id(req.params.id), filename,
      String(req.headers['content-type'] ?? 'application/octet-stream'), await req.body());
    return created(out);
  });

  r.get('/api/bugs/:id/attachments/:aid', (req) => {
    const a = bugs.readAttachment(db, ctx.dataDir, id(req.params.id), id(req.params.aid));
    const text = a.contentType.startsWith('text/') || /\.(log|txt|json|csv)$/i.test(a.filename);
    return new Reply(200, a.body, {
      'content-type': text ? 'text/plain; charset=utf-8' : 'application/octet-stream',
      'content-disposition': `${text ? 'inline' : 'attachment'}; filename="${a.filename.replace(/"/g, '')}"`,
      'x-content-type-options': 'nosniff',
    });
  });
}
