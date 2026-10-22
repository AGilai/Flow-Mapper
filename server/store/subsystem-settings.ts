// Subsystem settings and level names written outside a draft.
//   putSealedSubsystems  a sealed environment: label, icon and order are an annotation, written at once (a design goes through a draft: 409 USE_DRAFT)
//   putLevels            level names, an annotation on every environment
//   putDraftSubsystems   a design: the same list as `subsystem` ops of an open draft

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { conflict, HttpError, invalid, notFound } from '../errors.ts';
import { EditError } from '../../core/edit-kit.ts';
import { settingsOps } from '../../core/edit-subsystems.ts';
import { netOps, overlayRows } from '../../core/draft-ops.ts';
import { SUBSYSTEM_ICONS, SUBSYSTEM_KEY } from '../../core/subsystems.ts';
import { aboutProblem } from '../../core/markdown-lite.ts';
import { cleanOwners } from '../../core/owners.ts';
import { resolveOwners, resolveAbout } from './owners.ts';
import { getEnvRow, type EnvGroup } from './envs.ts';
import { appendOps, getDraft, loadOps } from './drafts.ts';
import { envRowsOf } from './env-rows-cache.ts';

export interface SubsystemInput { key: string; label: string; icon?: string | null; about?: string | null; owners?: unknown }

/** The list as stored: keys unique, labels 1..80 characters, icons from the set. Unknown keys are allowed (they label future groupPaths). */
export function cleanSubsystems(list: unknown, db: DB | null = null): EnvGroup[] {
  if (!Array.isArray(list)) throw invalid('subsystems must be a list of {key, label, icon?} in display order');
  const seen = new Set<string>();
  return list.map((g: any) => {
    if (!g || typeof g.key !== 'string' || !SUBSYSTEM_KEY.test(g.key)) throw invalid(`subsystem ${JSON.stringify(g)} needs a key (lowercase letters, digits and '-')`);
    if (typeof g.label !== 'string' || !g.label.trim() || g.label.trim().length > 80) throw invalid(`label of '${g.key}' must be 1 to 80 characters`);
    if (g.icon !== undefined && g.icon !== null && !(SUBSYSTEM_ICONS as readonly string[]).includes(g.icon)) throw invalid(`icon of '${g.key}' must be one of ${SUBSYSTEM_ICONS.join(', ')}`);
    const bad = aboutProblem(g.about); if (bad) throw invalid(`about of '${g.key}': ${bad}`);
    if (seen.has(g.key)) throw invalid(`subsystem '${g.key}' is listed twice`);
    seen.add(g.key);
    // about: left out (undefined) means "keep what is there"; '' (or null) clears it; so an empty one is returned as '' here
    const owners = g.owners === undefined ? undefined : db ? resolveOwners(db, g.owners, `owners of '${g.key}'`) : (cleanOwners(g.owners) ?? []);   // owners (0.33.0): names and external ids become user ids; left out keeps, [] clears
    return { key: g.key, label: g.label.trim(), ...(g.icon ? { icon: g.icon } : {}), ...(g.about === undefined ? {} : { about: typeof g.about === 'string' && g.about.trim() ? (db ? resolveAbout(db, g.about) : g.about) : '' }), ...(owners === undefined ? {} : { owners }) } as EnvGroup;
  });
}

export function putSealedSubsystems(db: DB, env: string, list: unknown): { subsystems: EnvGroup[] } {
  const row = getEnvRow(db, env);
  if (!row) throw notFound(`environment '${env}'`);
  if (row.kind === 'design') throw conflict('USE_DRAFT', `environment '${env}' is a design: edit its subsystems through a draft (an edit of kind 'subsystem'), not directly`);
  const old = new Map(((JSON.parse(row.groups) as EnvGroup[]) ?? []).map((g) => [g.key, g]));
  const subsystems = cleanSubsystems(list, db).map(({ about, owners, ...g }) => { const a = about === undefined ? old.get(g.key)?.about : about, o = owners === undefined ? old.get(g.key)?.owners : owners; return { ...g, ...(a ? { about: a } : {}), ...(o?.length ? { owners: o } : {}) }; });   // about left out: kept; '' or null: cleared
  db.prepare('UPDATE envs SET groups = ? WHERE name = ?').run(JSON.stringify(subsystems), env);
  return { subsystems };
}

export function putLevels(db: DB, env: string, levels: unknown): { levels: string[] } {
  if (!getEnvRow(db, env)) throw notFound(`environment '${env}'`);
  if (!Array.isArray(levels) || !levels.length || levels.length > 4 || levels.some((l) => typeof l !== 'string' || !l.trim() || l.trim().length > 40)) throw invalid('levels must be a list of 1 to 4 names of at most 40 characters, outermost first');
  const out = levels.map((l: string) => l.trim());
  db.prepare('UPDATE envs SET levels = ? WHERE name = ?').run(JSON.stringify(out), env);
  return { levels: out };
}

/** A design: the list becomes the `subsystem` ops of an open draft (only what differs; nothing is deleted). */
export function putDraftSubsystems(db: DB, env: string, slug: string, list: unknown, who: { author?: string; byAi?: boolean } = {}) {
  return tx(db, () => {
    const d = getDraft(db, env, slug);
    const clean = cleanSubsystems(list, db);
    try {
      const ops = settingsOps(clean, overlayRows(envRowsOf(db, env), netOps(loadOps(db, d.id))));
      if (!ops.length) throw new EditError('NO_CHANGE', 'this changes no subsystem');
      return { ...appendOps(db, env, slug, ops, who), ops };
    } catch (e) {
      if (e instanceof EditError) throw new HttpError(422, e.code, e.message, e.field ? { field: e.field } : undefined);
      throw e;
    }
  });
}
