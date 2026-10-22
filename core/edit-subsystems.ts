// Edit forms of the subsystem level as ops: subsystem settings (grp:), abstract links (link:) and their refinement into a call.
// Pure builders from a DesignEdit and the rows being edited; they throw EditError. REST, MCP and the preview all call them.

import { parseAnchor } from './anchors.ts';
import type { DraftOpInput } from './draft-ops.ts';
import { buildIndex, downstreamIngress } from './graph-index.ts';
import { callOps } from './edit-calls.ts';
import { checkLink, endOf, inside, LINK_ID, worldOfRows, type LinkData } from './abstract-links.ts';
import { EditError, indexRows, unique, type CallEdit, type DesignEdit, type Idx } from './edit-kit.ts';
import { rowsToModel, type ItemRow } from './item-rows.ts';
import { aboutProblem } from './markdown-lite.ts';
import { SUBSYSTEM_ICONS, SUBSYSTEM_KEY, subsystemRows } from './subsystems.ts';

const up = (anchor: string, data: unknown): DraftOpInput => ({ op: 'upsert', anchor, data });
type Sub = Extract<DesignEdit, { kind: 'subsystem' }>;
type Abs = Extract<DesignEdit, { kind: 'abstract-link' }>;
type Refine = Extract<DesignEdit, { kind: 'refine-link' }>;

/** The settings rows in display order, as {key, data}. */
const ordered = (rows: ItemRow[]) => subsystemRows(rows).sort((a, b) => (a.data?.order ?? 0) - (b.data?.order ?? 0) || (a.key < b.key ? -1 : 1)).map((r) => ({ key: r.key, data: { ...r.data } as Record<string, any> }));

/** Upsert the settings of one subsystem; a new key needs a label; `order: n` moves it to position n (only the rows whose position changes are written). */
export function subsystemOps(e: Sub, rows: ItemRow[]): DraftOpInput[] {
  if (typeof e.key !== 'string' || !SUBSYSTEM_KEY.test(e.key)) throw new EditError('BAD_KEY', `subsystem key '${e.key ?? ''}' must be lowercase letters, digits and '-' (a path like platform/identity is allowed)`, 'key');
  if (e.icon !== undefined && e.icon !== null && !(SUBSYSTEM_ICONS as readonly string[]).includes(e.icon)) throw new EditError('BAD_ICON', `icon must be one of ${SUBSYSTEM_ICONS.join(', ')} (or null to clear it)`, 'icon');
  if (e.label !== undefined && (typeof e.label !== 'string' || !e.label.trim() || e.label.trim().length > 80)) throw new EditError('INVALID', 'label must be 1 to 80 characters', 'label');
  if (e.order !== undefined && (!Number.isInteger(e.order) || e.order < 0)) throw new EditError('INVALID', 'order must be a position, 0 or more', 'order');
  { const bad = aboutProblem(e.about); if (bad) throw new EditError('INVALID', bad, 'about'); }
  const list = ordered(rows), at = list.findIndex((s) => s.key === e.key);
  if (at < 0 && !e.label?.trim()) throw new EditError('INVALID', `a new subsystem '${e.key}' needs a label`, 'label');
  const data: Record<string, any> = { ...(at >= 0 ? list[at].data : {}) };
  if (e.label !== undefined) data.label = e.label.trim();
  if (e.icon === null) delete data.icon; else if (e.icon !== undefined) data.icon = e.icon;
  if (e.about === null || e.about === '' || (typeof e.about === 'string' && !e.about.trim())) delete data.about; else if (e.about !== undefined) data.about = e.about;   // '' or null clears
  const next = list.filter((s) => s.key !== e.key);
  next.splice(Math.min(e.order ?? (at >= 0 ? at : next.length), next.length), 0, { key: e.key, data });
  const ops: DraftOpInput[] = [];
  next.forEach((s, i) => {
    const old = list.find((x) => x.key === s.key);
    const d = { ...s.data, order: i };
    if (!old || JSON.stringify(old.data) !== JSON.stringify(d)) ops.push(up(`grp:${s.key}`, d));
  });
  return ops;
}

