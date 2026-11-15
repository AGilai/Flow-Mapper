// The access rules of the REST API, in one place (cognito mode). Called by the auth middleware (gate.ts) after the caller is known, before the route's handler.
//   hidden env or draft -> 404 (never 403); readable but not enough rights -> 403.
//   sealed env: everyone signed in reads and annotates; ingest, DTOs, schemas and Redis keys need a harvester-scope token (403 SEALED).
//   design env: editors write annotations and open / apply drafts; the owner (or an admin) shares, publishes and deletes.

import type { DB } from '../db/connection.ts';
import type { Req } from '../http/router.ts';
import { HttpError, notFound } from '../errors.ts';
import { atLeast, canApplyDraft, canDiscardDraft, canShareDraft, roleOf } from '../../core/env-access.ts';
import { aclOf, draftAclOf, readableEnvs, requireDraftEdit, requireDraftRead, whoOf } from '../access.ts';
import type { Principal } from './context.ts';

const HARVEST = /^(dtos|event-dtos|schemas|resources\/[^/]+\/keys)(\/|$)/;
const forbidden = (msg: string, code = 'FORBIDDEN') => new HttpError(403, code, msg);
const sealedMsg = (env: string) => `'${env}' is a sealed (harvested) environment: writing to it needs a token with the harvester scope (an admin creates one under Tokens)`;

export async function authorize(db: DB, req: Req, p: Principal): Promise<void> {
  const write = req.method !== 'GET' && req.method !== 'HEAD';
  const path = req.path;

  if (path === '/api/ingest') { if (write && p.scope !== 'harvester') throw forbidden('ingest needs a token with the harvester scope (an admin creates one under Tokens)', 'SEALED'); return; }

  if (path.startsWith('/api/bugs/') && req.params.id) {
    const b = db.prepare('SELECT env FROM bugs WHERE id = ?').get(Number(req.params.id)) as { env: string | null } | undefined;
    const ok = readableEnvs(db, p);
    if (b?.env && ok && !ok.has(b.env)) throw notFound(`bug ${req.params.id}`);
    return;
  }
  if (path === '/api/bugs' && req.method === 'POST') {
    const env = (await req.json())?.env, ok = readableEnvs(db, p);
    if (typeof env === 'string' && ok && !ok.has(env)) throw notFound(`environment '${env}'`);
    return;
  }
  if (path.startsWith('/api/users/') && write) {
    const id = req.params.id;
    if (path.endsWith('/merge') && !p.admin) throw forbidden('only an admin can merge users');
    if (req.method === 'PATCH' && !p.admin && id !== p.id) throw forbidden('you can rename only yourself');
    return;
  }

  const env = req.params.env;
  if (!env || !path.startsWith('/api/envs/') || env === 'meta') return;
  const rest = path.split('/').slice(4).join('/');
  const acl = aclOf(db, env);
  if (!acl) { if (write && HARVEST.test(rest) && p.scope !== 'harvester') throw forbidden(sealedMsg(env), 'SEALED'); return; } // unknown env: the handler answers 404 (or an ingest creates it)
  const role = roleOf(acl, whoOf(p));
  if (role === 'none') throw notFound(`environment '${env}'`);
  const draftQ = req.query.get('draft');
  if (!write) { if (draftQ) requireDraftRead(db, env, draftQ, p); if (!rest.startsWith('drafts/')) return; }

  if (rest === 'drafts' || rest.startsWith('drafts/')) {
    const segs = rest.split('/'), slug = segs[1], sub = segs.slice(2).join('/');
    if (!slug) { if (write && !atLeast(role, 'editor')) throw forbidden(`you have read-only access to '${env}': ask the owner for editor rights to open a draft`); return; }
    requireDraftRead(db, env, slug, p);
    const d = draftAclOf(db, env, slug);
    if (!write || !d) return;
    if (req.method === 'PUT' && sub === 'share') { if (!canShareDraft(d, whoOf(p))) throw forbidden('only the author of a draft (or an admin) can share it'); return; }
    if (req.method === 'DELETE' && sub === '') { if (!canDiscardDraft(role, d, whoOf(p))) throw forbidden('only the author of a draft, the owner of the environment or an admin can discard it'); return; }
    if (req.method === 'POST' && sub === 'apply') { if (!canApplyDraft(role, d, whoOf(p))) throw forbidden('applying a draft needs editor rights on the environment and on the draft'); return; }
    requireDraftEdit(db, env, slug, p);
    return;
  }
  if (!write) return;

  if (rest === '' && req.method === 'DELETE') { if (role !== 'owner') throw forbidden(`only the owner of '${env}' (or an admin) can delete it`); return; }
  if (rest === 'access') { if (role !== 'owner') throw forbidden(`only the owner of '${env}' (or an admin) can share it`); return; }
  if (HARVEST.test(rest)) {
    if (acl.kind === 'sealed') { if (p.scope !== 'harvester') throw forbidden(sealedMsg(env), 'SEALED'); return; }
    if (!atLeast(role, 'editor')) throw forbidden(`you have read-only access to '${env}'`);
    return;
  }
  // everything else is an annotation or a design edit: readers annotate a sealed env, a design needs editor rights
  if (acl.kind === 'design' && !atLeast(role, 'editor')) throw forbidden(`you have read-only access to '${env}'${acl.visibility === 'published' ? ' (published): open a draft if you have editor rights' : ''}`);
}
