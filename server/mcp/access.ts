// Access checks of the MCP tools (cognito mode): every tool acts as the token's user with the REST rules (server/auth/rules.ts).
// Hidden env, draft or bug -> not found; read-only or sealed without the harvester scope -> FORBIDDEN / 403 SEALED. Auth off: nothing is checked.

import type { Ctx } from '../context.ts';
import { HttpError, notFound } from '../errors.ts';
import { atLeast, canApplyDraft, canDiscardDraft, canEditDraft, canReadDraft } from '../../core/env-access.ts';
import { aclOf, draftAclOf, isOff, readableEnvs, requireDryRunReadable, requireRole, roleFor, whoOf } from '../access.ts';
import { currentWho } from '../auth/context.ts';
import type { Tool } from './tools/common.ts';

const HARVEST = new Set(['ingest_manifest', 'load_dtos', 'load_schemas']);
/** Annotations: a reader may on a sealed env; a design needs editor rights (or, with `draft`, the right to edit that draft). */
const ANNOTATE = new Set(['set_description', 'set_flow_name', 'add_comment', 'resolve_comment', 'set_notes', 'add_action_item', 'update_action_item', 'set_env_color', 'set_subsystem_settings', 'set_levels']);
const DRAFT_WRITE = new Set(['edit_in_draft', 'apply_import_plan', 'import_into_draft', 'edit_design', 'import_mermaid', 'apply_plan_links']);
const forbidden = (m: string, code = 'FORBIDDEN') => new HttpError(403, code, m);

export function checkTool(ctx: Ctx, tool: Tool, a: any) {
  const p = currentWho();
  if (isOff(p)) return;
  const db = ctx.db, who = whoOf(p!), name = tool.name;
  if (!p!.id) throw new HttpError(401, 'UNAUTHENTICATED', 'sign in required');
  if (name === 'ingest_manifest') { // the envs are named inside the manifests; a dry run writes nothing
    if (!a?.dryRun && p!.scope !== 'harvester') throw forbidden('ingest needs a token with the harvester scope (an admin creates one under Tokens)', 'SEALED');
    if (a?.dryRun) requireDryRunReadable(db, Array.isArray(a.manifests) ? a.manifests : [a.manifest], typeof a.draft === 'string' ? a.draft : null, p);
    return;
  }
  const hasEnv = !!(tool.inputSchema as any).properties?.env;
  const ok = readableEnvs(db, p);

  if ((name === 'get_bug' || name === 'update_bug') && a?.id != null) {
    const b = db.prepare('SELECT env FROM bugs WHERE id = ?').get(Number(a.id)) as { env: string | null } | undefined;
    if (b?.env && ok && !ok.has(b.env)) throw notFound(`bug ${a.id}`);
  }
  if (name === 'report_bug' && typeof a?.env === 'string' && ok && !ok.has(a.env)) throw notFound(`environment '${a.env}'`);
  if (name === 'create_env') { if (typeof a?.source === 'string' && a.source) requireRole(db, a.source, 'viewer', p); return; }
  if (!hasEnv) return;

  const env = typeof a?.env === 'string' && a.env ? a.env : 'default', draft = typeof a?.draft === 'string' && a.draft ? a.draft : null;
  const acl = aclOf(db, env);
  if (!acl) { if (HARVEST.has(name) && p!.scope !== 'harvester') throw forbidden(`ingest needs a token with the harvester scope (an admin creates one under Tokens)`, 'SEALED'); return; }
  const role = roleFor(db, env, p);
  if (role === 'none') throw notFound(`environment '${env}'`);
  const d = draft ? draftAclOf(db, env, draft) : null;
  if (draft && d && !canReadDraft(role, d, who)) throw notFound(`draft '${draft}' in environment '${env}'`);

  if (HARVEST.has(name) && !a?.dryRun) {
    if (acl.kind === 'sealed') { if (p!.scope !== 'harvester') throw forbidden(`'${env}' is a sealed (harvested) environment: writing to it needs a token with the harvester scope`, 'SEALED'); return; }
    if (!atLeast(role, 'editor')) throw forbidden(`you have read-only access to '${env}'`);
    return;
  }
  if (name === 'open_draft' && !atLeast(role, 'editor')) throw forbidden(`you have read-only access to '${env}': ask the owner for editor rights to open a draft`);
  if (name === 'apply_draft' && d && !canApplyDraft(role, d, who)) throw forbidden('applying a draft needs editor rights on the environment and on the draft');
  if (name === 'discard_draft' && d && !canDiscardDraft(role, d, who)) throw forbidden('only the author of a draft, the owner of the environment or an admin can discard it');
  if (DRAFT_WRITE.has(name) || (ANNOTATE.has(name) && draft)) {
    if (d ? !canEditDraft(role, d, who) : !atLeast(role, 'editor')) throw forbidden(`you cannot change this draft (it is private to its author, or you only have read access to '${env}')`);
  } else if (ANNOTATE.has(name) && acl.kind === 'design' && !atLeast(role, 'editor')) throw forbidden(`you have read-only access to '${env}'`);
}
