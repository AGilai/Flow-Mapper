// Drivers (#130): which client package and version each component uses, per store type. A pure
// aggregation over `clientRows`: one entry per driver of a client row, grouped store type → package →
// version, with the newest major in use as the baseline and the lag (majors behind) of every version.
// Harvested data is the source of truth: no registry is queried, "behind" means behind the newest major
// seen in this env. Shared with the browser (the static preview runs it on the raw model).

import type { ClientRow } from './clients.ts';
import { compareVersions, parseVersion, satisfies, type DriverQuery } from './versions.ts';

/** One driver of one client row: a component's use of a package on one resource. */
export interface DriverEntry {
  kind: string; service: string; store: string | null; resource: string; entity: 'resource' | 'egress';
  package: string; version: string; major: number;
  from: 'own' | 'lib'; lib: { package: string; version?: string; kind?: string } | null;
  accessMode?: string; ops: ClientRow['ops'];
  /** The component carries two majors of this package in this store type. */
  mixed: boolean;
}
/** A driver or field the harvester could not resolve, with what it offers instead. */
export interface UnresolvedItem {
  kind: string; service: string; store: string | null; resource: string; field: string; reason: string; plain?: string; candidates: string[];
  /** The package the field belongs to, when known (a candidates list for `driver.package` has none). */
  package?: string;
}
export interface ComponentUse { service: string; resources: number; mixed: boolean }
export interface DriverVersion {
  /** `4.28.5`, or `4.x` when only a major was reported. */
  version: string; major: number; /** Majors behind the baseline; 0 on the newest. */ lag: number;
  components: ComponentUse[]; entries: DriverEntry[]; resources: number; ops: ClientRow['ops'];
  via: { lib: string; version?: string; kind?: string; count: number }[]; direct: number;
}
export interface DriverPackage {
  package: string; baseline: number; /** Majors in use, newest first. */ majors: number[]; versions: DriverVersion[];
  components: number; resources: number; ops: ClientRow['ops'];
}
export interface DriverTable { kind: string; packages: DriverPackage[]; components: number; versions: number; resources: number }

const clean = (v: string) => { const p = parseVersion(v)!; return [p.major, p.minor, p.patch].slice(0, p.parts).join('.') + (p.parts < 3 ? '.x' : '') + (p.pre ? `-${p.pre}` : ''); };
const baseKey = (kind: string, pkg: string) => `${kind}|${pkg}`;

/** Every driver of every client row that reports a version with a major. */
export function driverEntries(rows: ClientRow[]): DriverEntry[] {
  const out: DriverEntry[] = [];
  for (const r of rows) for (const d of r.drivers) {
    const p = parseVersion(d.version);
    if (!p) continue;
    out.push({
      kind: r.kind, service: r.service, store: r.store, resource: r.id, entity: r.entity, package: d.package, version: clean(d.version!), major: p.major, from: d.from,
      lib: d.from === 'lib' && r.lib ? { package: r.lib.package, version: r.lib.version, kind: r.lib.kind } : null, accessMode: r.accessMode, ops: r.ops, mixed: false,
    });
  }
  const majors = new Map<string, Set<number>>();
  const k = (e: DriverEntry) => `${e.service}|${e.kind}|${e.package}`;
  for (const e of out) (majors.get(k(e)) ?? majors.set(k(e), new Set()).get(k(e))!).add(e.major);
  for (const e of out) e.mixed = majors.get(k(e))!.size > 1;
  return out;
}

/** The newest major in use per store type and package (`redis|ioredis` → 5). */
export function baselinesOf(entries: DriverEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(baseKey(e.kind, e.package), Math.max(m.get(baseKey(e.kind, e.package)) ?? 0, e.major));
  return m;
}
/** How many majors an entry is behind the newest in use (0 = on it). */
export const lagOf = (e: DriverEntry, base: Map<string, number>) => (base.get(baseKey(e.kind, e.package)) ?? e.major) - e.major;
/** `0` none, `1` amber, `2` red (two or more majors behind). */
export const lagLevel = (lag: number): 0 | 1 | 2 => (lag <= 0 ? 0 : lag === 1 ? 1 : 2);

const addOps = (a: ClientRow['ops'], b: ClientRow['ops']) => ({ read: a.read + b.read, write: a.write + b.write, total: a.total + b.total });
const ZERO = { read: 0, write: 0, total: 0 };
/** Resources are counted once per (component, resource) however many drivers they carry. */
const resKey = (e: DriverEntry) => `${e.service}|${e.resource}`;

function versionOf(entries: DriverEntry[], version: string, base: number): DriverVersion {
  const comp = new Map<string, { res: Set<string>; mixed: boolean }>();
  const via = new Map<string, DriverVersion['via'][number]>();
  let ops = ZERO, direct = 0;
  for (const e of entries) {
    const c = comp.get(e.service) ?? comp.set(e.service, { res: new Set(), mixed: false }).get(e.service)!;
    c.res.add(resKey(e)); c.mixed ||= e.mixed;
    ops = addOps(ops, e.ops);
    if (e.lib) { const x = via.get(e.lib.package + e.lib.version) ?? via.set(e.lib.package + e.lib.version, { lib: e.lib.package, version: e.lib.version, kind: e.lib.kind, count: 0 }).get(e.lib.package + e.lib.version)!; x.count++; } else direct++;
  }
  const major = entries[0].major;
  return {
    version, major, lag: base - major, entries, ops, direct, via: [...via.values()],
    components: [...comp].map(([service, c]) => ({ service, resources: c.res.size, mixed: c.mixed })).sort((a, b) => a.service.localeCompare(b.service)),
    resources: new Set(entries.map(resKey)).size,
  };
}

