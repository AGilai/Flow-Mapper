// Clients (#27): how a service reaches a data store (or, on an egress, another target) — access
// mode, its own driver, and a wrapper library with the driver bundled in it. One row per client
// site. Rows are listed per store, service and driver; counted by driver major (derived from the
// version string); and flagged when a service carries two majors of the same driver package.
// Stored in the entity JSON (`client` on a resource or egress); nothing is indexed. Pure.

import type { GraphIndex } from './graph-index.ts';
import { storeKey, storeView } from './stores.ts';
import { linkHops, normaliseVia, viaMatches, type LinkedHop } from './via.ts';
import type { AccessMode, ClientInfo, DriverRef, LibRef, Unresolved } from './types.ts';

/** The major of a version string: `4.27.6` → `4`, `v5.3.2` → `5`, `^5.0.0` → `5`, `npm:ioredis@5.3.2` → `5`; undefined for tags (`latest`) and URLs. */
export function majorOf(version?: string | null): string | undefined {
  let v = (version ?? '').trim();
  if (v.includes('://') || v.startsWith('git+')) return undefined;
  if (v.startsWith('npm:')) v = v.slice(v.lastIndexOf('@') + 1);
  return /^[\^~<>=v\s]*(\d+)(?:[.\-+]|$)/.exec(v)?.[1];
}

export interface DriverUse { package: string; version?: string; major?: string; versionSource?: string; from: 'own' | 'lib' }
export interface ClientRow {
  /** Store bind key, or the egress's bind key for a non-store client. */
  store: string | null; kind: string; service: string; entity: 'resource' | 'egress'; id: string;
  accessMode?: AccessMode; accessId?: string;
  driver: DriverRef | null; lib: LibRef | null;
  /** The service's own driver and the one nested in `lib`, with majors. */
  drivers: DriverUse[];
  via: LinkedHop[];
  /** Driver packages the service carries in two majors, e.g. ioredis 5 and 4. */
  mixed: { package: string; majors: string[] }[];
  /** Fields the harvester could not resolve (`unresolved` what=client, detail), e.g. `driver.version`. */
  unresolved: string[];
  /** Why each unresolved field is missing (the harvester's `reason`). */
  reasons: Record<string, string>;
}
export interface ClientFilter { store?: string; service?: string; driver?: string; driverMajor?: string; lib?: string; accessMode?: string; via?: string }
export interface DriverCount { driver: string; major: string | null; label: string; services: number; clients: number }
export interface ClientList { rows: ClientRow[]; counts: DriverCount[] }

const lc = (s?: string) => s?.toLowerCase();

function driversOf(c: ClientInfo): DriverUse[] {
  const out: DriverUse[] = [];
  if (c.driver?.package) out.push({ package: c.driver.package, version: c.driver.version, major: majorOf(c.driver.version), versionSource: c.driver.versionSource, from: 'own' });
  const d = c.lib?.driver;
  if (d?.package) out.push({ package: d.package, version: d.version, major: majorOf(d.version), versionSource: d.versionSource, from: 'lib' });
  return out;
}

export function mixedMajors(drivers: DriverUse[]): ClientRow['mixed'] {
  const by = new Map<string, Set<string>>();
  for (const d of drivers) if (d.major) (by.get(d.package) ?? by.set(d.package, new Set()).get(d.package)!).add(d.major);
  return [...by].filter(([, m]) => m.size > 1).map(([pkg, m]) => ({ package: pkg, majors: [...m].sort((a, b) => Number(b) - Number(a)) }));
}

/** Field paths named by `unresolved` what=client; an entry without a detail names nothing (the contract rule warns about it). */
const unresolvedFields = (u?: Unresolved[]) => (u ?? []).filter((x) => x.what === 'client' && x.detail?.trim()).map((x) => x.detail!.trim());
/** The `reason` given for each unresolved field, e.g. `{'driver.version': 'lockfile_not_found'}`. */
const unresolvedReasons = (u?: Unresolved[]) => Object.fromEntries((u ?? []).filter((x) => x.what === 'client' && x.detail?.trim()).map((x) => [x.detail!.trim(), x.reason]));

/** `ioredis@4` → {driver: 'ioredis', driverMajor: '4'}; `ioredis@` means version unknown; a bare package has no major. */
export function parseDriver(s: string): { driver: string; driverMajor?: string } {
  const at = s.lastIndexOf('@');
  return at > 0 ? { driver: s.slice(0, at), driverMajor: s.slice(at + 1) } : { driver: s };
}

