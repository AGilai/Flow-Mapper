// Turns a JSON Schema into flat, indented rows for a field table: name, type, required, description.
// Resolves local $ref (#/definitions/..., #/$defs/...), merges allOf, expands nested objects and array
// items. Pure: shared with the browser.

export interface SchemaRow {
  /** Dotted path from the root; array items add `[]` (e.g. `items[].sku`). */
  path: string;
  /** Last path segment. */
  name: string;
  depth: number;
  /** `string`, `object`, `string[]`, `string | null`, `enum` ... */
  type: string;
  required: boolean;
  description?: string;
  format?: string;
  enum?: unknown[];
  /** Name of the $ref this field points to (the last path segment), when it has one. */
  ref?: string;
}

type S = Record<string, any>;
const isObj = (v: unknown): v is S => !!v && typeof v === 'object' && !Array.isArray(v);

/** A JSON Schema document (as opposed to example JSON): `$schema`, or `type: object` with `properties`. */
export function isJsonSchema(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (typeof v.$schema === 'string') return true;
  const t = v.type;
  return (t === 'object' || (Array.isArray(t) && t.includes('object'))) && isObj(v.properties);
}

const refName = (ref: string) => {
  const last = ref.split('/').pop() ?? ref;
  try { return decodeURIComponent(last); } catch { return last; }
};

export function schemaRows(root: unknown): SchemaRow[] {
  if (!isObj(root)) return [];
  const rows: SchemaRow[] = [];

  const resolve = (ref: string): S | null => {
    if (!ref.startsWith('#')) return null;
    let n: any = root;
    for (const seg of ref.slice(1).split('/').filter(Boolean)) {
      let k = seg;
      try { k = decodeURIComponent(seg); } catch { /* keep raw */ }
      n = n?.[k.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    return isObj(n) ? n : null;
  };

  /** Follow $ref chains and merge allOf. `refs` is the chain of refs being expanded (cycle guard). */
  function effective(s: S, refs: string[]): { s: S; ref?: string; refs: string[]; cyclic: boolean } {
    let ref: string | undefined;
    let cur = s;
    let cyclic = false;
    while (typeof cur.$ref === 'string') {
      ref ??= refName(cur.$ref);
      if (refs.includes(cur.$ref)) { cyclic = true; break; }
      refs = [...refs, cur.$ref];
      const next = resolve(cur.$ref);
      if (!next) break;
      const { $ref: _r, ...own } = cur;
      cur = { ...next, ...own };
    }
    if (Array.isArray(cur.allOf)) {
      const { allOf, ...rest } = cur;
      cur = rest;
      for (const part of allOf.filter(isObj)) {
        const p = effective(part, refs).s;
        cur = { ...p, ...cur, properties: { ...p.properties, ...cur.properties }, required: [...(p.required ?? []), ...(cur.required ?? [])] };
      }
    }
    return { s: cur, ref, refs, cyclic };
  }

  const typeOf = (s: S, refs: string[]): string => {
    const label = (x: unknown): string => {
      if (!isObj(x)) return 'any';
      const e = effective(x, refs);
      const t = typeOf(e.s, e.refs);
      return t === 'any' && e.ref ? e.ref : t;
    };
    if (Array.isArray(s.enum) && !s.type) return 'enum';
    if (s.const !== undefined && !s.type) return 'const';
    const alt = s.oneOf ?? s.anyOf;
    if (!s.type && Array.isArray(alt)) return [...new Set(alt.map(label))].join(' | ');
    const t = Array.isArray(s.type) ? s.type.join(' | ') : s.type;
    if (t === 'array' || (!t && s.items)) return `${isObj(s.items) ? label(s.items) : 'any'}[]`;
    return t ?? (isObj(s.properties) ? 'object' : 'any');
  };

  function walk(schema: S, path: string, name: string, depth: number, required: boolean, refs: string[]) {
    const e = effective(schema, refs);
    const s = e.s;
    const row: SchemaRow = { path, name, depth, type: typeOf(s, e.refs), required };
    const desc = s.description ?? s.title;
    if (typeof desc === 'string' && desc) row.description = desc;
    if (typeof s.format === 'string') row.format = s.format;
    if (Array.isArray(s.enum)) row.enum = s.enum;
    else if (s.const !== undefined) row.enum = [s.const];
    if (e.ref) row.ref = e.ref;
    rows.push(row);
    if (!e.cyclic) children(s, path, depth + 1, e.refs);
  }

  function children(s: S, path: string, depth: number, refs: string[]) {
    const req = new Set<string>(Array.isArray(s.required) ? s.required : []);
    if (isObj(s.properties)) {
      for (const [k, v] of Object.entries(s.properties)) if (isObj(v)) walk(v, path ? `${path}.${k}` : k, k, depth, req.has(k), refs);
    }
    if (isObj(s.items)) {
      const it = effective(s.items, refs);
      if (!it.cyclic) children(it.s, `${path}[]`, depth, it.refs);
    }
  }

  const top = effective(root, []);
  children(top.s, '', 0, top.refs);
  return rows;
}
