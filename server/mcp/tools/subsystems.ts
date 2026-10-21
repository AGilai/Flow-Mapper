// Subsystem tools (0.28.0): read the subsystem level (subsystems, roll-up map, abstract links, suggestions) and write its settings.
// Links and subsystem rows of a design are written with edit_design (kinds subsystem, abstract-link, refine-link).

import { HttpError } from '../../errors.ts';
import { linksFor, linkViewFor, subsystemMapFor, subsystemsFor } from '../../subsystems-read.ts';
import { replanLinks } from '../../store/draft-plan-links.ts';
import { putDraftSubsystems, putLevels, putSealedSubsystems } from '../../store/subsystem-settings.ts';
import { getEnvRow } from '../../store/envs.ts';
import { type Tool, env, obj, envOf, draftArg } from './common.ts';

const list = { type: 'array', items: obj({ key: { type: 'string' }, label: { type: 'string' }, icon: { type: ['string', 'null'], enum: ['platform', 'agent', 'network', 'cloud', 'shield', 'database', null] } }, ['key', 'label']) };

export const getSubsystemsTool: Tool = {
  name: 'get_subsystems',
  description: "The subsystems of an environment: {levels, subsystems: [{key, label, icon, order, derived, components}], notSet}. A subsystem is the first segment of a component's groupPath; a component belongs to exactly one. `derived`: no settings row, a groupPath names it. draft: read the environment as that open draft would leave it. Read only.",
  inputSchema: obj({ env, draft: draftArg }),
  run: (c, a) => subsystemsFor(c, envOf(a), a.draft || null),
};

export const getSubsystemMapTool: Tool = {
  name: 'get_subsystem_map',
  description: "The environment at subsystem level: boxes (subsystem, its components, internal / out / in / dangling call counts), lines (every call between two subsystems rolled up by transport and mode, with the calls under it, counted once) and the abstract links. A 'Not set' box (key '') appears only when a component without a subsystem takes part in a call. draft: as the open draft would leave it. Read only.",
  inputSchema: obj({ env, draft: draftArg }),
  run: (c, a) => subsystemMapFor(c, envOf(a), a.draft || null),
};

export const listAbstractLinksTool: Tool = {
  name: 'list_abstract_links',
  description: "Abstract links of a design (links drawn at subsystem level, link:<id>): ends, state (abstract, partial, ready, refined, broken), problems, and the calls that refine them. subsystem: only links with an end in that subsystem. Sealed environments have none. Read only.",
  inputSchema: obj({ env, draft: draftArg, subsystem: { type: 'string' } }),
  run: (c, a) => linksFor(c, envOf(a), a.draft || null, a.subsystem || null),
};

export const suggestRefinementsTool: Tool = {
  name: 'suggest_refinements',
  description: "Up to 5 ways to refine one abstract link: these are existing calls between the two ends (pick one with edit_design refine-link `use`, or make a call with refine-link `call`), then components of an open end that make no such call yet (narrow an end with refine-link `from` / `to`). Read only.",
  inputSchema: obj({ env, id: { type: 'string', description: 'Link id' }, draft: draftArg }, ['id']),
  run: (c, a) => linkViewFor(c, envOf(a), a.draft || null, a.id).suggestions,
};

export const applyPlanLinksTool: Tool = {
  name: 'apply_plan_links',
  description: "Re-read the links of a kept import plan into an open draft: the plan's `links` become abstract links (link:<id>). For a draft imported before 0.28 (its links were kept, not applied). from: the draft whose kept plan to read (default: this draft). Items already in the draft are skipped; nothing left is NO_CHANGE. Flow relations are skipped until 0.28.2. Recorded as an AI edit.",
  inputSchema: obj({ env, draft: { type: 'string', description: 'Open draft slug' }, from: { type: 'string', description: 'Draft slug whose kept plan to read' } }, ['draft']),
  run: (c, a) => {
    if (!a.draft) throw new HttpError(400, 'BAD_REQUEST', 'draft (the slug) is required');
    const out = replanLinks(c.db, envOf(a), a.draft, { from: a.from, author: 'assistant', byAi: true });
    c.changedDraft(envOf(a), a.draft);
    return out;
  },
};

export const setSubsystemSettingsTool: Tool = {
  name: 'set_subsystem_settings',
  description: "Set the label, icon (platform, agent, network, cloud, shield, database) and order of subsystems: `subsystems` is the list in display order. A sealed environment takes it at once (an annotation, like set_description). A design needs `draft`: the changes become subsystem ops of that open draft (nothing is deleted; subsystems you leave out stay after the listed ones). Recorded as an AI edit in a draft.",
  inputSchema: obj({ env, subsystems: list, draft: draftArg }, ['subsystems']),
  run: (c, a) => {
    const e = envOf(a);
    if (getEnvRow(c.db, e)?.kind === 'design') {
      if (!a.draft) throw new HttpError(409, 'USE_DRAFT', `environment '${e}' is a design: give draft (an open draft) to change its subsystems`);
      const out = putDraftSubsystems(c.db, e, a.draft, a.subsystems, { author: 'assistant', byAi: true });
      c.changedDraft(e, a.draft);
      return out;
    }
    const out = putSealedSubsystems(c.db, e, a.subsystems);
    c.changed(e);
    return out;
  },
};

export const setLevelsTool: Tool = {
  name: 'set_levels',
  description: "Name the levels of an environment, outermost first (1 to 4 names of at most 40 characters, e.g. ['Subsystem', 'Component']). An annotation, written at once in any environment.",
  inputSchema: obj({ env, levels: { type: 'array', items: { type: 'string' } } }, ['levels']),
  run: (c, a) => { const out = putLevels(c.db, envOf(a), a.levels); c.changed(envOf(a)); return out; },
};
