// Drivers export (#130): the CSV and the Markdown report of the Drivers view, from the same aggregation as the page
// (core/drivers.ts). Pure, so the browser (also the static preview) and `GET /api/envs/:env/clients/drivers.csv|.md` share it.

import type { ClientRow } from './clients.ts';
import { driverEntries, baselinesOf, driverTable, unresolvedItems, entryPasses, unresolvedPasses, UNRESOLVED_NOTE, type DriverEntry, type UnresolvedItem } from './drivers.ts';
import { typeOf, kindLabel } from './driver-kinds.ts';
import { parseDriverQuery, formatDriverQuery } from './versions.ts';
import { verdictOf, verdictText } from './driver-verdict.ts';

export interface DriversModel { entries: DriverEntry[]; unresolved: UnresolvedItem[]; base: Map<string, number> }
export interface ExportOpts {
  env: string;
  /** A store type id (`redis`), or `all`. */
  store: string;
  /** The query text as in the URL (`mongoose < 6`). */
  q?: string; mixed?: boolean;
  /** `2026-11-17`. */
  date: string; version?: string; link?: string;
}
/** What an export holds: the rows left after the store type, query and mixed filters. */
export interface Selection { entries: DriverEntry[]; unresolved: UnresolvedItem[]; kinds: string[]; filter: string }

export function driversModel(rows: ClientRow[]): DriversModel {
  const norm = rows.map((r) => ({ ...r, kind: typeOf(r.kind) }));
  const entries = driverEntries(norm);
  return { entries, unresolved: unresolvedItems(norm), base: baselinesOf(entries) };
}

const uniq = (a: string[]) => [...new Set(a)].sort((x, y) => x.localeCompare(y));

/** The filter of the page, in words, and the rows it keeps (baselines stay those of the whole env). */
export function selectDrivers(m: DriversModel, o: ExportOpts): Selection {
  const all = !o.store || o.store === 'all';
  const inKind = (x: { kind: string }) => all || x.kind === o.store;
  const ents = m.entries.filter(inKind), unr = m.unresolved.filter(inKind);
  const vocab = { packages: uniq([...ents.map((e) => e.package), ...unr.map((u) => u.package).filter(Boolean) as string[]]), components: uniq([...ents, ...unr].map((x) => x.service)) };
  const query = parseDriverQuery(o.q ?? '', vocab), f = { query, mixedOnly: !!o.mixed };
  const entries = ents.filter((e) => entryPasses(e, f)), unresolved = unr.filter((u) => unresolvedPasses(u, f));
  const qtext = formatDriverQuery(query);
  const filter = [all ? 'All store types' : kindLabel(o.store), qtext ? `query "${qtext}"` : null, o.mixed ? 'only components on mixed majors' : null].filter(Boolean).join(' · ');
  const kinds = uniq([...entries, ...unresolved].map((x) => x.kind));
  return { entries, unresolved, kinds, filter };
}

/** RFC 4180 quoting; a leading `=`, `+`, `-` or `@` is not escaped (the data is package names and versions). */
const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const viaOf = (es: DriverEntry[]) => uniq(es.map((e) => (e.lib ? `${e.lib.package}${e.lib.version ? '@' + e.lib.version : ''}` : 'direct'))).join('; ');

export const CSV_COLUMNS = ['env', 'store type', 'package', 'version', 'major', 'lag', 'newest major in env', 'component', 'resources', 'ops read', 'ops write', 'ops total', 'via', 'status', 'candidates', 'reason', 'resource id', 'field', 'filter'];

