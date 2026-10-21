// Preview backend, what goes into a draft besides raw ops: one-level import from another environment, edit forms, the call read, flow names.
// The same core/ modules as the server (core/import-level, core/design-edit, core/call-view); everything happens in memory.

import { importSet, ImportError } from '../core/import-level.js';
import { importOps, previewOf } from '../core/import-preview.js';
import { pickInfraOwner } from '../core/infra-owner.js';
import { designEditOps, editWarnings, EditError } from '../core/design-edit.js';
import { callView } from '../core/call-view.js';

const STATUS = { NO_ITEM: 404, BAD_ANCHOR: 400, NOTHING_TO_IMPORT: 409, NO_GROUP: 422 };

export function createEdits(c) {
  const fail = (message, status, code) => { const e = new Error(message); e.status = status; if (code) e.code = code; throw e; };

  function plan(env, slug, i) {
    if (!c.isDesign(env)) fail(`environment '${env}' is sealed: it has no drafts`);
    const d = c.find(env, slug), source = i?.source, srcRows = c.data.rows?.[source];
    if (!srcRows) fail(`source environment '${source}' not found`, 404);
    if (source === env) fail(`source must be another environment than '${env}' (the one being designed)`, 400);
    const here = c.overlay(env, d);
    try {
      const set = importSet({
        source, anchor: i.anchor, srcRows, srcGraph: c.baseGraph(source),
        srcVersions: new Map(srcRows.filter((r) => r.list === 'header').map((r) => [r.service, Number(r.data?.version) || 0])),
        here, groups: (c.meta(env).groups ?? []).map((g) => g.key), groupPath: i.groupPath, infraOwner: pickInfraOwner(here, srcRows, source),
      });
      return { d, set, preview: previewOf(set, i.anchor, source) };
    } catch (e) {
      if (e instanceof ImportError) fail(e.message, STATUS[e.code], e.code);
      throw e;
    }
  }

  const api = {
    importPreview: async (env, slug, i) => plan(env, slug, i).preview,
    importIntoDraft: async (env, slug, i, author = 'anonymous') => {
      const { d, set, preview } = plan(env, slug, i), { ops, origins } = importOps(set);
      return { ...c.append(env, d, ops, author, origins), preview };
    },
    designEdit: async (env, slug, edit, author = 'anonymous') => {
      const d = c.find(env, slug);
      try {
        const ops = designEditOps(edit, c.overlay(env, d));
        if (!ops.length) throw new EditError('NO_CHANGE', 'this edit changes nothing');
        return { ...c.append(env, d, ops, author), ops, warnings: editWarnings(edit) };
      } catch (e) {
        if (e instanceof EditError) { const x = new Error(e.message); x.status = 422; x.code = e.code; x.details = e.field ? { field: e.field } : undefined; throw x; }
        throw e;
      }
    },
    /** What the call form reads: the steps of an egress and the endpoints it reaches, with `reference` where their behaviour is in another environment. */
    call: async (env, service, egress) => {
      return callView(c.viewGraph(env), c.refsOf(env), service, egress) ?? fail(`egress '${egress}' of '${service}' not found`, 404);
    },
    flowNames: async (env) => {
      const out = [];
      for (const [k, t] of c.texts(env)) if (t.name) { const [service, ...rest] = k.split('/'); out.push({ service, ingress: rest.join('/'), name: t.name, author: null, updatedAt: '' }); }
      return out;
    },
    setFlowName: async (env, { service, ingress, name }) => {
      const g = c.viewGraph(env);
      if (!g.ingress.has(`${service}:${ingress}`)) fail(`'${ingress}' is not an endpoint of '${service}' in environment '${env}'`, 422, 'NO_INGRESS');
      const n = String(name ?? '').trim();
      if (n.length > 200) fail('name is at most 200 characters', 422);
      (c.names[env] ??= {})[`${service}/${ingress}`] = n;
      return { service, ingress, name: n || null };
    },
  };
  return { api };
}
