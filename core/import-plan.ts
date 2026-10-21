// An HLD import plan (docs/DESIGN-IMPORT.md §7) turned into draft ops. Pure: the manifest validator and the facts about the
// environment (its rows with the draft laid over them, its subsystems, the baseline versions) come in as arguments.

import { checkLinks } from './links.ts';
import { anchorOfRow } from './anchors.ts';
import { ENTITY_LISTS, rowId, type ItemRow } from './item-rows.ts';
import { applyOp, opRow, type DraftOpInput } from './draft-ops.ts';
import { planGroups, planLinks } from './import-plan-links.ts';
import { topOf } from './subsystems.ts';

export interface PlanIssue { path: string; message: string; code?: string }
/** One or more problems with a plan; `code` of an issue is the HTTP error code (PLAN_VERSION, PLAN_ENV, PLAN_EXISTS, PLAN_NO_SERVICE) when it has one. */
export class PlanError extends Error {
  issues: PlanIssue[];
  constructor(issues: PlanIssue[]) { super(issues[0]?.message ?? 'invalid plan'); this.issues = issues; }
}
export interface PlanContext {
  env: string;
  groups: { key: string; label: string }[];
  validateManifest: (m: unknown) => { path: string; message: string }[];
  /** The version a service had in the source when the design copied it (the baseline), if it did. */
  baselineVersion: (service: string) => number | null | undefined;
}
/** `skipped.links` counts the plan's links that were not applied (0.28: it used to count all of them). */
export interface PlannedOps { ops: DraftOpInput[]; warnings: string[]; skipped: { links: number }; links: { abstract: number; flow: number; skipped: number }; questions: { total: number; blocking: string[] } }

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const KEY: Record<string, (e: any) => string> = Object.fromEntries(ENTITY_LISTS.map((l) => [l, (e: any) => (l === 'channels' ? e.bindKey : e.id)]));
const opFor = (service: string, list: string, key: string, data: unknown): DraftOpInput => ({ op: 'upsert', anchor: anchorOfRow({ service, list, key }), ...(list === 'channels' ? { service } : {}), data });

/** `transport: other` + `details.transport: undecided` (the encoding DESIGN-IMPORT gave before the value existed) -> `transport: undecided`. */
function fixUndecided(list: string, e: any, counter: { n: number }): any {
  if ((list !== 'ingress' && list !== 'egress') || !isObj(e) || e.transport !== 'other' || e.details?.transport !== 'undecided') return e;
  counter.n++;
  const { transport: _t, ...details } = e.details;
  const { details: _d, ...rest } = e;
  return { ...rest, transport: 'undecided', ...(Object.keys(details).length ? { details } : {}) };
}

