// Flow relation tool (0.28.2, #50): read the typed links between flows. Writes go through edit_design (kind flow-relation, delete rel:<id>).

import { HttpError } from '../../errors.ts';
import { REL_TYPES } from '../../../core/flow-relations.ts';
import { relationsFor } from '../../relations-read.ts';
import { type Tool, env, obj, envOf, draftArg } from './common.ts';

export const listFlowRelationsTool: Tool = {
  name: 'list_flow_relations',
  description: "Typed relations between two entry-point flows of a design environment (rel:<id>): contradicts, variant-of, supersedes, same-topic, with an optional note. Each row: {id, type, from, to, note?, other, direction ('out' = the flow named is `from`), phrase ('supersedes', 'is superseded by', 'is a variant of', 'has a variant', 'contradicts', 'same topic as')}. service + ingress: the relations of that flow (both ends); none: every relation of the environment. type filters. draft: as that open draft would leave them. A sealed environment has none. Write them with edit_design {kind: 'flow-relation', from: {service, ingress}, to: {service, ingress}, type, note?} (change one with `id`) and {kind: 'delete', anchor: 'rel:<id>'}; plan links[] with typed flow ends become relations too.",
  inputSchema: obj({ env, draft: draftArg, service: { type: 'string' }, ingress: { type: 'string' }, type: { type: 'string', enum: [...REL_TYPES] } }),
  run: (c, a) => {
    if (!!a.service !== !!a.ingress) throw new HttpError(422, 'INVALID', 'give service and ingress together (one flow), or neither');
    return relationsFor(c, envOf(a), a.draft || null, { service: a.service, ingress: a.ingress, type: a.type });
  },
};