/** The table of one store type (`kind`) from `entries` (already narrowed by a query, if any). Baselines come from `base` (the whole env) so a filter never moves the colours. */
export function driverTable(entries: DriverEntry[], kind: string, base: Map<string, number>): DriverTable {
  const mine = entries.filter((e) => e.kind === kind);
  const byPkg = new Map<string, DriverEntry[]>();
  for (const e of mine) (byPkg.get(e.package) ?? byPkg.set(e.package, []).get(e.package)!).push(e);
  const packages: DriverPackage[] = [...byPkg].map(([pkg, list]) => {
    const byVer = new Map<string, DriverEntry[]>();
    for (const e of list) (byVer.get(e.version) ?? byVer.set(e.version, []).get(e.version)!).push(e);
    const b = base.get(baseKey(kind, pkg)) ?? 0;
    const versions = [...byVer].map(([v, es]) => versionOf(es, v, b)).sort((x, y) => compareVersions(parseVersion(y.version)!, parseVersion(x.version)!));
    return {
      package: pkg, baseline: b, majors: [...new Set(versions.map((v) => v.major))].sort((x, y) => y - x), versions,
      components: new Set(list.map((e) => e.service)).size, resources: new Set(list.map(resKey)).size, ops: list.reduce((a, e) => addOps(a, e.ops), ZERO),
    };
  }).sort((a, b) => b.components - a.components || a.package.localeCompare(b.package));
  return { kind, packages, components: new Set(mine.map((e) => e.service)).size, versions: packages.reduce((n, p) => n + p.versions.length, 0), resources: new Set(mine.map(resKey)).size };
}

/** What each field of a client row left unresolved, plus a version that has no major (a tag, a git URL) or is missing without the harvester saying so. */
export function unresolvedItems(rows: ClientRow[]): UnresolvedItem[] {
  const out: UnresolvedItem[] = [];
  for (const r of rows) {
    const base = { kind: r.kind, service: r.service, store: r.store, resource: r.id };
    const pkgOf = (f: string) => (f.startsWith('lib.driver') ? r.lib?.driver?.package : f.startsWith('lib') ? r.lib?.package : r.driver?.package);
    for (const f of r.unresolved) out.push({ ...base, field: f, reason: r.reasons[f] ?? 'unresolved', plain: r.plain[f], candidates: r.candidates[f] ?? [], package: pkgOf(f) });
    for (const d of r.drivers) {
      const field = d.from === 'own' ? 'driver.version' : 'lib.driver.version';
      if (parseVersion(d.version) || r.unresolved.includes(field)) continue;
      out.push({ ...base, field, reason: d.version ? 'no_major_in_version' : 'version_not_reported', plain: d.version ? `The version is "${d.version}", which has no major number.` : undefined, candidates: [], package: d.package });
    }
  }
  return out;
}

export interface DriverFilter { query: DriverQuery; mixedOnly: boolean }
const has = (s: string | undefined | null, q: string) => !!s && s.toLowerCase().includes(q.toLowerCase());
const textHit = (words: string[], ...fields: (string | undefined | null)[]) => words.every((w) => fields.some((f) => has(f, w)));
const eq = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();

/** Does a driver entry pass the query (component, package, every version condition, mixed only)? */
export const entryPasses = (e: DriverEntry, { query: q, mixedOnly }: DriverFilter) =>
  (!q.component || eq(e.service, q.component)) && (!q.package || eq(e.package, q.package)) && (!mixedOnly || e.mixed)
  && q.versions.every((p) => satisfies(e.version, p)) && textHit(q.text, e.service, e.package);

/** An unresolved entry stays in the result when its component and package pass; its version is unknown, so a version condition cannot rule it out. Mixed-only drops it (nothing is known to be mixed). */
export const unresolvedPasses = (u: UnresolvedItem, { query: q, mixedOnly }: DriverFilter) =>
  !mixedOnly && (!q.component || eq(u.service, q.component)) && (!q.package || eq(u.package, q.package) || u.candidates.some((c) => eq(c, q.package!)))
  && textHit(q.text, u.service, u.package, ...u.candidates);

/** Counts a page shows next to the picker: components with a driver or an unresolved entry, per store type. */
export function componentsPerKind(entries: DriverEntry[], unresolved: UnresolvedItem[]): Map<string, number> {
  const by = new Map<string, Set<string>>();
  for (const x of [...entries, ...unresolved]) (by.get(x.kind) ?? by.set(x.kind, new Set()).get(x.kind)!).add(x.service);
  return new Map([...by].map(([k, s]) => [k, s.size]));
}

/** Which store type the page opens: the requested one when it has data (or when nothing has), else the one with most components (ties: picker order). `from` is set when the choice moved off the request. */
export function chooseStore(requested: string | null, counts: Map<string, number>, order: string[]): { store: string; from: string | null } {
  const withData = order.filter((id) => (counts.get(id) ?? 0) > 0);
  const best = withData.reduce<string | null>((b, id) => (b == null || counts.get(id)! > counts.get(b)! ? id : b), null);
  if (requested && order.includes(requested)) return (counts.get(requested) ?? 0) > 0 || !best ? { store: requested, from: null } : { store: best, from: requested };
  return { store: best ?? 'redis', from: null };
}

/** What the Unresolved rows are (#133); the page shows the same words. */
export const UNRESOLVED_NOTE = 'One row per collection whose path the harvester could not link. The service\'s drivers are known (see its rows above); for these collections the code doesn\'t show which of them is used. Candidates = the service\'s possible paths.';