export function planToOps(plan: unknown, rows: ItemRow[], cx: PlanContext): PlannedOps {
  const issues: PlanIssue[] = [], warnings: string[] = [], ops: DraftOpInput[] = [], undecided = { n: 0 };
  const err = (path: string, message: string, code?: string) => issues.push({ path, message, code });
  const p = plan as any;
  if (!isObj(p)) throw new PlanError([{ path: '', message: 'a plan is a JSON object', code: 'INVALID' }]);
  if (p.planVersion !== 1) throw new PlanError([{ path: 'planVersion', message: `planVersion must be 1 (got ${JSON.stringify(p.planVersion)})`, code: 'PLAN_VERSION' }]);
  if (p.environment?.name !== undefined && p.environment.name !== cx.env) err('environment.name', `the plan is for environment '${p.environment.name}', not '${cx.env}'`, 'PLAN_ENV');
  const KNOWN = ['planVersion', 'planId', 'createdAt', 'createdBy', 'sources', 'environment', 'manifests', 'extensions', 'flows', 'dtos', 'schemas', 'links', 'mapping', 'questions'];
  const unknown = Object.keys(p).filter((k) => !KNOWN.includes(k));
  if (unknown.length) warnings.push(`unknown top-level plan field(s) ignored: ${unknown.join(', ')}`);
  const have = new Set(rows.filter((r) => r.list === 'header').map((r) => r.service));
  const headerOf = (s: string) => rows.find((r) => rowId(r) === rowId({ service: s, list: 'header', key: '' }));
  const planGroup = new Map<string, string>(), planHeader = new Map<string, any>();
  /** A component has ONE subsystem: `alsoIn` (top level or details) is refused. */
  const noAlsoIn = (at: string, o: any) => {
    if (o?.alsoIn !== undefined || o?.details?.alsoIn !== undefined) err(`${at}${o?.alsoIn !== undefined ? '.alsoIn' : '.details.alsoIn'}`, `a component belongs to one subsystem: 'alsoIn' is not supported, pick one (groupPath)`, 'TWO_GROUPS');
  };
  const add = (list: unknown, name: string) => { if (!Array.isArray(list) && list !== undefined) err(name, `${name} must be a list`); return Array.isArray(list) ? list : []; };

  add(p.manifests, 'manifests').forEach((m: any, i: number) => {
    const at = `manifests[${i}]`;
    if (typeof m === 'string') return err(at, `'${m}' is a file reference: inline the manifest in the plan (a plan is one JSON document)`);
    if (!isObj(m)) return err(at, 'a manifest is an object');
    const full = { ...m, env: cx.env };
    for (const e of cx.validateManifest(full)) err(`${at}${e.path.replace(/^\$/, '')}`, e.message);
    const name = m.service?.name;
    if (typeof name !== 'string') return;
    if (m.kind !== 'full') err(at, `a new component is a full manifest (kind 'full'); '${name}' is '${m.kind}'`);
    if (have.has(name)) return err(`${at}.service.name`, `component '${name}' already exists in the environment or the draft: reclassify it as an extension`, 'PLAN_EXISTS');
    have.add(name);
    const { name: _n, ...header } = m.service;
    noAlsoIn(`${at}.service`, header);
    if (header.groupPath) planGroup.set(name, header.groupPath);
    planHeader.set(name, { kind: 'service', ...header });
    ops.push({ op: 'upsert', anchor: `svc:${name}`, data: { kind: 'service', ...header } });
    for (const l of ENTITY_LISTS) for (const e of add(m[l], `${at}.${l}`)) if (isObj(e)) ops.push(opFor(name, l, KEY[l](e), fixUndecided(l, e, undecided)));
  });

  add(p.extensions, 'extensions').forEach((x: any, i: number) => {
    const at = `extensions[${i}]`;
    if (!isObj(x) || typeof x.service !== 'string') return err(at, 'an extension is {service, upsert, baseVersion?, groupPath?}');
    if (!have.has(x.service)) return err(`${at}.service`, `component '${x.service}' is not in the environment or the draft: copy it (environment.services) or write a manifest for it`, 'PLAN_NO_SERVICE');
    if (x.delete !== undefined) err(`${at}.delete`, 'an extension only adds or replaces items; to remove something, raise a question and edit the draft by hand');
    const v = cx.baselineVersion(x.service);
    if (x.baseVersion !== undefined && v != null && x.baseVersion !== v) warnings.push(`extension of '${x.service}': baseVersion ${x.baseVersion} is not the version the design copied (${v})`);
    noAlsoIn(at, x);
    const head = planHeader.get(x.service) ?? headerOf(x.service)?.data ?? { kind: 'service' };
    if (typeof x.groupPath === 'string' && x.groupPath) {
      const first = planGroup.get(x.service);
      if (first !== undefined && topOf(first) !== topOf(x.groupPath)) err(`${at}.groupPath`, `${x.service} is given two subsystems in this plan ('${first}' and '${x.groupPath}'): a component belongs to one, pick one`, 'TWO_GROUPS');
      else planGroup.set(x.service, x.groupPath);
    }
    if (x.groupPath !== undefined && x.groupPath !== head.groupPath) {
      const { version: _v, harvestedAt: _h, commit: _c, ...cur } = head;
      ops.push({ op: 'upsert', anchor: `svc:${x.service}`, data: { ...cur, groupPath: x.groupPath } });
    }
    for (const [l, items] of Object.entries(x.upsert ?? {})) {
      if (!(ENTITY_LISTS as readonly string[]).includes(l)) { err(`${at}.upsert.${l}`, `unknown list '${l}' (one of ${ENTITY_LISTS.join(', ')})`); continue; }
      for (const e of add(items, `${at}.upsert.${l}`)) if (isObj(e)) ops.push(opFor(x.service, l, KEY[l](e), fixUndecided(l, e, undecided)));
    }
  });

  add(p.dtos, 'dtos').forEach((d: any, i: number) => {
    if (!isObj(d)) return err(`dtos[${i}]`, 'a dto is {service, ingress, role, status?, content, meta?} or {event, content, meta?}');
    const data = { content: d.content, meta: d.meta ?? null };
    if (typeof d.event === 'string') ops.push({ op: 'upsert', anchor: `evt:${d.event}`, data });
    else ops.push({ op: 'upsert', anchor: anchorOfRow({ service: d.service, list: 'dto', key: `${d.ingress}|${d.role}|${d.status ?? ''}` }), data });
  });
  add(p.schemas, 'schemas').forEach((s: any, i: number) => {
    if (!isObj(s) || typeof s.key !== 'string') return err(`schemas[${i}]`, 'a schema is {key, source?, content}');
    ops.push({ op: 'upsert', anchor: `schema:${s.source ?? 'manual'}/${s.key}`, data: s.content });
  });
  add(p.flows, 'flows').forEach((f: any, i: number) => {
    const at = `flows[${i}]`;
    if (!isObj(f) || typeof f.entry?.service !== 'string' || typeof f.entry?.ingress !== 'string') return err(at, 'a flow is {entry: {service, ingress}, name, description?, links?, steps?, doc?}');
    const { name, description, steps, doc, links } = f;
    const badLinks = links === undefined ? null : checkLinks(links, `${at}.links`);
    if (badLinks) return err(at, badLinks);
    ops.push({ op: 'upsert', anchor: `flow:${f.entry.service}/${f.entry.ingress}`, data: Object.fromEntries(Object.entries({ name, description, steps, doc, links }).filter(([, v]) => v !== undefined)) });
  });

  const groups = planGroups(p.environment?.groups, rows);
  ops.unshift(...groups.ops); warnings.push(...groups.warnings);
  const after = new Map(rows.map((r) => [rowId(r), r]));
  for (const o of ops) applyOp(after, { ...opRow(o), op: o.op, data: o.data });
  const links = planLinks(p.links === undefined ? undefined : add(p.links, 'links'), [...after.values()]);
  ops.push(...links.ops); warnings.push(...links.warnings);

  if (issues.length) throw new PlanError(issues);
  if (undecided.n) warnings.push(`${undecided.n} item(s) used the transitional encoding (transport other + details.transport undecided): stored as transport 'undecided'`);
  const qs = add(p.questions, 'questions').filter(isObj);
  return { ops, warnings, skipped: { links: links.counts.skipped }, links: links.counts, questions: { total: qs.length, blocking: qs.filter((q: any) => q.blocking === true).map((q: any) => String(q.id ?? '?')) } };
}
