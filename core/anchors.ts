// The one anchor grammar: a string that names one item (or one field of a DTO / schema) of an environment. Used by
// marks, draft ops, import-plan mapping and (later) discussion threads. Fixed: never change it.
//   svc:<s>   fn:<s>/<id>  ing:<s>/<id>  egr:<s>/<id>  res:<s>/<id>  bind:<s>/<id>   ch:<bindKey>
//   dto:<s>/<role>/<status or ->/<ingress>   evt:<type>   schema:<source>/<storeKey>   flow:<s>/<ingress>
//   grp:<path> (a subsystem; the path may hold '/')   link:<id> (an abstract link)   rel:<id> (a flow-to-flow link)
//   <anchor>#<fieldPath>   (dto, evt, schema only)
// Service names never contain '/', so `<s>/` splits on the first '/'; the rest is the key, verbatim.

import type { ItemRow } from './item-rows.ts';

export type AnchorKind = 'svc' | 'fn' | 'ing' | 'egr' | 'res' | 'bind' | 'ch' | 'dto' | 'evt' | 'schema' | 'flow' | 'grp' | 'link' | 'rel';
export interface Parsed { kind: AnchorKind; service?: string; key: string; field?: string }

const ENTITY: Record<string, string> = { fn: 'functions', ing: 'ingress', egr: 'egress', res: 'resources', bind: 'bindings' };
const PREFIX: Record<string, string> = { functions: 'fn', ingress: 'ing', egress: 'egr', resources: 'res', bindings: 'bind' };
const KINDS = new Set<string>(['svc', 'fn', 'ing', 'egr', 'res', 'bind', 'ch', 'dto', 'evt', 'schema', 'flow', 'grp', 'link', 'rel']);
const DESIGN: Record<string, string> = { grp: 'subsystem', link: 'link', rel: 'flowrel' };
const SOURCES = ['code', 'db', 'manual'];
const FIELDED = new Set(['dto', 'evt', 'schema']);

/** Split `<s>/<rest>` at the first slash. */
function split(rest: string): [string, string] | null {
  const i = rest.indexOf('/');
  return i <= 0 || i === rest.length - 1 ? null : [rest.slice(0, i), rest.slice(i + 1)];
}
const lastBar = (key: string): [string, string] => { const i = key.lastIndexOf('|'); return [key.slice(0, i), key.slice(i + 1)]; };

export function parseAnchor(a: unknown): Parsed | null {
  if (typeof a !== 'string') return null;
  const c = a.indexOf(':');
  if (c <= 0) return null;
  const kind = a.slice(0, c);
  if (!KINDS.has(kind)) return null;
  let rest = a.slice(c + 1), field: string | undefined;
  if (FIELDED.has(kind)) {
    const h = rest.lastIndexOf('#');
    if (h >= 0) { field = rest.slice(h + 1); rest = rest.slice(0, h); if (!field) return null; }
  }
  if (!rest) return null;
  const k = kind as AnchorKind;
  const out = (p: Omit<Parsed, 'kind'>): Parsed => ({ kind: k, ...p, ...(field !== undefined ? { field } : {}) });
  if (k === 'svc') return rest.includes('/') ? null : out({ service: rest, key: '' });
  if (k === 'ch') return out({ key: rest });
  if (k === 'evt' || k === 'grp' || k === 'link' || k === 'rel') return out({ service: '', key: rest });
  if (k === 'schema') {
    const p = split(rest);
    return p && SOURCES.includes(p[0]) ? out({ service: '', key: `${p[1]}|${p[0]}` }) : null;
  }
  const p = split(rest);
  if (!p) return null;
  if (k === 'dto') {
    const q = split(p[1]), r = q && split(q[1]);
    if (!q || !r || !['request', 'response'].includes(q[0])) return null;
    return out({ service: p[0], key: `${r[1]}|${q[0]}|${r[0] === '-' ? '' : r[0]}` });
  }
  return out({ service: p[0], key: p[1] });
}

const need = (a: string): Parsed => parseAnchor(a) ?? (() => { throw new Error(`anchor '${a}' is not valid`); })();

export function anchorOfRow(r: Pick<ItemRow, 'service' | 'list' | 'key'>): string {
  switch (r.list) {
    case 'header': return `svc:${r.service}`;
    case 'channels': return `ch:${r.key}`;
    case 'event_dto': return `evt:${r.key}`;
    case 'flow': return `flow:${r.service}/${r.key}`;
    case 'subsystem': return `grp:${r.key}`;
    case 'link': return `link:${r.key}`;
    case 'flowrel': return `rel:${r.key}`;
    case 'schema': { const [k, s] = lastBar(r.key); return `schema:${s}/${k}`; }
    case 'dto': { const [rest, status] = lastBar(r.key), [ingress, role] = lastBar(rest); return `dto:${r.service}/${role}/${status || '-'}/${ingress}`; }
    default:
      if (PREFIX[r.list]) return `${PREFIX[r.list]}:${r.service}/${r.key}`;
      throw new Error(`anchor: unknown list '${r.list}'`);
  }
}

/** The row an anchor names (a field anchor names its item). `service` is the owner of a channel (`ch:` carries none). */
export function rowOfAnchor(a: string, service?: string): { service: string; list: string; key: string } {
  const p = need(a);
  switch (p.kind) {
    case 'svc': return { service: p.service!, list: 'header', key: '' };
    case 'ch': return { service: service ?? '', list: 'channels', key: p.key };
    case 'evt': return { service: '', list: 'event_dto', key: p.key };
    case 'schema': return { service: '', list: 'schema', key: p.key };
    case 'dto': return { service: p.service!, list: 'dto', key: p.key };
    case 'flow': return { service: p.service!, list: 'flow', key: p.key };
    case 'grp': case 'link': case 'rel': return { service: '', list: DESIGN[p.kind], key: p.key };
    default: return { service: p.service!, list: ENTITY[p.kind], key: p.key };
  }
}

export const fieldAnchor = (a: string, path: string) => `${a}#${path}`;
export const itemOf = (a: string): string => { const p = parseAnchor(a); return p?.field === undefined ? a : a.slice(0, a.length - p.field.length - 1); };

/** The anchor one level up: field -> its item (nested: the parent field), entity / dto / flow -> `svc:`; null at the top or when it needs the graph (`ch:`, `evt:`, `schema:`). */
export function parentOf(a: string): string | null {
  const p = need(a);
  if (p.field !== undefined) {
    const item = itemOf(a), i = p.field.lastIndexOf('.');
    return i < 0 ? item : fieldAnchor(item, p.field.slice(0, i).replace(/(\[\])+$/, ''));
  }
  if (p.kind === 'svc' || p.kind === 'ch' || p.kind === 'evt' || p.kind === 'schema' || p.kind === 'grp' || p.kind === 'link' || p.kind === 'rel') return null;
  return `svc:${p.service}`;
}
