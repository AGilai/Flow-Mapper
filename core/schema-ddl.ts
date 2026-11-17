// #124: a data store's schema as a DDL table. Pure, shared with the browser. Two shapes are read: JSON Schema (properties / type / required) and
// the documented 'manual' shape `{ fields: { name: "type or description" | { type, description, required, enum, fields } }, indexes: [...] }`.
// A manual schema is turned into its JSON Schema equivalent, so one table (schema-table.js, the marks, the diff) draws both. What is not DDL
// (`doc`, `incomplete`, `$comment`, `x-*` ...) comes back as `extra`, to show under the table, never among the fields. Anything unexpected is a
// warning (contract code `schema-not-ddl`), never a failure.
import { isJsonSchema } from './json-schema.ts';

export interface DdlIndex { name: string; keys: string; unique: boolean; notes: string }
export interface Ddl {
  kind: 'json-schema' | 'manual' | 'unknown';
  /** What the field table draws: the content itself (json-schema) or its JSON Schema equivalent (manual); null when there are no fields to draw. */
  schema: Record<string, any> | null;
  indexes: DdlIndex[];
  /** The keys that are not DDL, in the order they were written. */
  extra: [string, unknown][];
  warnings: string[];
}
type S = Record<string, any>;
type Warn = (m: string) => void;
const isObj = (v: unknown): v is S => !!v && typeof v === 'object' && !Array.isArray(v);

export const SCHEMA_NOT_DDL = 'schema-not-ddl';
const TYPES = new Set(['string', 'str', 'text', 'number', 'num', 'int', 'integer', 'long', 'float', 'double', 'decimal', 'bool', 'boolean', 'date', 'datetime', 'timestamp', 'time', 'objectid', 'uuid', 'binary', 'bytes', 'object', 'array', 'map', 'json', 'any', 'null', 'mixed']);
const FIELD_KEYS = new Set(['type', 'description', 'required', 'enum', 'format', 'fields', 'properties', 'items', 'default', 'notes']);
const STRUCT = new Set(['fields', 'columns', 'properties', 'indexes', 'title', 'description', 'type', 'required', '$schema', '$id', 'definitions', '$defs', 'items', 'additionalProperties', 'allOf', 'oneOf', 'anyOf', 'enum', 'const', 'format']);

/** "string", "ObjectId[]" -> a type; "pending | done | failed" -> an enum; anything else is a description (its type is not given). */
function fromString(s: string, warn: Warn, name: string): S {
  const t = s.trim();
  if (!t) { warn(`field '${name}' is empty`); return {}; }
  const m = /^([A-Za-z][\w.]*)(\[\])?$/.exec(t);
  if (m && TYPES.has(m[1].toLowerCase())) return m[2] ? { type: 'array', items: { type: m[1] } } : { type: m[1] };
  const parts = t.split('|').map((x) => x.trim());
  if (parts.length > 1 && parts.every((p) => /^[\w.-]+$/.test(p))) return parts.every((p) => TYPES.has(p.toLowerCase())) ? { type: parts.join(' | ') } : { type: 'string', enum: parts };
  return { description: t };
}

function fieldSchema(v: unknown, warn: Warn, name: string): S {
  if (typeof v === 'string') return fromString(v, warn, name);
  if (Array.isArray(v)) return { type: 'array', items: v.length === 1 ? fieldSchema(v[0], warn, `${name}[]`) : (warn(`field '${name}': a list should hold one item type`), {}) };
  if (!isObj(v)) { warn(`field '${name}' is ${v === null ? 'null' : `a ${typeof v}`}: write its type or description as text`); return {}; }
  const own = Object.keys(v);
  if (own.length && !own.some((k) => FIELD_KEYS.has(k))) return fieldsOf(v, warn, `${name}.`); // a plain object is a group of nested fields
  const out: S = {};
  if (typeof v.type === 'string') out.type = v.type;
  else if (v.type !== undefined) warn(`field '${name}': type must be text`);
  if (typeof v.description === 'string') out.description = v.description;
  if (typeof v.format === 'string') out.format = v.format;
  if (Array.isArray(v.enum)) out.enum = v.enum;
  const nested = v.fields ?? v.properties;
  if (isObj(nested)) Object.assign(out, fieldsOf(nested, warn, `${name}.`), { type: out.type ?? 'object' });
  else if (nested !== undefined) warn(`field '${name}': fields must be an object`);
  if (v.items !== undefined) out.items = fieldSchema(v.items, warn, `${name}[]`);
  if (v.default !== undefined) out.description = [out.description, `Default ${JSON.stringify(v.default)}`].filter(Boolean).join('. ');
  if (typeof v.notes === 'string') out.description = [out.description, v.notes].filter(Boolean).join('. ');
  return out;
}