/** The whole settings list of an environment (display order) as ops: only what differs from the rows. Nothing is deleted. */
export function settingsOps(list: { key: string; label: string; icon?: string | null; about?: string | null }[], rows: ItemRow[]): DraftOpInput[] {
  const cur = new Map(subsystemRows(rows).map((r) => [r.key, r.data]));
  const listed = new Set(list.map((s) => s.key));
  const rest = ordered(rows).filter((s) => !listed.has(s.key));
  const out: DraftOpInput[] = [];
  [...list, ...rest.map((s) => ({ key: s.key, label: s.data.label as string, icon: s.data.icon as string | undefined, about: undefined }))].forEach((s, i) => {
    if (!SUBSYSTEM_KEY.test(s.key)) throw new EditError('BAD_KEY', `subsystem key '${s.key}' is not valid`, 'key');
    if (s.icon && !(SUBSYSTEM_ICONS as readonly string[]).includes(s.icon)) throw new EditError('BAD_ICON', `icon must be one of ${SUBSYSTEM_ICONS.join(', ')}`, 'icon');
    if (typeof s.label !== 'string' || !s.label.trim() || s.label.trim().length > 80) throw new EditError('INVALID', `label of '${s.key}' must be 1 to 80 characters`, 'label');
    const bad = aboutProblem(s.about); if (bad) throw new EditError('INVALID', `about of '${s.key}': ${bad}`, 'about');
    const about = s.about === undefined ? cur.get(s.key)?.about : s.about || undefined;   // left out: kept; '' or null: cleared
    const data = { label: s.label.trim(), ...(s.icon ? { icon: s.icon } : {}), ...(about ? { about } : {}), order: i };
    if (JSON.stringify(cur.get(s.key)) !== JSON.stringify(data)) out.push(up(`grp:${s.key}`, data));
  });
  return out;
}

const slugName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '') || 'link';

function failOn(issues: ReturnType<typeof checkLink>) {
  if (issues.length) throw new EditError(issues[0].code, issues[0].message, issues[0].field);
}

/** Upsert an abstract link. The id defaults to the slug of the name (unique among the links); doc and refinedBy of an existing link are kept. */
export function abstractLinkOps(e: Abs, rows: ItemRow[], x: Idx = indexRows(rows)): DraftOpInput[] {
  if (e.id !== undefined && !LINK_ID.test(e.id)) throw new EditError('BAD_NAME', `link id '${e.id}' must be lowercase letters, digits and '-' (at most 63 characters)`, 'id');
  const id = e.id ?? unique(slugName(String(e.name ?? '')), new Set(rows.filter((r) => r.list === 'link').map((r) => r.key)));
  const old = x.get('', 'link', id)?.data as LinkData | undefined;
  const data: Record<string, any> = { ...(old ?? {}), name: e.name, from: e.from, to: e.to };
  for (const k of ['mode', 'transport', 'description'] as const) {
    const v = e[k];
    if (v === undefined) continue;
    if (v === null || v === '') delete data[k]; else data[k] = v;
  }
  if (e.refinedBy === null) delete data.refinedBy;
  failOn(checkLink(id, data, rows));
  return [up(`link:${id}`, data)];
}

