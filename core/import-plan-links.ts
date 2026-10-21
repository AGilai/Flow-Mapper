// The parts of an HLD import plan (docs/DESIGN-IMPORT.md §6-7) that are subsystems and links:
//   environment.groups -> `subsystem` upserts for keys the environment lacks
//   links[]            -> abstract links (link:<id>); a flow relation (typed, flow: ends) -> rel:<id> (0.28.2); anything else is skipped with a warning
//   details.alsoIn     -> refused (a component has one subsystem)
// Pure. `rows` are the rows the plan lands on (the draft's overlay with the plan's own ops already laid over them).

import type { DraftOpInput } from './draft-ops.ts';
import { checkLink, LINK_ID } from './abstract-links.ts';
import { parseAnchor } from './anchors.ts';
import { checkRelation, normType, REL_TYPES, relationItem } from './flow-relations.ts';
import type { ItemRow } from './item-rows.ts';
import { SUBSYSTEM_ICONS, SUBSYSTEM_KEY, subsystemRows } from './subsystems.ts';

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const slugName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '');

/** Subsystem upserts for plan groups the environment lacks, appended after its own (display order). A different label for a known key is a warning; the environment's is kept. */
export function planGroups(groups: unknown, rows: ItemRow[]): { ops: DraftOpInput[]; warnings: string[] } {
  const ops: DraftOpInput[] = [], warnings: string[] = [];
  if (!Array.isArray(groups)) return { ops, warnings };
  const have = new Map(subsystemRows(rows).map((r) => [r.key, r.data]));
  let order = have.size;
  for (const g of groups) {
    if (!isObj(g) || typeof g.key !== 'string' || !SUBSYSTEM_KEY.test(g.key) || typeof g.label !== 'string' || !g.label.trim()) { warnings.push(`environment.groups: ${JSON.stringify(g)} needs a key and a label: skipped`); continue; }
    const known = have.get(g.key);
    if (known) { if (known.label !== g.label.trim()) warnings.push(`the plan labels subsystem '${g.key}' '${g.label}', the environment '${known.label}': the environment's is kept`); continue; }
    const icon = (SUBSYSTEM_ICONS as readonly string[]).includes(g.icon) ? g.icon : undefined;
    if (g.icon !== undefined && !icon) warnings.push(`subsystem '${g.key}': icon '${g.icon}' is not one of ${SUBSYSTEM_ICONS.join(', ')}: left out`);
    ops.push({ op: 'upsert', anchor: `grp:${g.key}`, data: { label: g.label.trim().slice(0, 80), ...(icon ? { icon } : {}), order: order++ } });
    have.set(g.key, { label: g.label.trim() });
  }
  return { ops, warnings };
}

export interface PlannedLinks { ops: DraftOpInput[]; warnings: string[]; counts: { abstract: number; flow: number; skipped: number } }

const isFlowEnd = (e: unknown) => (typeof e === 'string' && parseAnchor(e)?.kind === 'flow') || (isObj(e) && typeof e.service === 'string' && typeof e.ingress === 'string');

/** `links` of a plan as ops. A bad link is a warning and is skipped, so a plan with one bad link still imports. */
export function planLinks(links: unknown, rows: ItemRow[]): PlannedLinks {
  const out: PlannedLinks = { ops: [], warnings: [], counts: { abstract: 0, flow: 0, skipped: 0 } };
  if (!Array.isArray(links)) return out;
  const skip = (i: number, why: string) => { out.counts.skipped++; out.warnings.push(`links[${i}]: ${why}: skipped`); };
  links.forEach((l, i) => {
    if (!isObj(l)) return skip(i, 'a link is an object');
    if (l.type !== undefined && (isFlowEnd(l.from) || isFlowEnd(l.to))) {
      const item = relationItem({ ...l, note: l.note ?? l.description } as any);
      if (!item) return skip(i, normType(l.type) ? 'both ends of a flow relation are flows (flow:<component>/<endpoint>)' : `relation type '${l.type}' must be one of ${REL_TYPES.join(', ')}`);
      const issue = checkRelation(item.id, item.data, rows)[0];
      if (issue) return skip(i, issue.message);
      if (!out.ops.some((o) => o.anchor === `rel:${item.id}`)) { out.ops.push({ op: 'upsert', anchor: `rel:${item.id}`, data: item.data }); out.counts.flow++; }
      return;
    }
    if (l.type !== undefined) return skip(i, `has a type ('${l.type}') but its ends are not flows`);
    const base = typeof l.id === 'string' && l.id ? l.id : slugName(String(l.name ?? ''));
    if (!LINK_ID.test(base)) return skip(i, `id '${base}' must be lowercase letters, digits and '-'`);
    const data: Record<string, any> = { name: l.name, from: l.from, to: l.to };
    for (const k of ['mode', 'transport', 'description', 'doc'] as const) if (l[k] !== undefined && l[k] !== null && l[k] !== '') data[k] = l[k];
    const issues = checkLink(base, data, rows);
    if (issues.length) return skip(i, issues[0].message);
    out.ops.push({ op: 'upsert', anchor: `link:${base}`, data });
    out.counts.abstract++;
  });
  return out;
}