/** A group of fields -> an object schema; a field written `{ required: true }` goes to its parent's `required` list. */
function fieldsOf(f: S, warn: Warn, prefix = ''): S {
  const properties: S = {}, required: string[] = [];
  for (const [k, v] of Object.entries(f)) {
    if (!k.trim()) { warn('a field has an empty name'); continue; }
    properties[k] = fieldSchema(v, warn, `${prefix}${k}`);
    if (isObj(v) && v.required === true) required.push(k);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

const keysText = (k: unknown): string => (typeof k === 'string' ? k : Array.isArray(k) ? k.map((x) => (isObj(x) ? keysText(x) : String(x))).join(', ')
  : isObj(k) ? Object.entries(k).map(([f, d]) => (d === 1 || d === 'asc' ? f : d === -1 || d === 'desc' ? `${f} desc` : `${f} ${d}`)).join(', ') : '');
function indexesOf(v: unknown, warn: Warn): DdlIndex[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) && !isObj(v)) { warn('`indexes` must be a list (or an object of name -> fields).'); return []; }
  const list: [string, unknown][] = Array.isArray(v) ? v.map((x) => [isObj(x) && typeof x.name === 'string' ? x.name : '', x]) : Object.entries(v);
  return list.flatMap(([name, x]) => {
    if (typeof x === 'string' || Array.isArray(x)) return [{ name, keys: keysText(x), unique: false, notes: '' }];
    if (!isObj(x)) { warn(`an index is text, a list of fields or an object, not ${typeof x}`); return []; }
    const keys = keysText(x.keys ?? x.fields ?? x.key ?? x.columns);
    if (!keys) { warn(`index '${name || '?'}' names no fields`); return []; }
    const rest = Object.entries(x).filter(([k]) => !['name', 'keys', 'fields', 'key', 'columns', 'unique'].includes(k)).map(([k, d]) => (d === true ? k : `${k}: ${typeof d === 'string' ? d : JSON.stringify(d)}`));
    return [{ name: name || (typeof x.name === 'string' ? x.name : ''), keys, unique: x.unique === true, notes: rest.join(', ') }];
  });
}

/** schema content -> { kind, schema, indexes, extra, warnings }. */
export function ddlOf(content: unknown): Ddl {
  const warnings: string[] = [], warn: Warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };
  if (!isObj(content)) return { kind: 'unknown', schema: null, indexes: [], extra: [], warnings: [`The schema is ${Array.isArray(content) ? 'a list' : content === null ? 'null' : `a ${typeof content}`}, not an object: it is neither JSON Schema nor the manual {fields, indexes} shape.`] };
  const indexes = indexesOf(content.indexes, warn), extra = Object.entries(content).filter(([k]) => !STRUCT.has(k));
  if (isJsonSchema(content)) return { kind: 'json-schema', schema: content, indexes, extra, warnings };
  if (content.fields === undefined && content.columns === undefined) {
    warn('Not DDL: it has neither `properties` (JSON Schema) nor `fields` (the manual shape).');
    return { kind: 'unknown', schema: null, indexes, extra: Object.entries(content).filter(([k]) => k !== 'indexes'), warnings };
  }
  const fields = content.fields ?? content.columns;
  if (!isObj(fields)) { warn('`fields` must be an object of field name -> type or description.'); return { kind: 'unknown', schema: null, indexes, extra, warnings }; }
  const schema = fieldsOf(fields, warn);
  for (const k of ['title', 'description']) if (typeof content[k] === 'string') schema[k] = content[k];
  return { kind: 'manual', schema, indexes, extra, warnings };
}

/** The `schema-not-ddl` warnings of a schema, for the server's answers. */
export const schemaWarnings = (content: unknown): string[] => ddlOf(content).warnings;
