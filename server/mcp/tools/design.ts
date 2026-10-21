// Design tools: marks (what is new / changed / removed in a design) and the import of an HLD plan into a draft.

import { marksFor, againstOf } from '../../marks.ts';
import { parseAnchor } from '../../../core/anchors.ts';
import { ingestPlan } from '../../store/draft-plan.ts';
import { HttpError } from '../../errors.ts';
import { type Tool, env, obj, envOf, draftArg } from './common.ts';

export const getMarksTool: Tool = {
  name: 'get_marks',
  description: "What is new / changed / removed in a design environment, per anchor (svc:<s>, ing:<s>/<id>, egr:..., dto:..., evt:<type>, ...), with a phrase of what changed (`what`, `was`), ghosts of removed items and counts. against: 'baseline' (default: the rows frozen when the design was copied) or 'source' (the source environment as it is now). draft: lay an open draft over the environment first. fields: true adds one anchor per changed DTO / schema field (off by default). prefix keeps anchors that start with it. A sealed environment has no baseline: empty. Read only.",
  inputSchema: obj({ env, against: { enum: ['baseline', 'source'] }, draft: draftArg, prefix: { type: 'string' }, fields: { type: 'boolean' } }),
  run: (c, a) => {
    const m = marksFor(c, envOf(a), { against: againstOf(a.against), draft: a.draft || null });
    const keep = (anchor: string) => (a.fields === true || parseAnchor(anchor)?.field === undefined) && (!a.prefix || anchor.startsWith(a.prefix));
    return { ...m, marks: Object.fromEntries(Object.entries(m.marks).filter(([k]) => keep(k))), ghosts: Object.fromEntries(Object.entries(m.ghosts).filter(([k]) => keep(k))) };
  },
};

export const applyImportPlanTool: Tool = {
  name: 'apply_import_plan',
  description: "Turn an HLD import plan (docs/DESIGN-IMPORT.md, planVersion 1) into ops of an open draft: new components (manifests, inlined), extensions of copied components, flows, DTOs, schemas, subsystems the environment lacks (environment.groups) and abstract links (links, between subsystems / components / endpoints; a bad link is a warning and is skipped; flow relations wait for 0.28.2). A component has ONE subsystem: details.alsoIn or two subsystems for one component are refused (TWO_GROUPS). The plan is checked as a whole (errors say which part: PLAN_VERSION, PLAN_ENV, PLAN_EXISTS, PLAN_NO_SERVICE, TWO_GROUPS or INVALID with paths) and nothing is added if any part is wrong. Questions with blocking: true are reported, not enforced. dryRun: true adds the ops, runs the apply and rolls everything back, returning the contract findings of what the apply would write. Without dryRun it writes the draft only; apply_draft writes the environment. Recorded as an AI edit.",
  inputSchema: obj({ env, draft: { type: 'string', description: 'Open draft slug' }, plan: { type: 'object' }, dryRun: { type: 'boolean' } }, ['draft', 'plan']),
  run: (c, a) => {
    if (!a.draft) throw new HttpError(400, 'BAD_REQUEST', 'draft (the slug) is required');
    const out = ingestPlan(c.db, envOf(a), a.draft, a.plan, { author: 'assistant', byAi: true, dryRun: !!a.dryRun });
    if (!a.dryRun) c.changedDraft(envOf(a), a.draft);
    return out;
  },
};
