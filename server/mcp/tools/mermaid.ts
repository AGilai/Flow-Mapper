// Mermaid tools (0.27.4): a flow as a sequenceDiagram, and a sequenceDiagram imported into a draft of a design.

import { mermaidImport, mermaidPreview } from '../../store/draft-mermaid.ts';
import { flowMermaid } from '../../store/flow-mermaid.ts';
import { HttpError } from '../../errors.ts';
import { type Tool, env, obj, envOf, draftArg } from './common.ts';

export const exportMermaidTool: Tool = {
  name: 'export_mermaid',
  description: "One flow as Mermaid `sequenceDiagram` text (every environment, a sealed one too; a design as an open draft would leave it with `draft`): the full trace from an entry endpoint. Lifelines are components (`participant id as name`, the entry client an `actor`), channels (labelled by their bind key) and data stores; `->>` a sync call with its `-->>` return, `-)` an async publish, `Note over` the step description; http calls read `METHOD /path`. The flow name is `title`, its description a `%% Description:` comment. Returns {text}. Read only.",
  inputSchema: obj({ env, draft: draftArg, service: { type: 'string', description: "The flow's entry service" }, ingress: { type: 'string', description: "The flow's entry endpoint id" } }, ['service', 'ingress']),
  run: (c, a) => ({ text: flowMermaid(c, envOf(a), a.draft || null, a.service, a.ingress) }),
};

export const importMermaidTool: Tool = {
  name: 'import_mermaid',
  description: "Import a Mermaid `sequenceDiagram` into an open draft of a design environment (sealed ones refuse: 409 ENV_SEALED). Each participant is matched to a component (exact name or `as` label, normalized case / separators / -svc suffix, a close spelling, or a name only the source environment has); a participant with no match is created as a new component. With dryRun true nothing is written and the result is the proposal: `participants` (the table: match, how it matched, candidates, the `choice` taken), `matches` (choices, to correct and send back), `creates`, `imports`, `counts` {components, endpoints, calls, notes, reused}, `edits` (the DesignEdits that would be made), `warnings` [{line?, text}]. `matches` maps participant id to a component name, {create: true, name?}, {fromSource: true} (copy that component from the source environment, one level) or {client: true} (an actor that is the flow's entry client, not a component). `METHOD /path` messages become http endpoints, other messages undecided endpoints with the label as the operation; notes and `Operation: text` labels become step notes. Importing the same text again adds nothing. Without dryRun it appends the ops as one batch and returns {batch, flow: {service, ingress}, counts, from, to}; undo with DELETE /api/envs/:env/drafts/:slug/mermaid/:batch. Nothing is written to the environment until apply_draft. Recorded as an AI edit.",
  inputSchema: obj({ env, draft: { type: 'string', description: 'Open draft slug' }, text: { type: 'string', description: 'The Mermaid text' }, matches: { type: 'object', description: 'Participant id -> component name | {create: true, name?} | {fromSource: true} | {client: true}' }, groupPath: { type: 'string', description: 'Subsystem for the components that are created or copied' }, dryRun: { type: 'boolean', description: 'Return the proposal and write nothing' } }, ['draft', 'text']),
  run: (c, a) => {
    if (!a.draft) throw new HttpError(400, 'BAD_REQUEST', 'draft (the slug) is required');
    const i = { text: a.text, matches: a.matches, groupPath: a.groupPath };
    if (a.dryRun === true) return mermaidPreview(c, envOf(a), a.draft, i);
    const out = mermaidImport(c, envOf(a), a.draft, i, { author: 'assistant', byAi: true });
    c.changedDraft(envOf(a), a.draft);
    return out;
  },
};
