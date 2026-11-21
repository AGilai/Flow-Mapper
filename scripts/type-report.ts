// Read-only report (0.68.0, frame 34): which components still rely on legacy fields instead of a `type`, per environment.
//   FLOW_DB=/path/flow-mapper.db node --disable-warning=ExperimentalWarning scripts/type-report.ts [--json] [--drafts]
// Lists, from the stored snapshots (and with --drafts, the open drafts' header upserts): a built-in details.icon with no type (the migration or a later ingest adds it),
// a custom SVG / data-URL icon (no longer shown), details.product text that matches no catalogue label (no longer shown), an unknown type value, an icon with no catalogue type
// (aws-ec2, aws-iam), and what each resolves to now. It opens the database read-only: nothing is written, no migration runs.

import { DatabaseSync } from 'node:sqlite';
import { config } from '../server/config.ts';
import { findings } from '../core/type-report.ts';

const args = process.argv.slice(2), json = args.includes('--json'), drafts = args.includes('--drafts');
const db = new DatabaseSync(config.dbPath, { readOnly: true });
const parse = (s: unknown): any => { try { return JSON.parse(String(s)); } catch { return null; } };

interface Row { env: string; where: string; service: string; reason: string; value: string; resolves: string; source: string }
const rows: Row[] = [];
for (const r of db.prepare('SELECT env, service, kind, meta FROM snapshots ORDER BY env, service').all() as any[]) {
  const header = { kind: r.kind, ...parse(r.meta) };
  for (const f of findings(header)) rows.push({ env: r.env, where: 'snapshot', service: r.service, reason: f.reason, value: f.value, resolves: f.resolves, source: f.resolvedSource });
}
if (drafts) {
  // the last upsert per (draft, service) of an open draft's header
  const q = `SELECT d.env, d.slug, o.service, o.data FROM draft_ops o JOIN drafts d ON d.id = o.draft_id
    WHERE d.status = 'open' AND o.list = 'header' AND o.op = 'upsert' AND o.seq = (SELECT MAX(seq) FROM draft_ops x WHERE x.draft_id = o.draft_id AND x.anchor = o.anchor) ORDER BY d.env, d.slug, o.service`;
  for (const r of db.prepare(q).all() as any[]) for (const f of findings(parse(r.data) ?? {})) rows.push({ env: r.env, where: `draft ${r.slug}`, service: r.service, reason: f.reason, value: f.value, resolves: f.resolves, source: f.resolvedSource });
}
const total = (db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as any).n;
db.close();

if (json) { console.log(JSON.stringify({ components: total, findings: rows }, null, 2)); process.exit(0); }
const HELP: Record<string, string> = {
  'builtin-icon': 'built-in details.icon, no type yet (read as the type; migration 021 / the next ingest adds it)',
  'icon-no-type': 'built-in icon with no catalogue type (aws-ec2, aws-iam): reads as the kind or service',
  'custom-icon': 'custom SVG / data-URL icon: no longer shown, pick a type',
  'product-text': 'details.product text that matches no catalogue label: no longer shown',
  'unknown-type': 'type value outside the catalogue: stored, reads as service',
};
console.log(`Type report for ${config.dbPath}: ${total} components, ${rows.length} findings${drafts ? ' (with open drafts)' : ''}`);
for (const env of [...new Set(rows.map((r) => r.env))]) {
  console.log(`\n== ${env}`);
  for (const reason of Object.keys(HELP)) {
    const list = rows.filter((r) => r.env === env && r.reason === reason);
    if (!list.length) continue;
    console.log(`  ${reason}: ${HELP[reason]} (${list.length})`);
    for (const r of list) console.log(`    ${r.service}${r.where === 'snapshot' ? '' : ` [${r.where}]`}  ${JSON.stringify(r.value)}  -> ${r.resolves} (${r.source})`);
  }
}
if (!rows.length) console.log('Every component has a known type or nothing legacy.');
