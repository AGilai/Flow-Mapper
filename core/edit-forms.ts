// Edit forms as ops: pure builders from a DesignEdit and the rows being edited (the draft's overlay) to whole-item upserts / deletes.
// Calls are in edit-calls.ts, the dispatcher in design-edit.ts. A builder throws EditError {code, message, field?}; the ops it returns are
// validated again when appended (schema, NO_SERVICE, NO_TARGET, NO_GROUP...), all or nothing.

import { parseAnchor } from './anchors.ts';
import type { DraftOpInput } from './draft-ops.ts';
import { SERVICE_KINDS } from './design-rules.ts';
import { EditError, setField, slug, unique, type DesignEdit, type EndpointEdit, type Idx } from './edit-kit.ts';
import type { ItemRow } from './item-rows.ts';
import { setLinks, setRuntime } from './edit-links.ts';
import { checkLinks, cleanLinks } from './links.ts';

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const up = (anchor: string, data: unknown): DraftOpInput => ({ op: 'upsert', anchor, data });

export function componentOps(e: Extract<DesignEdit, { kind: 'component' }>, x: Idx): DraftOpInput[] {
  if (typeof e.name !== 'string' || !NAME.test(e.name)) throw new EditError('BAD_NAME', `component name '${e.name ?? ''}' must be lowercase letters, digits and '-' (at most 63 characters, starting with a letter or digit)`, 'name');
  if (!(SERVICE_KINDS as readonly string[]).includes(e.serviceKind)) throw new EditError('BAD_KIND', `serviceKind must be one of ${SERVICE_KINDS.join(', ')}`, 'serviceKind');
  const { version: _v, harvestedAt: _h, commit: _c, ...keep } = x.get(e.name, 'header')?.data ?? {};
  const data: Record<string, any> = { ...keep, kind: e.serviceKind };
  for (const k of ['groupPath', 'team', 'description'] as const) setField(data, k, e[k]);
  setLinks(data, e.links); setRuntime(data, e.runtime);
  return [up(`svc:${e.name}`, data)];
}

/** The ops of an endpoint and the ingress row they leave (a call needs its key and transport). */
export function endpointBuild(e: EndpointEdit, x: Idx): { ops: DraftOpInput[]; row: ItemRow } {
  if (!x.get(e.service, 'header')) throw new EditError('NO_SERVICE', `component '${e.service}' does not exist in this design`, 'service');
  const old = e.id ? x.get(e.service, 'ingress', e.id) : undefined;
  const transport = e.transport ?? old?.data.transport;
  if (!transport) throw new EditError('INVALID', 'transport is required', 'transport');
  const rawKey = (e.bindKey ?? '').trim() || old?.data.bindKey;
  const base = slug((rawKey ?? '').split(/[/:]/).pop() ?? '');
  const id = e.id ?? unique(`in.${base}`, new Set(x.list(e.service, 'ingress').map((r) => r.key)));
  const bindKey = rawKey || (transport === 'undecided' ? `tbd:${e.service}/${slug(id.replace(/^in\./, ''))}` : '');
  if (!bindKey) throw new EditError('INVALID', 'bindKey is required (what callers address this endpoint by)', 'bindKey');
  const handler = e.handler?.trim() || old?.data.handler || `${id}.handle`;
  const data: Record<string, any> = { ...(old?.data ?? {}), id, bindKey, transport, handler };
  if (typeof e.entryPoint === 'boolean') data.entryPoint = e.entryPoint; else if (e.entryPoint === null) delete data.entryPoint;
  setLinks(data, e.links);
  if (e.events !== undefined) { if (e.events.length) data.events = e.events.map((v) => ({ ...v, handler: v.handler?.trim() || handler })); else delete data.events; }
  if (e.description !== undefined) {
    const details = { ...(data.details ?? {}) };
    setField(details, 'description', e.description);
    if (Object.keys(details).length) data.details = details; else delete data.details;
  }
  const stubs = [...new Set([handler, ...(data.events ?? []).map((v: any) => v.handler)])].filter((h) => !x.get(e.service, 'functions', h));
  return {
    ops: [...stubs.map((h) => up(`fn:${e.service}/${h}`, { id: h, name: h, steps: [] })), up(`ing:${e.service}/${id}`, data)],
    row: { service: e.service, list: 'ingress', key: id, data },
  };
}
export const endpointOps = (e: EndpointEdit, x: Idx) => endpointBuild(e, x).ops;

