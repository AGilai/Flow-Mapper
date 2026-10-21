// Flow names for agents: read the names of an environment's flows, set one (directly, or in a draft of a design).

import { editDraft } from '../../store/draft-edit.ts';
import { listFlowNames, putFlowName } from '../../store/flow-names.ts';
import { type Tool, env, obj, envOf, draftArg } from './common.ts';

export const getFlowNamesTool: Tool = {
  name: 'get_flow_names',
  description: "The names of the flows of an environment ({service, ingress, name, author, updatedAt}); the same names list_entry_points and trace_flow carry. draft: a name the open draft sets wins. Read only.",
  inputSchema: obj({ env, draft: draftArg }),
  run: (c, a) => listFlowNames(c.db, envOf(a), a.draft || null),
};

export const setFlowNameTool: Tool = {
  name: 'set_flow_name',
  description: "Name a flow (an entry point: service + ingress); name '' removes it. Without draft the name is written at once, in any environment (an annotation like set_description). With draft (an open draft of a design) the name becomes a flow op of that draft and is applied with it (recorded as an AI edit).",
  inputSchema: obj({ env, service: { type: 'string' }, ingress: { type: 'string', description: 'Ingress id of the flow entry' }, name: { type: 'string', description: 'At most 200 characters' }, draft: draftArg }, ['service', 'ingress', 'name']),
  run: (c, a) => {
    const e = envOf(a);
    if (a.draft) { const out = editDraft(c.db, e, a.draft, { kind: 'flow', service: a.service, ingress: a.ingress, name: a.name }, { author: 'assistant', byAi: true }); c.changedDraft(e, a.draft); return out; }
    return putFlowName(c.db, c.graph(e), e, { service: a.service, ingress: a.ingress, name: a.name, author: 'assistant' });
  },
};
