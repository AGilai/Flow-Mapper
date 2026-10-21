// Import tools: bring one level of another environment into a draft of a design.

import { importIntoDraft, importPreview } from '../../store/draft-import.ts';
import { HttpError } from '../../errors.ts';
import { type Tool, env, obj, envOf } from './common.ts';

const props = {
  env, draft: { type: 'string', description: 'Open draft slug of the design environment' },
  source: { type: 'string', description: 'Environment to import from (prod, or another design)' },
  anchor: { type: 'string', description: "ing:<service>/<id> (an endpoint with its behaviour: handler, the functions it calls inside its component, the calls and stores they use, DTOs, schemas, the queues and bindings of its async calls) or svc:<service> (the component's endpoints, calls, stores, DTOs, as references: no functions)" },
  groupPath: { type: 'string', description: "Subsystem for a component that is not in the design yet (default: the source's, if the design has it)" },
};
const need = (a: any) => { if (!a.draft) throw new HttpError(400, 'BAD_REQUEST', 'draft (the slug) is required'); return a.draft as string; };
const ONE_LEVEL = "One level, never recursive: what the imported behaviour calls in other components stays a reference and is listed under `references` with its own anchor to import next. Items already in the design are kept as they are (`alreadyHere`). Imported items carry the source's current revision as their baseline, so they get no New mark; editing them later marks them Changed.";

export const importPreviewTool: Tool = {
  name: 'import_preview',
  description: `What importing an endpoint or component from another environment into a draft would bring: counts, the items with why each comes along, what is already in the design, what stays a reference, warnings. ${ONE_LEVEL} Read only.`,
  inputSchema: obj(props, ['draft', 'source', 'anchor']),
  run: (c, a) => importPreview(c, envOf(a), need(a), { source: a.source, anchor: a.anchor, groupPath: a.groupPath }),
};

export const importIntoDraftTool: Tool = {
  name: 'import_into_draft',
  description: `Import an endpoint (ing:) or component (svc:) from another environment into an open draft of a design (get the preview first with import_preview). ${ONE_LEVEL} Nothing is written to the environment until apply_draft. Errors: NO_ITEM, BAD_ANCHOR, NOTHING_TO_IMPORT, NO_GROUP. Recorded as an AI edit.`,
  inputSchema: obj(props, ['draft', 'source', 'anchor']),
  run: (c, a) => {
    const out = importIntoDraft(c, envOf(a), need(a), { source: a.source, anchor: a.anchor, groupPath: a.groupPath }, { author: 'assistant', byAi: true });
    c.changedDraft(envOf(a), a.draft);
    return out;
  },
};
