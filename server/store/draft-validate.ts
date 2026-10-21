// Validation of draft ops at append time, against the overlay so far (env rows + the ops already accepted, including those
// earlier in the same request). All or nothing: one 422 lists every bad op. The checks are the ones the writers apply later,
// so an op that is accepted here applies cleanly.

import { rowId, rowsToModel, type ItemRow } from '../../core/item-rows.ts';
import { applyOp, opRow, validateOpShape, type DraftOpInput } from '../../core/draft-ops.ts';
import { buildIndex } from '../../core/graph-index.ts';
import { dtoSlots } from '../../core/endpoint-info.ts';
import { stores } from '../../core/stores.ts';
import { designIssues, SERVICE_KINDS, twoGroups } from '../../core/design-rules.ts';
import { checkLinks } from '../../core/links.ts';
import { HttpError } from '../errors.ts';
import { isList, keyOf, validateEntity, validateServiceHeader, type ListName } from '../schema.ts';
import { normMeta, normStatus } from './dtos.ts';
import { SOURCES } from './schemas.ts';

export interface PreparedOp { op: 'upsert' | 'delete'; anchor: string; service: string; list: string; key: string; data?: any }
/** Ops per request: a 114-component HLD import makes about 2,300 (Fix #53). */
export const MAX_OPS = 5000;
interface Bad { index: number; code: string; message: string }
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

class OpError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
const bad = (message: string, code = 'INVALID'): never => { throw new OpError(code, message); };

function check(map: Map<string, ItemRow>, i: DraftOpInput): PreparedOp {
  const shape = validateOpShape(i);
  if (shape.length) bad(shape.join('; '));
  const r = opRow(i);
  const has = (service: string, list: string, key = '') => map.has(rowId({ service, list, key }));
  if (r.list === 'channels' && !r.service) {
    const owner = [...map.values()].find((x) => x.list === 'channels' && x.key === r.key)?.service;
    if (!owner) bad(`channel '${r.key}' has no owner yet: give the service that declares it (service)`);
    r.service = owner!;
  } else if (r.list === 'channels') {
    const owner = [...map.values()].find((x) => x.list === 'channels' && x.key === r.key)?.service;
    if (owner) r.service = owner; // a channel key has one owner
  }
  const base = { op: i.op, anchor: i.anchor, ...r };
  if (r.list === 'header') {
    if (i.op === 'delete') return base;
    const { name, ...rest } = i.data as Record<string, any>;
    if (rest.kind !== undefined && !(SERVICE_KINDS as readonly string[]).includes(rest.kind)) bad(`component kind '${rest.kind}' must be one of ${SERVICE_KINDS.join(', ')}`, 'BAD_KIND');
    if (name !== undefined && name !== r.service) bad(`header name '${name}' differs from the anchor 'svc:${r.service}'`);
    if (rest.alsoIn !== undefined || rest.details?.alsoIn !== undefined) bad(`${r.service}: a component belongs to one subsystem; 'alsoIn' is not supported: pick one (groupPath)`, 'TWO_GROUPS');
    const errs = validateServiceHeader({ name: r.service, ...rest });
    if (errs.length) bad(`service header does not match schema: ${errs.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('; ')}`);
    return { ...base, data: rest };
  }
  if (r.service && !has(r.service, 'header')) bad(`service '${r.service}' does not exist (create it with svc:${r.service} first)`, 'NO_SERVICE');
  if (i.op === 'delete') return base;
  const data = i.data as Record<string, any>;
  if (isList(r.list)) {
    const errs = validateEntity(r.list as ListName, data);
    if (errs.length) bad(`${r.list} item does not match schema: ${errs.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('; ')}`);
    if (keyOf(r.list as ListName, data) !== r.key) bad(`the item's ${r.list === 'channels' ? 'bindKey' : 'id'} '${keyOf(r.list as ListName, data)}' must equal the anchor key '${r.key}'`);
  } else if (r.list === 'dto') {
    const rest = r.key.slice(0, r.key.lastIndexOf('|')), status = r.key.slice(r.key.lastIndexOf('|') + 1), role = rest.slice(rest.lastIndexOf('|') + 1), ingress = rest.slice(0, rest.lastIndexOf('|'));
    if (!isObj(data) || data.content === undefined) bad('a dto item is {content, meta?}');
    try { normStatus(status); normMeta(data.meta); } catch (e: any) { bad(e.message); }
    if (status && role !== 'response') bad('status applies to response DTOs only');
    const ing = map.get(rowId({ service: r.service, list: 'ingress', key: ingress }));
    if (!ing) bad(`ingress '${ingress}' of service '${r.service}' does not exist`);
    const { slots, note } = dtoSlots(ing!.data);
    if (!slots.some((s) => s.role === role)) bad(`ingress '${ingress}' takes no ${role} DTO${slots.length ? '' : ` (${note ?? 'it takes none'})`}`);
  } else if (r.list === 'event_dto') {
    if (!isObj(data) || data.content === undefined) bad('an event DTO item is {content, meta?}');
    if (r.key.includes('*')) bad(`'${r.key}' is a pattern; a DTO belongs to one event type`);
    try { normMeta(data.meta); } catch (e: any) { bad(e.message); }
  } else if (r.list === 'schema') {
    const source = r.key.slice(r.key.lastIndexOf('|') + 1);
    if (!(SOURCES as readonly string[]).includes(source)) bad(`source must be one of ${SOURCES.join(', ')}`);
  } else if (r.list === 'subsystem') {
    if (!isObj(data) || typeof data.label !== 'string' || !data.label.trim() || data.label.length > 80) bad('a subsystem item is {label (1 to 80 characters), icon?, order?}');
    if (data.order !== undefined && (!Number.isInteger(data.order) || data.order < 0)) bad('order must be a position, 0 or more');
  } else if (r.list === 'link') {
    if (!isObj(data)) bad('a link item is {name, from, to, mode?, transport?, description?, refinedBy?}');
  } else if (r.list === 'flowrel') {
    if (!isObj(data) || typeof data.from !== 'string' || typeof data.to !== 'string' || typeof data.type !== 'string') bad('a flow relation item is {from, to, type, note?}');
  } else if (r.list === 'flow') {
    if (!isObj(data)) bad('a flow item is {name?, description?, links?, steps?, doc?}');
    else if ((data as any).links !== undefined && (data as any).links !== null) { const e = checkLinks((data as any).links); if (e) bad(e); }
    if (!has(r.service, 'ingress', r.key)) bad(`flow entry '${r.key}' is not an ingress of '${r.service}'`);
  }
  return { ...base, data };
}

