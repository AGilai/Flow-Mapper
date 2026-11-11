// The subsystem level of a design: the first segment of a component's groupPath (`platform/identity` -> `platform`).
// A component belongs to exactly ONE subsystem (maintainer decision, 0.28). Settings (label, icon, order) live in `subsystem` ItemRows
// (grp:<path>); a top segment with no settings row is a derived subsystem, labelled with its key.

import type { ItemRow } from './item-rows.ts';
import type { Egress, Ingress, Mode, Service, Transport } from './types.ts';

export const SUBSYSTEM_ICONS = ['platform', 'agent', 'network', 'cloud', 'shield', 'database'] as const;
export type SubsystemIcon = typeof SUBSYSTEM_ICONS[number];
/** Same pattern as the manifest's groupPath and the environment's groups. */
export const SUBSYSTEM_KEY = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;
export interface SubsystemRowData { label: string; icon?: SubsystemIcon; order: number; about?: string; owners?: string[] }
export interface SubsystemInfo {
  key: string; label: string; icon: SubsystemIcon | null; order: number;
  about?: string;                                     // Markdown-lite (0.30.2)
  owners?: string[];                                  // user ids (0.33.0)
  derived: boolean;                                   // no settings row: a groupPath names it
  components: { name: string; kind: string; /** only with a second groupPath segment (0.50.0): `platform/gcp` -> `gcp`, a deeper one folded into it */ sub?: string }[];
  /** the registered second-level names under this subsystem (`grp:<key>/<second>` rows, 0.50.0), where there are any */
  subs?: { key: string; label: string }[];
}

/** The subsystem of a groupPath: its first segment ('' when none). */
export const topOf = (path: unknown): string => (typeof path === 'string' && path ? path.split('/')[0] : '');

/** The second groupPath segment ('' when none): `platform/gcp/x` -> `gcp` (a third level folds into the second). */
export const secondOf = (path: unknown): string => (typeof path === 'string' ? path.split('/')[1] ?? '' : '');

/** Component -> its subsystem key ('' = not set). */
export function membershipOf(services: Pick<Service, 'name' | 'groupPath'>[]): Map<string, string> {
  return new Map(services.map((s) => [s.name, topOf(s.groupPath)]));
}

/** The settings rows of `rows` (any rows are fine), as a map key -> data. Keys with a '/' (domains, later) are kept as rows but are no subsystem. */
export const subsystemRows = (rows: ItemRow[]): ItemRow[] => rows.filter((r) => r.list === 'subsystem');

/** Subsystems in settings order, then derived ones (a groupPath top without a settings row) alphabetically. */
export function subsystemsOf(subRows: ItemRow[], services: Pick<Service, 'name' | 'kind' | 'groupPath'>[]): SubsystemInfo[] {
  const set = subRows.filter((r) => !r.key.includes('/')).sort((a, b) => (a.data?.order ?? 0) - (b.data?.order ?? 0) || (a.key < b.key ? -1 : 1));
  const members = new Map<string, { name: string; kind: string; sub?: string }[]>();
  for (const s of services) { const t = topOf(s.groupPath), sub = secondOf(s.groupPath); if (t) members.set(t, [...(members.get(t) ?? []), { name: s.name, kind: s.kind, ...(sub ? { sub } : {}) }]); }
  const subsOf = (top: string) => { const l = subRows.filter((r) => r.key.split('/').length === 2 && topOf(r.key) === top).map((r) => ({ key: r.key, label: String(r.data?.label ?? secondOf(r.key)) })); return l.length ? { subs: l.sort((a, b) => (a.key < b.key ? -1 : 1)) } : {}; };
  const out: SubsystemInfo[] = set.map((r, i) => ({
    key: r.key, label: String(r.data?.label ?? r.key), icon: SUBSYSTEM_ICONS.includes(r.data?.icon) ? r.data.icon : null, order: i, derived: false, ...(typeof r.data?.about === 'string' && r.data.about ? { about: r.data.about } : {}), ...(Array.isArray(r.data?.owners) && r.data.owners.length ? { owners: r.data.owners.filter((x: unknown) => typeof x === 'string') } : {}),
    components: (members.get(r.key) ?? []).sort(byName), ...subsOf(r.key),
  }));
  const have = new Set(out.map((s) => s.key));
  const tops = new Set([...members.keys(), ...subRows.filter((r) => r.key.includes('/')).map((r) => topOf(r.key))]);
  for (const key of [...tops].filter((k) => !have.has(k)).sort()) out.push({ key, label: key, icon: null, order: out.length, derived: true, components: (members.get(key) ?? []).sort(byName), ...subsOf(key) });
  return out;
}
const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The subsystem keys a groupPath may name: settings keys and derived tops. */
export const keysOf = (subRows: ItemRow[]): Set<string> => new Set(subRows.map((r) => r.key));

// ---- one call, rolled up (shared by the roll-up and the abstract links, which must count a refining call in the same line) ----
export interface CallInfo { from: string; to: string; transport: Transport; mode: Mode; line: string }
export const lineId = (from: string, to: string, transport: string, mode: string) => `${from}>${to}|${transport}|${mode}`;
/** The line a call (egress `e` reaching ingress `d`, `viaChannel`: through a topic or queue) belongs to; null inside one subsystem. */
export function callInfo(e: Egress, d: Ingress, viaChannel: boolean, m: Map<string, string>): CallInfo {
  const from = m.get(e.service) ?? '', to = m.get(d.service) ?? '';
  const transport: Transport = e.bindKey.startsWith('amqp-rpc:') ? 'rpc' : e.transport;
  const mode: Mode = e.mode ?? (viaChannel ? 'async' : 'sync');
  return { from, to, transport, mode, line: lineId(from, to, transport, mode) };
}
