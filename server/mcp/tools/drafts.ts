// Draft tools: design a design environment through drafts (whole-item ops by anchor), then apply. Every tool takes `env`.

import * as drafts from '../../store/drafts.ts';
import { runApply } from '../../store/draft-apply.ts';
import { HttpError } from '../../errors.ts';
import { type Tool, env, obj, envOf } from './common.ts';

const slug = { type: 'string', description: 'Draft slug (from open_draft or list_drafts)' };
const need = (a: any) => { if (!a.draft) throw new HttpError(400, 'BAD_REQUEST', 'draft (the slug) is required'); return a.draft as string; };

export const openDraftTool: Tool = {
  name: 'open_draft',
  description: "Open a draft of a design environment (sealed environments take none): with the slug of an open draft it returns that draft, otherwise it creates one (name required). Edits go into a draft with edit_in_draft; read it with `draft` on any read tool. Writes a draft record only, never the environment.",
  inputSchema: obj({ env, name: { type: 'string' }, slug: { type: 'string', description: 'Existing open draft to reuse, or the slug for a new one' } }),
  run: (c, a) => {
    const e = envOf(a);
    const open = a.slug ? drafts.listDrafts(c.db, e, 'open').find((d) => d.slug === a.slug) : undefined;
    if (open) return open;
    if (!a.name) throw new HttpError(400, 'BAD_REQUEST', a.slug ? `no open draft '${a.slug}': give a name to create it` : 'name is required to create a draft');
    return drafts.createDraft(c.db, e, { name: a.name, slug: a.slug, createdBy: 'assistant' });
  },
};

export const listDraftsTool: Tool = {
  name: 'list_drafts', description: 'Drafts of an environment with their op counts, authors and +added -removed ~changed counts. status: open (default) or all. Read only.',
  inputSchema: obj({ env, status: { enum: ['open', 'all'] } }),
  run: (c, a) => drafts.listDrafts(c.db, envOf(a), a.status === 'all' ? 'all' : 'open'),
};

export const draftChangesTool: Tool = {
  name: 'draft_changes', description: 'What an open draft changes in its environment: counts and one item per added / removed / changed anchor (children of an added component are listed under it, not counted; `stale` = the item changed in the environment since the draft touched it, apply overwrites it). Read only.',
  inputSchema: obj({ env, draft: slug }, ['draft']),
  run: (c, a) => { const d = drafts.getDraft(c.db, envOf(a), need(a)); return drafts.changesFor(c.db, envOf(a), d); },
};

export const editInDraftTool: Tool = {
  name: 'edit_in_draft',
  description: "Append whole-item ops to an open draft: [{op: 'upsert' | 'delete', anchor, service?, data?}] (1..5000, all or nothing). Anchors: svc:<s>, fn:|ing:|egr:|res:|bind:<s>/<id>, ch:<bindKey> (+ service = the owner), dto:<s>/<role>/<status or ->/<ingress>, evt:<type>, schema:<source>/<storeKey>, flow:<s>/<ingress>. upsert needs the whole item as `data` (a svc: header is {kind, team?, groupPath?, ...}; a dto/evt is {content, meta?}; a schema is its content; a flow is {name?, description?, steps?}). The environment is not written until apply_draft. Recorded as an AI edit.",
  inputSchema: obj({ env, draft: slug, ops: { type: 'array', minItems: 1, maxItems: 5000, items: obj({ op: { enum: ['upsert', 'delete'] }, anchor: { type: 'string' }, service: { type: 'string' }, data: {} }, ['op', 'anchor']) }, author: { type: 'string' } }, ['draft', 'ops']),
  run: (c, a) => { const out = drafts.appendOps(c.db, envOf(a), need(a), a.ops, { author: a.author ?? 'assistant', byAi: true }); c.changedDraft(envOf(a), a.draft); return out; },
};

export const applyDraftTool: Tool = {
  name: 'apply_draft',
  description: "Apply an open draft to its design environment in one transaction: one delta per touched service (a full manifest for a new one), DTOs, schemas, flow names, one summary changelog row. Newer edit wins: items that changed in the environment since the draft touched them are overwritten and listed in `replaced`. dryRun: true runs everything and rolls back, returning the results with their contract reports. WRITES the environment.",
  inputSchema: obj({ env, draft: slug, dryRun: { type: 'boolean' } }, ['draft']),
  run: (c, a) => runApply(c, envOf(a), need(a), { by: 'assistant', source: 'mcp', dryRun: !!a.dryRun }),
};

export const discardDraftTool: Tool = {
  name: 'discard_draft', description: 'Close a draft without applying it (its ops stay for the record). The environment is untouched.',
  inputSchema: obj({ env, draft: slug }, ['draft']),
  run: (c, a) => { const out = drafts.discardDraft(c.db, envOf(a), need(a), 'assistant'); c.changedDraft(envOf(a), a.draft); return out; },
};
