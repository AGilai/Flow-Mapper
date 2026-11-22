// Frame 35: the query of one data-store call as cards, pure (drawn by web/js/views/query-block.js). Summary line, call line, field groups, value sources and
// the schema marks, from `fields[]` of a resource step. Everything works without `value`. Shared with the browser, so no `node:` imports.

import type { StepField, FieldValue } from './types.ts';

export type Role = StepField['role'];
export const ROLES: Role[] = ['filter', 'projection', 'update', 'sort'];
export const LETTER: Record<Role, string> = { filter: 'F', projection: 'P', update: 'U', sort: 'S' };
export const ROLE_NAME: Record<Role, string> = { filter: 'Filter', projection: 'Projection', update: 'Update', sort: 'Sort' };
export const ROLE_OP: Record<Role, string> = { filter: 'where', projection: 'select', update: 'set', sort: 'order by' };
export const KINDS = ['param', 'query', 'body', 'header', 'ctx', 'const', 'expr'] as const;
export const MAX_FROM = 120;

/** A filter a shared DB helper adds: `flag` starts with `helper_implicit_filter`. */
export const isHelper = (f: StepField): boolean => !!f.flag && /^helper_implicit_filter/.test(f.flag);

export interface Value { from: string; kind: typeof KINDS[number]; source?: { file: string; line?: number } }
/** The value source of a field as the UI shows it, or null (absent or not readable). An unknown `kind` reads as `expr`; a `from` over 120 characters is cut with "…". */
export function valueOf(f: { value?: FieldValue | null }): Value | null {
  const v = f.value;
  if (!v || typeof v !== 'object' || typeof v.from !== 'string' || !v.from.trim()) return null;
  const from = v.from.length > MAX_FROM ? `${v.from.slice(0, MAX_FROM - 1)}…` : v.from;
  const kind = (KINDS as readonly string[]).includes(v.kind as string) ? (v.kind as Value['kind']) : 'expr';
  const s = v.source;
  const source = s && typeof s.file === 'string' && s.file ? { file: s.file, ...(typeof s.line === 'number' ? { line: s.line } : {}) } : undefined;
  return { from, kind, ...(source ? { source } : {}) };
}
export const hasValues = (fields: StepField[] = []): boolean => fields.some((f) => valueOf(f));
/** `params.deviceIdentifier` of a `param` value -> `deviceIdentifier` (the name of its Path parameters row), else null. */
export const paramName = (v: Value | null): string | null => (v?.kind === 'param' && v.from.startsWith('params.') && v.from.length > 7 ? v.from.slice(7) : null);

export interface SummaryPart { role: Role; names: string[]; more: number; implicit: number }
/** The one-line summary of a call: per role in the order F P U S, up to two field names then "+N"; the helper filters are counted apart ("+N implicit"). */
export function summaryParts(fields: StepField[] = []): SummaryPart[] {
  const out: SummaryPart[] = [];
  for (const role of ROLES) {
    const all = fields.filter((f) => f.role === role);
    const own = role === 'filter' ? all.filter((f) => !isHelper(f)) : all, implicit = all.length - own.length;
    if (!own.length && !implicit) continue;
    out.push({ role, names: own.slice(0, 2).map((f) => f.path), more: Math.max(0, own.length - 2), implicit });
  }
  return out;
}
/** The summary as text (tests, titles): `F userId deviceIdentifier +2 implicit P status`. */
export const summaryText = (fields?: StepField[]): string => summaryParts(fields).map((p) => [LETTER[p.role], ...p.names, p.more ? `+${p.more}` : '', p.implicit ? (p.names.length ? `+${p.implicit} implicit` : `${p.implicit} implicit`) : ''].filter(Boolean).join(' ')).join(' ');

