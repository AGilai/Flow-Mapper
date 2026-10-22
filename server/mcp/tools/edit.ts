// Edit tools: the edit forms of the UI as one tool (a DesignEdit becomes whole-item ops of a draft), and the call read the call form uses.

import { callView } from '../../../core/call-view.ts';
import { HttpError } from '../../errors.ts';
import { refsFor } from '../../refs.ts';
import { editDraft } from '../../store/draft-edit.ts';
import { type Tool, env, obj, envOf, draftArg } from './common.ts';

const UNION = `{kind:'component', name, serviceKind: service|gateway|lambda|infra|client-app, groupPath?, team?, description?, about? (Markdown-lite, at most 20000 characters; '' clears), owners (a list of people: user ids, names, or {name?, externalSource, externalId} objects, matched to users and stored as user ids; [] clears), links?, runtime?: k8s-pod|k8s-deployment|k8s-daemonset|k8s-operator|k8s-job|null} (name: lowercase letters, digits, '-') | {kind:'endpoint', service, id?, transport, bindKey?, handler?, entryPoint? (true: always an entry point; false: never; null: back to the default rule), events?: [{type, handler?}], description?, links?} (transport 'undecided' fills a tbd: bind key; the handler function is created empty if absent) | {kind:'function', service, id, links?} (links of an existing function) | {kind:'call', from: {service, fn}, before?: step number to insert before, to: {service, ingress} (existing endpoint) | {endpoint: <the endpoint form>} (new) | {bindKey, transport} (not designed yet), edit?: {egress, seq} (replace this call), mode?, operation?, condition?, event?, note? (the step's own text), mark? ('new' | 'changed' | null: the step's own mark, drawn as a band on its arrow; null clears), groups? ([{id, kind?: alt|opt|loop|par|critical|break, condition?}], the frames the step sits in, outermost first; null clears), real? (details.real: the bind key it really calls), returns? ({label (1 to 80 characters), detail? (up to 500)}: what the call returns, the label of its dashed return arrow and a detail for the step panel; null clears)} (an arrow that traces: an egress plus a step) | {kind:'leaf', from: {service, fn}, operation?, note?, over?: [component names the note spans], mark?, groups?, before?} (a step with no target: a note over components, or an internal step) | {kind:'delete-call', service, fn, seq} | {kind:'flow', service, ingress, name?, description?, links?, entryPoint? (true | false | null), order?: {fn, seqs: every step number once, in the new order}} | {kind:'dto', service, ingress, role: request|response, status?, content} | {kind:'event-dto', type, content} | {kind:'subsystem', key (lowercase, '-', a path like platform/identity is allowed), label? (required for a new key), icon? (platform|agent|network|cloud|shield|database, null clears), order? (position), about? (Markdown-lite, at most 20000 characters; '' or null clears), owners? (people: user ids, names or {name?, externalSource, externalId}, matched to users; [] clears)} (a subsystem's settings, grp:<key>; the key never changes, the label is the rename) | {kind:'abstract-link', id?, name, from: grp:|svc:|egr:|ing:, to: grp:|svc:|ing:, mode?, transport?, description?} (a link drawn at subsystem level, link:<id>; the id defaults to the slug of the name) | {kind:'refine-link', id, from?, to? (narrow an end to an anchor inside it), use?: {service, egress} (an existing call realises the link), call?: <the call form without kind> (make a new call that realises it)} (use and call are exclusive) | {kind:'flow-relation', from: {service, ingress}, to: {service, ingress}, type: contradicts|variant-of|supersedes|same-topic, note?, id? (the relation being changed)} (a typed link between two entry-point flows; errors BAD_TYPE, NO_FLOW, SAME_FLOW) | {kind:'delete', anchor: svc:|ing:|dto:|evt:|grp:|link:|rel:}. A component edit with a new groupPath MOVES the component to that subsystem (one subsystem each)`;

export const editDesignTool: Tool = {
  name: 'edit_design',
  description: `Edit a design through one form-shaped edit instead of raw ops (use edit_in_draft for those): ${UNION}. The edit becomes whole-item upserts / deletes of the open draft, validated all or nothing (errors: BAD_NAME, BAD_KIND, BAD_KEY, BAD_ICON, NO_GROUP, GROUP_IN_USE, TWO_GROUPS, NO_END, BAD_END, SAME_END, NOT_INSIDE, REFINE_DANGLING, NO_SERVICE, NO_TARGET, NO_ITEM, NO_STEP, BAD_ORDER, BAD_ANCHOR, INVALID). Returns {from, to, counts, ops, warnings}. The environment is not written until apply_draft. Recorded as an AI edit.`,
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
