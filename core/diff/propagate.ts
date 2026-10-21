// Mark propagation. prune: the highest level carries the mark (a new component's endpoints, a new endpoint's DTOs, a new
// field's children carry none). rollUp: a changed child marks its unmarked parent as changed, with a phrase of what.
// counts: per-category totals from the final per-anchor marks (the bar, the inventory filter and the review list agree).

import { parseAnchor, parentOf } from '../anchors.ts';
import { rowId } from '../item-rows.ts';
import type { DiffOpts, EnvMarks, MarkInfo } from './index.ts';
import type { RawMark } from './entities.ts';
import type { Side } from './side.ts';
import { entityPhrases, fieldCounts, joinWhat, type Contrib } from './what.ts';

const ENTITY = new Set(['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings']);

/** The anchors above one anchor, nearest first (a channel's parent is the service that declares it; a DTO's, its endpoint). */
function ancestors(anchor: string, m: RawMark, base: Side, cur: Side): string[] {
  const out: string[] = [];
  for (let a = parentOf(anchor); a; a = parentOf(a)) out.push(a);
  const r = m.row;
  if (r.list === 'channels') for (const o of new Set([cur.ownerOfChannel.get(r.key), base.ownerOfChannel.get(r.key)])) if (o) out.push(`svc:${o}`);
  if (r.list === 'dto' && !parseAnchor(anchor)?.field) out.unshift(`ing:${r.service}/${dtoIngress(r.key)}`);
  return out;
}
const dtoParts = (key: string) => { const rest = key.slice(0, key.lastIndexOf('|')), i = rest.lastIndexOf('|'); return { ingress: rest.slice(0, i), role: rest.slice(i + 1) }; };
const dtoIngress = (key: string) => dtoParts(key).ingress;

export function prune(marks: Map<string, RawMark>, base: Side, cur: Side): { marks: Map<string, RawMark>; dropped: Set<string> } {
  const out = new Map<string, RawMark>(), dropped = new Set<string>();
  for (const [a, m] of marks) {
    const hidden = ancestors(a, m, base, cur).some((p) => { const pm = marks.get(p); return pm && (pm.mark === 'new' || pm.mark === 'removed'); });
    if (hidden) dropped.add(a); else out.set(a, m);
  }
  return { marks: out, dropped };
}

/** The final marks: pruned raw marks plus changed parents. */
export function rollUp(marks: Map<string, RawMark>, base: Side, cur: Side, opts: DiffOpts): Map<string, MarkInfo> {
  const svc = new Map<string, { ent: Contrib[]; msgs: string[] }>(), ing = new Map<string, string[]>();
  const into = (service: string) => { const k = `svc:${service}`; if (!svc.has(k)) svc.set(k, { ent: [], msgs: [] }); return svc.get(k)!; };
  for (const m of marks.values()) {
    if (m.isField) continue;
    const { service, list, key } = m.row;
    const owner = list === 'channels' ? (cur.ownerOfChannel.get(key) ?? base.ownerOfChannel.get(key)) : service;
    if (ENTITY.has(list) && owner) into(owner).ent.push({ list, mark: m.mark, callee: list === 'egress' && m.mark === 'new' ? opts.calleeOf?.(service, key) : undefined });
    else if (list === 'dto') {
      const { ingress, role } = dtoParts(key), counts = m.fields ? fieldCounts(m.fields) : '';
      const ingKey = `ing:${service}/${ingress}`;
      ing.set(ingKey, [...(ing.get(ingKey) ?? []), counts ? `message ${role}: ${counts}` : entityPhrases([{ list, mark: m.mark }])[0]]);
      if (counts) into(service).msgs.push(`message ${role} of ${ingress}: ${counts}`); else into(service).ent.push({ list, mark: m.mark });
    } else if (list === 'event_dto' || list === 'schema') {
      const users = list === 'event_dto' ? [...(cur.producers.get(key) ?? []), ...(base.producers.get(key) ?? [])]
        : [...(cur.storeUsers.get(key.slice(0, key.lastIndexOf('|'))) ?? []), ...(base.storeUsers.get(key.slice(0, key.lastIndexOf('|'))) ?? [])];
      const name = list === 'event_dto' ? `message ${key}` : `collection ${key.slice(0, key.lastIndexOf('|')).split('/').pop()!.split(':').pop()}`;
      for (const u of new Set(users)) { if (m.fields) into(u).msgs.push(`${name}: ${fieldCounts(m.fields)}`); else into(u).ent.push({ list, mark: m.mark }); }
    }
  }
  const out = new Map<string, MarkInfo>();
  for (const [a, { row: _r, fields: _f, isField: _i, ...info }] of marks) out.set(a, info);
  for (const [a, { ent, msgs }] of svc) {
    const s = a.slice(4), have = out.get(a);
    if (have && have.mark !== 'changed') continue;
    if (!have && !cur.services.has(s)) continue;
    const what = joinWhat([...(have?.what ? [have.what] : []), ...entityPhrases(ent), ...msgs]);
    out.set(a, { mark: 'changed', ...(what ? { what } : {}) });
  }
  for (const [a, phrases] of ing) {
    const have = out.get(a), r = a.slice(4);
    if (have || !cur.rows.has(rowId({ service: r.slice(0, r.indexOf('/')), list: 'ingress', key: r.slice(r.indexOf('/') + 1) }))) continue;
    out.set(a, { mark: 'changed', what: joinWhat(phrases) });
  }
  return out;
}

const CATEGORY: Record<string, keyof EnvMarks['counts']> = { svc: 'components', ing: 'endpoints', egr: 'calls', ch: 'channels', dto: 'messages', evt: 'messages', grp: 'subsystems', link: 'links', rel: 'relations' };

export function counts(marks: Map<string, MarkInfo>, cur: Side): EnvMarks['counts'] {
  const c = Object.fromEntries((['components', 'endpoints', 'calls', 'channels', 'messages', 'fields', 'subsystems', 'links', 'relations'] as const).map((k) => [k, { new: 0, changed: 0, removed: 0 }])) as EnvMarks['counts'];
  for (const [a, m] of marks) { const p = parseAnchor(a); const cat = p?.field !== undefined ? 'fields' : CATEGORY[p?.kind ?? '']; if (cat) c[cat][m.mark]++; }
  const total = (...lists: string[]) => [...cur.rows.values()].filter((r) => lists.includes(r.list)).length;
  const totals = { components: cur.services.size, endpoints: total('ingress'), calls: total('egress'), channels: total('channels'), messages: total('dto', 'event_dto') };
  for (const [k, n] of Object.entries(totals)) c[k as keyof typeof totals].unchanged = Math.max(0, n - c[k as keyof typeof totals].new - c[k as keyof typeof totals].changed);
  return c;
}