export interface Seg { k: 'pn' | 'fn' | 'tx' | 'vl' | 'hv'; s: string }
/** The call line `Collection.op({ filter }, { projection })` as segments (hv: a helper filter, muted; vl: a value from the harvester, only when `withValues`). */
export function callLine(coll: string, op: string, fields: StepField[] = [], withValues = false): Seg[] {
  const val = (f: StepField) => (withValues ? valueOf(f)?.from ?? null : null);
  const pair = (f: StepField): Seg[] => {
    const v = val(f);
    if (f.operator) return [{ k: 'tx', s: `${f.path}: { ${f.operator}: ` }, v ? { k: 'vl', s: v } : { k: 'tx', s: '…' }, { k: 'tx', s: ' }' }];
    return v ? [{ k: 'tx', s: `${f.path}: ` }, { k: 'vl', s: v }] : [{ k: 'tx', s: f.path }];
  };
  const fl = fields.filter((f) => f.role === 'filter');
  const segs: Seg[] = [{ k: 'pn', s: `${coll}.` }, { k: 'fn', s: op }, { k: 'tx', s: '(' }];
  if (fl.length) {
    segs.push({ k: 'tx', s: '{\n  ' });
    fl.forEach((f, i) => {
      if (i) segs.push({ k: 'tx', s: ',\n  ' });
      const p = pair(f);
      if (isHelper(f)) segs.push({ k: 'hv', s: p.map((x) => x.s).join('') }); else segs.push(...p);
    });
    segs.push({ k: 'tx', s: '\n}' });
  } else segs.push({ k: 'tx', s: '{}' });
  const extra: Seg[][] = [];
  const pr = fields.filter((f) => f.role === 'projection');
  if (pr.length) extra.push([{ k: 'tx', s: `{ ${pr.map((f) => f.path).join(', ')} }` }]);
  const up = fields.filter((f) => f.role === 'update');
  if (up.length) {
    const inner: Seg[] = [];
    up.forEach((f, i) => { if (i) inner.push({ k: 'tx', s: ', ' }); const v = val(f); inner.push({ k: 'tx', s: v ? `${f.path}: ` : f.path }); if (v) inner.push({ k: 'vl', s: v }); });
    extra.push([{ k: 'tx', s: '{ $set: { ' }, ...inner, { k: 'tx', s: ' } }' }]);
  }
  const so = fields.filter((f) => f.role === 'sort');
  if (so.length) extra.push([{ k: 'tx', s: `{ sort: { ${so.map((f) => `${f.path}: ${f.operator === 'desc' ? -1 : 1}`).join(', ')} } }` }]);
  extra.forEach((e) => segs.push({ k: 'tx', s: ',\n' }, ...e));
  segs.push({ k: 'tx', s: ')' });
  return segs;
}
export const callLineText = (coll: string, op: string, fields?: StepField[], withValues = false): string => callLine(coll, op, fields, withValues).map((x) => x.s).join('');

export interface Row { f: StepField; op: string; helper: boolean; noDdl: boolean; value: Value | null }
export interface Group { role: Role; title: string; opn: string; rows: Row[] }
/** The labelled groups of a call, only those with fields. The operator column is the field's operator, else "=" for a filter and nothing for the rest. */
export function groups(fields: StepField[] = []): Group[] {
  return ROLES.flatMap((role) => {
    const rows = fields.filter((f) => f.role === role).map((f) => ({ f, op: f.operator || (role === 'filter' ? '=' : ''), helper: isHelper(f), noDdl: f.inDdl === false, value: valueOf(f) }));
    return rows.length ? [{ role, title: ROLE_NAME[role], opn: ROLE_OP[role], rows }] : [];
  });
}

/** The letters a call (or several: the union) puts on each field path of the schema, in the order F P U S. */
export function usedLetters(callsFields: (StepField[] | undefined)[]): Map<string, string[]> {
  const m = new Map<string, Set<Role>>();
  for (const fs of callsFields) for (const f of fs ?? []) { if (!m.has(f.path)) m.set(f.path, new Set()); m.get(f.path)!.add(f.role); }
  return new Map([...m].map(([p, set]) => [p, ROLES.filter((r) => set.has(r)).map((r) => LETTER[r])]));
}
