// Field-level diff of a DTO, event DTO or store schema: flatten either a JSON Schema or an example JSON into
// path -> {type, required, enum}, then compare by path (never by position).

import { isJsonSchema, schemaRows } from '../json-schema.ts';

export interface FieldInfo { type: string; required: boolean; enum?: unknown[] }
export interface FieldMark { path: string; mark: 'new' | 'changed' | 'removed'; was?: string; type: string }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const typeOfValue = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v);

/** Example JSON: objects add `.key`, arrays add `[]` (all elements merged: a field present in any element is a field). */
function flatten(v: unknown, path: string, out: Map<string, FieldInfo>) {
  if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) { const p = path ? `${path}.${k}` : k; out.set(p, { type: typeOfValue(x), required: false }); flatten(x, p, out); }
  } else if (Array.isArray(v)) {
    const elems = v.filter((x) => isObj(x) || Array.isArray(x));
    for (const x of elems) flatten(x, `${path}[]`, out);
  }
}

export function fieldsOf(content: unknown): Map<string, FieldInfo> {
  const out = new Map<string, FieldInfo>();
  if (isJsonSchema(content)) {
    for (const r of schemaRows(content)) out.set(r.path, { type: r.type, required: r.required, ...(r.enum ? { enum: r.enum } : {}) });
  } else if (isObj(content) || Array.isArray(content)) flatten(content, '', out);
  return out;
}

const key = (x: unknown) => JSON.stringify(x);
function change(a: FieldInfo, b: FieldInfo): string | null {
  const parts: string[] = [];
  if (a.type !== b.type) parts.push(`was ${a.type}`);
  const ea = new Set((a.enum ?? []).map(key)), eb = new Set((b.enum ?? []).map(key));
  const plus = (b.enum ?? []).filter((x) => !ea.has(key(x))), minus = (a.enum ?? []).filter((x) => !eb.has(key(x)));
  if (plus.length) parts.push(`+ ${plus.map(String).join(', ')}`);
  if (minus.length) parts.push(`− ${minus.map(String).join(', ')}`);
  if (!a.required && b.required) parts.push('now required');
  if (a.required && !b.required) parts.push('no longer required');
  return parts.length ? parts.join('; ') : null;
}

const under = (path: string, parent: string) => path.startsWith(`${parent}.`) || path.startsWith(`${parent}[]`);

/** New / removed / changed fields. The children of a new or removed field are dropped (the highest level carries the mark). */
export function diffFields(base: Map<string, FieldInfo>, cur: Map<string, FieldInfo>): FieldMark[] {
  const marks: FieldMark[] = [];
  for (const [path, c] of cur) {
    const b = base.get(path);
    if (!b) marks.push({ path, mark: 'new', type: c.type });
    else { const was = change(b, c); if (was) marks.push({ path, mark: 'changed', was, type: c.type }); }
  }
  for (const [path, b] of base) if (!cur.has(path)) marks.push({ path, mark: 'removed', type: b.type });
  const top = (m: FieldMark) => !marks.some((o) => o !== m && o.mark === m.mark && o.mark !== 'changed' && under(m.path, o.path));
  return marks.filter(top).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
