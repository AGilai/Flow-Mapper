// Preview backend, the subsystem level: subsystems, the roll-up map, abstract links (with suggestions), the sealed settings and level names,
// computed in the browser with the same core/ modules as the server (core/subsystems, subsystem-rollup, abstract-links, link-suggest).
// Everything is in memory; the design lists of a draft come from its overlay rows. Composed by api-local-design.js.

import { subsystemsOf } from '../core/subsystems.js';
import { collectQuestions } from '../core/open-questions.js';
import { rollUp } from '../core/subsystem-rollup.js';
import { suggestRefinements } from '../core/link-suggest.js';
import { SUBSYSTEM_ICONS, SUBSYSTEM_KEY } from '../core/subsystems.js';
import { aboutProblem } from '../core/markdown-lite.js';
import { relationsOf } from '../core/flow-relations.js';

export function createSubsystems(c) {
  const fail = (message, status = 422, code) => { const e = new Error(message); e.status = status; if (code) e.code = code; throw e; };

  const picked = new WeakMap();
  /** The subsystem and link rows the next reads are about: a design's from its rows (the open draft laid over them), a sealed environment's from its settings. */
  function loaded(env) {
    const meta = c.meta(env) ?? fail(`environment '${env}' not found`, 404, 'NOT_FOUND');
    if (c.isDesign(env)) {
      const rows = c.rowsNow(env);
      if (!picked.has(rows)) picked.set(rows, { subRows: rows.filter((r) => r.list === 'subsystem'), linkRows: rows.filter((r) => r.list === 'link') });
      return picked.get(rows);   // one array pair per rows array, so the roll-up memo keeps hitting
    }
    return c.memoed(`${env}|sub-rows|sealed|${JSON.stringify(meta.groups ?? [])}`, () => ({
      subRows: (meta.groups ?? []).map((g, i) => ({ service: '', list: 'subsystem', key: g.key, data: { label: g.label, ...(g.icon ? { icon: g.icon } : {}), ...(g.about ? { about: g.about } : {}), order: i } })), linkRows: [] }));
  }
  const map = (env) => { const { subRows, linkRows } = loaded(env); return rollUp(c.viewGraph(env), subRows, linkRows); };

  const api = {
    subsystems: async (env) => {
      const { subRows } = loaded(env), g = c.viewGraph(env);
      return { levels: c.meta(env).levels ?? ['Subsystem', 'Component'], subsystems: subsystemsOf(subRows, g.model.services), notSet: g.model.services.filter((s) => !s.groupPath).map((s) => s.name).sort() };
    },
    subsystemMap: async (env) => map(env),
    /** 0.33.0: the list items of every "Open questions" about section of the components and subsystems, as the open draft leaves them. */
    openQuestions: async (env) => { const { subRows } = loaded(env), g = c.viewGraph(env), questions = collectQuestions(subsystemsOf(subRows, g.model.services), g.model.services); return { count: questions.length, questions }; },
    /** Flow relations (0.28.2): a design's, as the open draft leaves them; a sealed environment has none. */
    flowRelations: async (env, q = {}) => (c.isDesign(env) ? relationsOf(c.rowsNow(env), q.service && q.ingress ? { service: q.service, ingress: q.ingress } : null, q.type || null) : []),
    abstractLinks: async (env, subsystem) => map(env).abstract.filter((v) => !subsystem || v.from.subsystem === subsystem || v.to.subsystem === subsystem),
    abstractLink: async (env, id) => {
      const m = map(env), view = m.abstract.find((v) => v.id === id) ?? fail(`abstract link '${id}' in '${env}' not found`, 404, 'NOT_FOUND');
      return { ...view, suggestions: suggestRefinements(view, m, c.viewGraph(env), loaded(env).subRows) };
    },
    /** A sealed environment: label, icon and order, at once. A design goes through a draft (409 USE_DRAFT). */
    putSubsystems: async (env, list) => {
      const meta = c.meta(env) ?? fail(`environment '${env}' not found`, 404, 'NOT_FOUND');
      if (c.isDesign(env)) fail(`environment '${env}' is a design: edit its subsystems through a draft`, 409, 'USE_DRAFT');
      const seen = new Set();
      const clean = (Array.isArray(list) ? list : fail('subsystems must be a list of {key, label, icon?}')).map((g) => {
        if (!g || !SUBSYSTEM_KEY.test(g.key ?? '') || !String(g.label ?? '').trim() || String(g.label).trim().length > 80) fail(`subsystem ${JSON.stringify(g)} needs a key and a label of 1 to 80 characters`);
        if (g.icon && !SUBSYSTEM_ICONS.includes(g.icon)) fail(`icon of '${g.key}' must be one of ${SUBSYSTEM_ICONS.join(', ')}`);
        const badAbout = aboutProblem(g.about); if (badAbout) fail(`about of '${g.key}': ${badAbout}`);
        if (seen.has(g.key)) fail(`subsystem '${g.key}' is listed twice`);
        seen.add(g.key);
        const about = g.about === undefined ? (meta.groups ?? []).find((o) => o.key === g.key)?.about : g.about;   // left out: kept; '' or null: cleared
        return { key: g.key, label: String(g.label).trim(), ...(g.icon ? { icon: g.icon } : {}), ...(typeof about === 'string' && about.trim() ? { about } : {}) };
      });
      meta.groups = clean;
      c.bump(env);
      return { subsystems: clean };
    },
    putLevels: async (env, levels) => {
      const meta = c.meta(env) ?? fail(`environment '${env}' not found`, 404, 'NOT_FOUND');
      if (!Array.isArray(levels) || !levels.length || levels.length > 4 || levels.some((l) => typeof l !== 'string' || !l.trim() || l.trim().length > 40)) fail('levels must be a list of 1 to 4 names of at most 40 characters, outermost first');
      meta.levels = levels.map((l) => l.trim());
      return { levels: meta.levels };
    },
  };
  return { api };
}
