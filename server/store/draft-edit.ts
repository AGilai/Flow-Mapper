// An edit form as ops (core/design-edit.ts) appended to an open draft: read the draft's rows, build, validate and append in one
// transaction. A builder's EditError becomes a 422 with its code and the form field (details.field).

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { netOps, overlayRows } from '../../core/draft-ops.ts';
import { designEditOps, editWarnings, EditError, type DesignEdit } from '../../core/design-edit.ts';
import { HttpError } from '../errors.ts';
import { guardEnv } from './envs.ts';
import { appendOps, getDraft, loadOps } from './drafts.ts';
import { envItemRows } from './item-rows.ts';
import { resolveOwners, resolveAbout } from './owners.ts';

export function editDraft(db: DB, env: string, slug: string, edit: DesignEdit, who: { author?: string; byAi?: boolean } = {}) {
  return tx(db, () => {
    guardEnv(db, env, 'draft');
    const d = getDraft(db, env, slug);
    if ((edit?.kind === 'component' || edit?.kind === 'subsystem') && edit.owners !== undefined) edit = { ...edit, owners: resolveOwners(db, edit.owners) ?? [] };   // names and external ids -> user ids (0.33.0)
    if ((edit?.kind === 'component' || edit?.kind === 'subsystem') && typeof edit.about === 'string') edit = { ...edit, about: resolveAbout(db, edit.about) };   // @{Name} -> @[id]
    try {
      const ops = designEditOps(edit, overlayRows(envItemRows(db, env), netOps(loadOps(db, d.id))));
      if (!ops.length) throw new EditError('NO_CHANGE', 'this edit changes nothing');
      return { ...appendOps(db, env, slug, ops, who), ops, warnings: editWarnings(edit) };
    } catch (e) {
      if (e instanceof EditError) throw new HttpError(422, e.code, e.message, e.field ? { field: e.field } : undefined);
      throw e;
    }
  });
}