/** Refine a link: narrow an end inside its current one, point it at an existing call (`use`), or make a new call that realises it (`call`). */
export function refineOps(e: Refine, rows: ItemRow[], x: Idx = indexRows(rows)): DraftOpInput[] {
  const old = x.get('', 'link', e.id);
  if (!old) throw new EditError('NO_ITEM', `link '${e.id}' does not exist in this design`, 'id');
  if (e.use && e.call) throw new EditError('INVALID', 'use and call are exclusive: pick an existing call or make a new one', 'use');
  const cur = old.data as LinkData, w = worldOfRows(rows);
  const data: Record<string, any> = { ...cur };
  let pre: DraftOpInput[] = [];
  for (const end of ['from', 'to'] as const) {
    const a = e[end];
    if (a === undefined) continue;
    if (!endOf(cur[end], w).missing && !inside(cur[end], a, w)) throw new EditError('NOT_INSIDE', `${end} '${a}' is not inside '${cur[end]}': a refinement narrows an end, it does not move it`, end);
    data[end] = a;
  }
  const scopeTo = data.to as string, scopeFrom = data.from as string;
  const reach = (service: string, egress: string): { service: string; ingress: string } | undefined => {
    const d = downstreamIngress(buildIndex(rowsToModel('', rows)), { type: 'egress', service, id: egress }).find((q) => inside(scopeTo, `ing:${q.ingress.service}/${q.ingress.id}`, w));
    return d && { service: d.ingress.service, ingress: d.ingress.id };
  };
  if (e.use) {
    const { service, egress } = e.use;
    if (!x.get(service, 'egress', egress)) throw new EditError('NO_ITEM', `call '${egress}' of '${service}' does not exist in this design`, 'use');
    if (!endOf(scopeFrom, w).missing && !inside(scopeFrom, `egr:${service}/${egress}`, w)) throw new EditError('NOT_INSIDE', `call '${egress}' of '${service}' does not start inside '${scopeFrom}'`, 'use');
    const hit = reach(service, egress);
    if (!hit) throw new EditError('NOT_INSIDE', `call '${egress}' of '${service}' does not reach '${scopeTo}'`, 'use');
    Object.assign(data, { from: `egr:${service}/${egress}`, to: `ing:${hit.service}/${hit.ingress}`, refinedBy: [{ service, egress }] });
  } else if (e.call) {
    const call: CallEdit = { kind: 'call', ...e.call } as CallEdit;
    if ('bindKey' in (call.to as any)) throw new EditError('REFINE_DANGLING', 'a call that is not designed yet (no endpoint) cannot refine a link: design the endpoint first', 'call');
    const ops = callOps(call, x);
    const egr = ops.find((o) => o.op === 'upsert' && o.anchor.startsWith('egr:'))?.anchor.slice(4).split('/', 2)[1] ?? call.edit?.egress;
    const ing = ops.filter((o) => o.op === 'upsert' && o.anchor.startsWith('ing:')).pop()?.anchor ?? `ing:${(call.to as any).service}/${(call.to as any).ingress}`;
    if (!egr) throw new EditError('INVALID', 'the call makes no egress', 'call');
    if (!endOf(scopeFrom, w).missing && !inside(scopeFrom, `egr:${call.from.service}/${egr}`, w)) throw new EditError('NOT_INSIDE', `the call starts in '${call.from.service}', which is not inside '${scopeFrom}'`, 'call');
    if (!endOf(scopeTo, w).missing && !inside(scopeTo, ing, w)) throw new EditError('NOT_INSIDE', `the call reaches '${ing.slice(4)}', which is not inside '${scopeTo}'`, 'call');
    pre = ops;
    Object.assign(data, { from: `egr:${call.from.service}/${egr}`, to: ing, refinedBy: [{ service: call.from.service, egress: egr }] });
  }
  const after = [...rows, ...pre.flatMap((o) => (o.op === 'upsert' ? [{ ...rowOfOp(o), data: o.data }] : []))];
  failOn(checkLink(e.id, data, after));
  return [...pre, up(`link:${e.id}`, data)];
}

const rowOfOp = (o: DraftOpInput) => {
  const p = parseAnchor(o.anchor)!;
  const list = ({ fn: 'functions', ing: 'ingress', egr: 'egress', res: 'resources', bind: 'bindings', svc: 'header' } as Record<string, string>)[p.kind] ?? p.kind;
  return { service: p.service ?? '', list, key: list === 'header' ? '' : p.key };
};
