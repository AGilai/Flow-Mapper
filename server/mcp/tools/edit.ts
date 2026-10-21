// Edit tools: the edit forms of the UI as one tool (a DesignEdit becomes whole-item ops of a draft), and the call read the call form uses.

import { callView } from '../../../core/call-view.ts';
import { HttpError } from '../../errors.ts';
import { refsFor } from '../../refs.ts';
import { editDraft } from '../../store/draft-edit.ts';
import { type Tool, env, obj, envOf, draftArg } from './common.ts';

const UNION = `{kind:'component', name, serviceKind: service|gateway|lambda|infra|client-app, groupPath?, team?, description?} (name: lowercase letters, digits, '-') | {kind:'endpoint', service, id?, transport, bindKey?, handler?, entryPoint? (true: always an entry point; false: never; null: back to the default rule), events?: [{type, handler?}], description?} (transport 'undecided' fills a tbd: bind key; the handler function is created empty if absent) | {kind:'call', from: {service, fn}, before?: step number to insert before, to: {service, ingress} (existing endpoint) | {endpoint: <the endpoint form>} (new) | {bindKey, transport} (not designed yet), edit?: {egress, seq} (replace this call), mode?, operation?, condition?, event?} (an arrow that traces: an egress plus a step) | {kind:'delete-call', service, fn, seq} | {kind:'flow', service, ingress, name?, description?, entryPoint? (true | false | null), order?: {fn, seqs: every step number once, in the new order}} | {kind:'dto', service, ingress, role: request|response, status?, content} | {kind:'event-dto', type, content} | {kind:'delete', anchor: svc:|ing:|dto:|evt:}`;

export const editDesignTool: Tool = {
  name: 'edit_design',
  description: `Edit a design through one form-shaped edit instead of raw ops (use edit_in_draft for those): ${UNION}. The edit becomes whole-item upserts / deletes of the open draft, validated all or nothing (errors: BAD_NAME, BAD_KIND, NO_GROUP, NO_SERVICE, NO_TARGET, NO_ITEM, NO_STEP, BAD_ORDER, BAD_ANCHOR, INVALID). Returns {from, to, counts, ops, warnings}. The environment is not written until apply_draft. Recorded as an AI edit.`,
  inputSchema: obj({ env, draft: { type: 'string', description: 'Open draft slug' }, edit: { type: 'object', description: 'A DesignEdit (see the description)' }, author: { type: 'string' } }, ['draft', 'edit']),
  run: (c, a) => {
    if (!a.draft) throw new HttpError(400, 'BAD_REQUEST', 'draft (the slug) is required');
    const out = editDraft(c.db, envOf(a), a.draft, a.edit, { author: a.author ?? 'assistant', byAi: true });
    c.changedDraft(envOf(a), a.draft);
    return out;
  },
};

export const getCallTool: Tool = {
  name: 'get_call',
  description: "One call out of a component (an egress): the steps that make it (function, step number, operation) and the endpoints it reaches. In a design environment a target carries `reference` {service, ingress, bindKey, source} when its behaviour lives in another environment: editing the call then changes the call only. Read only.",
  inputSchema: obj({ env, service: { type: 'string' }, egress: { type: 'string', description: 'Egress id' }, draft: draftArg }, ['service', 'egress']),
  run: (c, a) => callView(c.view(envOf(a), a.draft || null).g, refsFor(c, envOf(a), a.draft || null), a.service, a.egress)
    ?? (() => { throw new HttpError(404, 'NOT_FOUND', `egress '${a.egress}' of '${a.service}' not found`); })(),
};