/** One row per component x package x version, then one per unresolved entry (per resource: `resource id`, `field`, `reason` tell them apart). `lag` is blank on the newest major. The last column states the filter. */
export function driversCsv(m: DriversModel, o: ExportOpts): string {
  const sel = selectDrivers(m, o);
  const groups = new Map<string, DriverEntry[]>();
  for (const e of sel.entries) { const k = [e.kind, e.package, e.version, e.service].join('\u0000'); (groups.get(k) ?? groups.set(k, []).get(k)!).push(e); }
  const lines: unknown[][] = [];
  const sorted = [...groups.values()].sort((a, b) => a[0].kind.localeCompare(b[0].kind) || a[0].package.localeCompare(b[0].package) || b[0].major - a[0].major || a[0].version.localeCompare(b[0].version) || a[0].service.localeCompare(b[0].service));
  for (const es of sorted) {
    const e = es[0], base = m.base.get(`${e.kind}|${e.package}`) ?? e.major;
    const ops = es.reduce((a, x) => ({ read: a.read + x.ops.read, write: a.write + x.ops.write, total: a.total + x.ops.total }), { read: 0, write: 0, total: 0 });
    lines.push([o.env, kindLabel(e.kind), e.package, e.version, e.major, base - e.major || '', base, e.service, new Set(es.map((x) => x.resource)).size, ops.read, ops.write, ops.total, viaOf(es), 'resolved', '', '', '', '', sel.filter]);
  }
  const unr = [...sel.unresolved].sort((a, b) => a.kind.localeCompare(b.kind) || a.service.localeCompare(b.service) || a.resource.localeCompare(b.resource) || a.field.localeCompare(b.field));
  for (const u of unr) lines.push([o.env, kindLabel(u.kind), u.package ?? '', '', '', '', '', u.service, 1, '', '', '', '', 'unresolved', u.candidates.join('; '), u.reason, u.resource, u.field, sel.filter]);
  return [CSV_COLUMNS, ...lines].map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pipe = (s: string) => s.replace(/\|/g, '\\|');

/** The Markdown report: scope, verdict per store type, one table per package, mixed majors, unresolved, footer. */
export function driversReport(m: DriversModel, o: ExportOpts): string {
  const sel = selectDrivers(m, o);
  const out: string[] = [`# Drivers report · ${o.env} · ${o.date}`, '', `Scope: environment \`${o.env}\` · ${sel.filter}.`, ''];
  if (!sel.kinds.length) out.push('Nothing matches this scope: no driver or unresolved entry is left after the filter.', '');
  for (const kind of sel.kinds) {
    const label = kindLabel(kind), ents = sel.entries.filter((e) => e.kind === kind), unr = sel.unresolved.filter((u) => u.kind === kind);
    const table = driverTable(ents, kind, m.base);
    const q = formatDriverQuery(parseDriverQuery(o.q ?? '', { packages: uniq(ents.map((e) => e.package)), components: uniq([...ents, ...unr].map((x) => x.service)) })) || (o.mixed ? 'mixed majors' : '');
    out.push(`## ${label}`, '', verdictText(verdictOf(label, q, table, unr.length, 0)), '');
    for (const p of table.packages) {
      out.push(`### ${p.package}`, '', `Newest major in use: ${p.baseline}.x. ${plural(p.components, 'component')}, ${plural(p.resources, 'resource')}.`, '', '| Version | Lag | Components | Resources | Ops (read / write / total) | Via |', '|---|---|---|---|---|---|');
      for (const v of p.versions) {
        const via = [...(v.direct ? ['direct'] : []), ...v.via.map((x) => `${x.lib}${x.version ? '@' + x.version : ''}`)].join(', ');
        out.push(`| ${pipe(v.version)} | ${v.lag ? plural(v.lag, 'major') + ' behind' : 'newest'} | ${pipe(v.components.map((c) => c.service + (c.mixed ? ' (mixed)' : '')).join(', '))} | ${v.resources} | ${v.ops.read} / ${v.ops.write} / ${v.ops.total} | ${pipe(via)} |`);
      }
      out.push('');
    }
  }
  const mixed = new Map<string, Set<number>>();
  for (const e of sel.entries.filter((x) => x.mixed)) { const k = `${e.service} · ${kindLabel(e.kind)} · ${e.package}`; (mixed.get(k) ?? mixed.set(k, new Set()).get(k)!).add(e.major); }
  out.push('## Mixed majors', '');
  out.push(...(mixed.size ? [...mixed].sort(([a], [b]) => a.localeCompare(b)).map(([k, s]) => `- ${k}: majors ${[...s].sort((a, b) => b - a).join(' and ')}`) : ['None in this scope.']), '');
  out.push('## Unresolved', '');
  if (sel.unresolved.length) {
    out.push(UNRESOLVED_NOTE, '', '| Component | Store type | Package | Field | Reason | Resources | Candidates |', '|---|---|---|---|---|---|---|');
    const groups = new Map<string, UnresolvedItem[]>();
    for (const u of sel.unresolved) { const k = [u.service, u.kind, u.package ?? '', u.field, u.reason, u.candidates.join(',')].join('\u0000'); (groups.get(k) ?? groups.set(k, []).get(k)!).push(u); }
    for (const us of groups.values()) {
      const u = us[0], ids = uniq(us.map((x) => x.resource));
      out.push(`| ${pipe(u.service)} | ${kindLabel(u.kind)} | ${pipe(u.package ?? '')} | ${u.field} | ${pipe(u.plain ?? u.reason)} (\`${u.reason}\`) | ${pipe(`${ids.length}: ${ids.join(', ')}`)} | ${pipe(u.candidates.join(', '))} |`);
    }
  } else out.push('None in this scope.');
  out.push('', '---', `Generated by Flow-Mapper${o.version ? ' ' + o.version : ''} on ${o.date}. Harvested data as reported; "behind" means behind the newest major in use in this environment.${o.link ? ` View: ${o.link}` : ''}`, '');
  return out.join('\n');
}