export function flowOps(e: Extract<DesignEdit, { kind: 'flow' }>, x: Idx): DraftOpInput[] {
  const ing = x.get(e.service, 'ingress', e.ingress);
  if (!ing) throw new EditError('NO_ITEM', `endpoint '${e.ingress}' of '${e.service}' does not exist in this design`, 'ingress');
  const ops: DraftOpInput[] = [];
  if (e.entryPoint !== undefined && (ing.data.entryPoint ?? null) !== e.entryPoint) { // true / false are explicit, null clears to the default rule
    const data = { ...ing.data };
    if (e.entryPoint === null) delete data.entryPoint; else data.entryPoint = e.entryPoint;
    ops.push(up(`ing:${e.service}/${e.ingress}`, data));
  }
  if (e.name !== undefined || e.description !== undefined || e.links !== undefined) {
    const data = { ...(x.get(e.service, 'flow', e.ingress)?.data ?? {}) };
    if (e.links !== undefined) { const bad = e.links === null ? null : checkLinks(e.links); if (bad) throw new EditError('INVALID', bad, 'links'); data.links = e.links === null ? null : cleanLinks(e.links) ?? null; }  // null clears the flow's links (as '' does the name)
    if (e.name !== undefined) data.name = String(e.name).trim().slice(0, 200);   // '' clears (the draft reader and apply treat it so)
    if (e.description !== undefined) data.description = String(e.description).trim();
    ops.push(up(`flow:${e.service}/${e.ingress}`, data));
  }
  if (e.order) {
    const f = x.get(e.service, 'functions', e.order.fn);
    if (!f) throw new EditError('NO_ITEM', `function '${e.order.fn}' of '${e.service}' does not exist in this design`, 'order');
    const steps = [...(f.data.steps ?? [])].sort((a: any, b: any) => a.seq - b.seq), want = e.order.seqs ?? [];
    const key = (a: number[]) => [...a].sort((p, q) => p - q).join(',');
    if (key(want) !== key(steps.map((s: any) => s.seq))) throw new EditError('BAD_ORDER', `order must list every step number of ${e.order.fn} exactly once (${steps.map((s: any) => s.seq).join(', ')})`, 'order');
    ops.push(up(`fn:${e.service}/${e.order.fn}`, { ...f.data, steps: want.map((q, i) => ({ ...steps.find((s: any) => s.seq === q), seq: i + 1 })) }));
  }
  return ops;
}

export function dtoOps(e: Extract<DesignEdit, { kind: 'dto' | 'event-dto' }>, x: Idx): DraftOpInput[] {
  if (e.kind === 'event-dto') return [up(`evt:${e.type}`, { content: e.content, meta: x.get('', 'event_dto', e.type)?.data.meta ?? null })];
  const status = e.status ?? '';
  const old = x.get(e.service, 'dto', `${e.ingress}|${e.role}|${status}`);
  return [up(`dto:${e.service}/${e.role}/${status || '-'}/${e.ingress}`, { content: e.content, meta: old?.data.meta ?? null })];
}

/** Delete a component (svc:), endpoint (ing:, with its DTOs and flow text), DTO (dto:) or event DTO (evt:). */
export function deleteOps(e: Extract<DesignEdit, { kind: 'delete' }>, rows: ItemRow[], x: Idx): DraftOpInput[] {
  const p = parseAnchor(e.anchor);
  if (!p || p.field !== undefined || !['svc', 'ing', 'dto', 'evt'].includes(p.kind)) throw new EditError('BAD_ANCHOR', `'${e.anchor}' cannot be deleted here: give svc:, ing:, dto: or evt:`, 'anchor');
  const list = { svc: 'header', ing: 'ingress', dto: 'dto', evt: 'event_dto' }[p.kind as 'svc'];
  const key = p.key, service = p.service ?? '';
  if (!x.get(service, list, key)) throw new EditError('NO_ITEM', `'${e.anchor}' does not exist in this design`, 'anchor');
  const out: DraftOpInput[] = [{ op: 'delete', anchor: e.anchor }];
  if (p.kind === 'ing') {
    for (const r of rows) if (r.service === service && r.list === 'dto' && r.key.startsWith(`${key}|`)) out.push({ op: 'delete', anchor: `dto:${service}/${r.key.split('|')[1]}/${r.key.split('|')[2] || '-'}/${key}` });
    if (x.get(service, 'flow', key)) out.push({ op: 'delete', anchor: `flow:${service}/${key}` });
  }
  return out;
}
