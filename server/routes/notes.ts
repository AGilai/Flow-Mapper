// A flow's Notes over REST (0.34.0): one document per flow, kept as versions. Annotations: any environment takes them (sealed ones too), no draft
// needed; `?draft=<slug>` on a write lets a flow that only exists in an open draft have notes. Anyone writes; a Save names the version it started
// from (`baseVersion`) and a stale one is a 409 STALE_NOTES. See docs/API.md "Notes".

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest } from '../errors.ts';
import * as notes from '../store/notes.ts';
import { headerUser } from '../identity.ts';

const anchorOf = (q: URLSearchParams) => q.get('anchor') ?? (() => { throw badRequest('anchor is required (flow:<service>/<ingress>)'); })();

export function registerNotes(r: Router, ctx: Ctx) {
  r.get('/api/envs/:env/notes/index', (req) => notes.notesIndex(ctx.db, req.params.env));
  r.get('/api/envs/:env/notes/history', (req) => notes.history(ctx.db, req.params.env, anchorOf(req.query), Number(req.query.get('limit')) || undefined));
  r.get('/api/envs/:env/notes', (req) => notes.getNotes(ctx.db, req.params.env, anchorOf(req.query), req.query.get('version') ? Number(req.query.get('version')) : null));
  r.put('/api/envs/:env/notes', async (req) => {
    const b = await req.json();
    return notes.putNotes(ctx.db, ctx.graphOf(req), req.params.env, { anchor: b?.anchor, body: b?.body, baseVersion: b?.baseVersion, author: b?.author, authorId: headerUser(req.headers) });
  });
  r.post('/api/envs/:env/notes/restore', async (req) => {
    const b = await req.json();
    return notes.restoreNotes(ctx.db, ctx.graphOf(req), req.params.env, { anchor: b?.anchor, version: b?.version, baseVersion: b?.baseVersion, author: b?.author, authorId: headerUser(req.headers) });
  });
}