/** Prepare a request's ops in order, laying each accepted op over `rows` (mutated). Throws 422 listing every bad op. `groups`: pass an array to have NO_GROUP checked (the subsystems are the `subsystem` rows of `rows`). */
export function prepareOps(rows: Map<string, ItemRow>, inputs: unknown, opts: { groups?: string[] } = {}): PreparedOp[] {
  if (!Array.isArray(inputs) || !inputs.length) throw new HttpError(422, 'INVALID', 'ops must be a non-empty list of {op, anchor, service?, data?}');
  if (inputs.length > MAX_OPS) throw new HttpError(422, 'INVALID', `at most ${MAX_OPS} ops per request`);
  const out: PreparedOp[] = [], errs: Bad[] = [];
  inputs.forEach((i, index) => {
    try { const p = check(rows, i); applyOp(rows, p); out.push(p); }
    catch (e: any) {
      if (e instanceof OpError) errs.push({ index, code: e.code, message: e.message });
      else if (/^anchor/.test(e?.message ?? '')) errs.push({ index, code: 'INVALID', message: e.message });
      else throw e;
    }
  });
  if (!errs.length) {
    errs.push(...twoGroups(out.map((p, index) => ({ index, op: p.op, service: p.service, list: p.list, data: p.data }))));
    errs.push(...designIssues(rows, out.flatMap((p, index) => (p.op === 'upsert' ? [{ index, service: p.service, list: p.list, key: p.key }] : [])), opts.groups,
      out.flatMap((p, index) => (p.op === 'delete' ? [{ index, service: p.service, list: p.list, key: p.key }] : []))));
    const wanted = out.filter((p) => p.list === 'schema' && p.op === 'upsert');
    if (wanted.length) {
      const known = new Set(stores(buildIndex(rowsToModel('', [...rows.values()]))).map((s) => s.key));
      for (const p of wanted) { const key = p.key.slice(0, p.key.lastIndexOf('|')); if (!known.has(key)) errs.push({ index: out.indexOf(p), code: 'INVALID', message: `data store '${key}' is not a resource of any service (declare the resource first)` }); }
    }
  }
  if (errs.length) {
    errs.sort((a, b) => Number(b.code === 'TWO_GROUPS') - Number(a.code === 'TWO_GROUPS'));
    const code = errs.some((e) => e.code === 'TWO_GROUPS') ? 'TWO_GROUPS' : errs.every((e) => e.code === errs[0].code) ? errs[0].code : 'INVALID';
    throw new HttpError(422, code, `${errs.length} op(s) rejected: ${errs[0].message}${errs.length > 1 ? ` (+${errs.length - 1} more)` : ''}`, errs);
  }
  return out;
}