/** The drivers of a row that match `driver` (a package, or `pkg@major`) and `major`: the service's own and/or the lib's. */
export function driversOn(r: ClientRow, driver?: string, major?: string): DriverUse[] {
  const p = driver ? parseDriver(driver) : { driver: undefined, driverMajor: undefined };
  const m = major ?? p.driverMajor;
  return r.drivers.filter((d) => (!p.driver || lc(d.package) === lc(p.driver)) && (m === undefined || (d.major ?? '') === m));
}

function matches(r: ClientRow, f: ClientFilter): boolean {
  if (f.store && !(r.store === f.store || r.store?.startsWith(f.store + '/'))) return false;
  if (f.service && r.service !== f.service) return false;
  if (f.accessMode && r.accessMode !== f.accessMode) return false;
  if (f.lib && lc(r.lib?.package) !== lc(f.lib)) return false;
  if (f.driver || f.driverMajor) {
    // A service is "on ioredis 4.x" when either its own driver or the one in its lib is. `driver` may be `pkg@major` ('pkg@' = version unknown).
    if (!driversOn(r, f.driver, f.driverMajor).length) return false;
  }
  if (f.via && !viaMatches({ via: r.via, callSites: [] }, f.via) && !lc(r.lib?.package)?.includes(lc(f.via)!)) return false;
  return true;
}

/** Every client row of the env that matches `f` (text filters are case-insensitive; `store` matches a key or its group). */
export function clientRows(g: GraphIndex, f: ClientFilter = {}): ClientRow[] {
  const rows: ClientRow[] = [];
  const add = (store: string | null, kind: string, service: string, entity: 'resource' | 'egress', id: string, c: ClientInfo | undefined, unresolved?: Unresolved[]) => {
    const gaps = unresolvedFields(unresolved);
    if (!c && !gaps.length) return;
    const info = c ?? {};
    const drivers = driversOf(info);
    const svc = g.services.get(service);
    rows.push({
      store, kind, service, entity, id, accessMode: info.accessMode, accessId: info.accessId,
      driver: info.driver ?? null, lib: info.lib ?? null, drivers,
      via: svc ? linkHops(svc, normaliseVia(info.via)) : [], mixed: mixedMajors(drivers), unresolved: gaps, reasons: unresolvedReasons(unresolved),
    });
  };
  for (const r of g.model.resources) add(storeKey(r), r.kind, r.service, 'resource', r.id, r.client, r.unresolved);
  for (const e of g.model.egress) add(e.bindKey ?? null, e.transport, e.service, 'egress', e.id, e.client, e.unresolved);
  rows.sort((a, b) => (a.store ?? '').localeCompare(b.store ?? '') || a.service.localeCompare(b.service) || a.id.localeCompare(b.id));
  return rows.filter((r) => matches(r, f));
}

export const driverLabel = (pkg: string, major: string | null | undefined) => (major ? `${pkg} ${major}.x` : `${pkg}, version not reported`);

/** Services and clients per driver package and major, most used first; a service with two drivers counts under both. */
export function driverCounts(rows: ClientRow[]): DriverCount[] {
  const by = new Map<string, { driver: string; major: string | null; services: Set<string>; clients: number }>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const d of r.drivers) {
      const k = `${d.package}@${d.major ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const x = by.get(k) ?? by.set(k, { driver: d.package, major: d.major ?? null, services: new Set(), clients: 0 }).get(k)!;
      x.services.add(r.service);
      x.clients++;
    }
  }
  return [...by.values()].map((x) => ({ driver: x.driver, major: x.major, label: driverLabel(x.driver, x.major), services: x.services.size, clients: x.clients }))
    .sort((a, b) => b.services - a.services || a.label.localeCompare(b.label));
}

export function listClients(g: GraphIndex, f: ClientFilter = {}): ClientList {
  const rows = clientRows(g, f);
  return { rows, counts: driverCounts(rows) };
}

/** A store view with its client rows (kept out of stores.ts so core/stores stays free of client logic). */
export function storeWithClients(g: GraphIndex, key: string) {
  const v = storeView(g, key);
  return v && { ...v, clients: clientRows(g, { store: key }).filter((r) => r.store === key) };
}
