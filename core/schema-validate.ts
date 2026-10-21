// Minimal JSON Schema (2020-12) validator covering the keywords used in schema/manifest.schema.json:
// $ref (local), type, const, enum, required, properties, additionalProperties, unevaluatedProperties
// (as "no properties beyond those declared in this schema and its allOf"), items, oneOf, allOf,
// pattern, minLength, maxLength, maxItems, minimum, uniqueItems, format: date-time.
// Kept dependency-free on purpose; swap for ajv if dependencies become available.

type Schema = Record<string, any> | boolean;
export interface SchemaError { path: string; message: string }

export function createValidator(root: Record<string, any>) {
  const resolveRef = (ref: string): Schema => {
    if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
    return ref.slice(2).split('/').reduce((n: any, k) => n?.[k], root);
  };
  const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  const typeOk = (t: string, v: unknown) => t === typeOf(v) || (t === 'number' && typeof v === 'number');

  // Collect property names a schema declares, following $ref and allOf.
  const declared = (s: Schema, acc = new Set<string>()): Set<string> => {
    if (typeof s !== 'object') return acc;
    if (s.$ref) declared(resolveRef(s.$ref), acc);
    for (const k of Object.keys(s.properties ?? {})) acc.add(k);
    for (const sub of s.allOf ?? []) declared(sub, acc);
    return acc;
  };

  const check = (s: Schema, v: any, path: string, errs: SchemaError[]): void => {
    if (s === true) return;
    if (s === false) { errs.push({ path, message: 'not allowed' }); return; }
    if (s.$ref) check(resolveRef(s.$ref), v, path, errs);
    if (s.type && !typeOk(s.type, v)) { errs.push({ path, message: `must be ${s.type}` }); return; }
    if ('const' in s && v !== s.const) errs.push({ path, message: `must equal ${JSON.stringify(s.const)}` });
    if (s.enum && !s.enum.includes(v)) errs.push({ path, message: `must be one of ${s.enum.join(', ')}` });
    if (typeof v === 'string') {
      if (s.maxLength !== undefined && v.length > s.maxLength) errs.push({ path, message: `must have at most ${s.maxLength} characters` });
      if (s.minLength && v.length < s.minLength) errs.push({ path, message: `must have at least ${s.minLength} characters` });
      if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) errs.push({ path, message: `must match ${s.pattern}` });
      if (s.format === 'date-time' && Number.isNaN(Date.parse(v))) errs.push({ path, message: 'must be a date-time' });
    }
    if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) errs.push({ path, message: `must be >= ${s.minimum}` });
    if (Array.isArray(v)) {
      if (s.maxItems !== undefined && v.length > s.maxItems) errs.push({ path, message: `must have at most ${s.maxItems} items` });
      if (s.items) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`, errs));
      if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) errs.push({ path, message: 'items must be unique' });
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const r of s.required ?? []) if (!(r in v)) errs.push({ path, message: `missing required property '${r}'` });
      for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in v) check(sub as Schema, v[k], `${path}.${k}`, errs);
      if (s.additionalProperties === false) {
        for (const k of Object.keys(v)) if (!(k in (s.properties ?? {}))) errs.push({ path, message: `unknown property '${k}'` });
      }
      if (s.unevaluatedProperties === false) {
        const ok = declared(s);
        for (const k of Object.keys(v)) if (!ok.has(k)) errs.push({ path, message: `unknown property '${k}'` });
      }
    }
    for (const sub of s.allOf ?? []) check(sub, v, path, errs);
    if (s.oneOf) {
      const results = s.oneOf.map((sub: Schema) => { const e: SchemaError[] = []; check(sub, v, path, e); return e; });
      const passing = results.filter((e: SchemaError[]) => !e.length).length;
      if (passing !== 1) {
        if (passing > 1) errs.push({ path, message: 'matches more than one allowed shape' });
        else errs.push(...results.reduce((a: SchemaError[], b: SchemaError[]) => (b.length < a.length ? b : a)));
      }
    }
  };

  return (value: unknown): SchemaError[] => {
    const errs: SchemaError[] = [];
    check(root, value, '$', errs);
    return errs;
  };
}
