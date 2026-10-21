// Write tools: manifest ingest (a design is edited through the draft tools: edit_design, import_into_draft, edit_in_draft).

import { HttpError } from '../../errors.ts';
import * as store from '../../store/snapshots.ts';
import { type Tool, obj, draftArg } from './common.ts';
import { draftPrelude } from '../../store/draft-prelude.ts';

export const ingestManifestTool: Tool = {
  name: 'ingest_manifest', description: 'Submit a harvester manifest (kind full or delta) to a sealed environment; a design environment takes only dryRun (edit a design through a draft). See schema/manifest.schema.json. The result has a `contract` report (what the manifest leaves out or cannot link, with a fix per finding). dryRun: true validates and reports without writing.',
  inputSchema: obj({ manifest: { type: 'object' }, manifests: { type: 'array', items: { type: 'object' }, description: 'Several manifests, applied together: all or nothing' }, dryRun: { type: 'boolean' }, draft: { ...draftArg, description: 'With dryRun only: check the manifests against the environment as this open draft would leave it' } }),
  run: (c, a) => {
    if (!a.manifest && !a.manifests) throw new HttpError(400, 'BAD_REQUEST', 'send manifest or manifests');
    if (a.draft && !a.dryRun) throw new HttpError(400, 'BAD_REQUEST', 'draft is for dry runs only (dryRun: true)');
    const ms = a.manifests ?? [a.manifest];
    const rs = store.ingestBatch(c.db, ms, 'mcp', { dryRun: !!a.dryRun, prelude: a.draft ? draftPrelude(c.db, ms, a.draft) : undefined });
    if (!a.dryRun) new Set(rs.map((r) => r.env)).forEach((e) => c.changed(e));
    const out = a.manifests ? { results: rs } : rs[0];
    return a.dryRun ? { dryRun: true, ...out } : out;
  },
};
