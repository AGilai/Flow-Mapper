// CR #136, the store panel's collection / key cards, pure (design/mockups/frames/frame-30.html): the numbers on a collapsed card, the order of its
// operations, the field tree of its schema and the facts of a Redis key. Drawn by web/js/views/store-cards.js; shared with the browser, so no `node:` imports.

import type { Card, OpRow } from './store-panel.ts';
import { ttlLine } from './store-panel.ts';
import { ddlOf } from './schema-ddl.ts';

const isWrite = (o: Pick<OpRow, 'access'>) => o.access === 'write' || o.access === 'delete' || o.access === 'rw';

/** Which marks of a card are lit: R when it reads, W when it writes or deletes (`rw` lights both; an unreported access lights none). */
export function rwOf(card: Pick<Card, 'ops'>): { r: boolean; w: boolean } {
  const a = card.ops.map((o) => o.access);
  return { r: a.some((x) => x === 'read' || x === 'rw'), w: a.some((x) => x === 'write' || x === 'delete' || x === 'rw') };
}

/** The operations of a card, writes (and deletes) first, then by first step. A copy; the model is not changed. */
export const sortOps = (ops: OpRow[]): OpRow[] => [...ops].sort((a, b) => (isWrite(a) === isWrite(b) ? (a.steps[0] ?? 0) - (b.steps[0] ?? 0) : isWrite(a) ? -1 : 1));

/** "N calls" and "N steps" of a card. */
export const cardCounts = (card: Pick<Card, 'ops' | 'steps'>) => ({ calls: card.ops.length, steps: card.steps.length });
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface TreeNode { name: string; path: string; type: string; kind: '' | 'obj' | 'arr' | 'ref'; note: string; required: boolean; used: boolean; children: TreeNode[] }
type S = Record<string, any>;
const PLAIN = new Set(['ObjectId', 'Date', 'UUID', 'Decimal128', 'Buffer', 'Mixed', 'Map', 'String', 'Number', 'Boolean']);
const typeName = (s: S): string => (Array.isArray(s.type) ? s.type.join(' | ') : typeof s.type === 'string' ? s.type : s.properties ? 'object' : s.items ? 'array' : s.$ref ? String(s.$ref).split('/').pop()! : 'any');
const noteOf = (s: S): string => [Array.isArray(s.enum) ? s.enum.join(' | ') : '', s.format ?? '', s.description ?? ''].filter(Boolean).join(' · ');

function build(props: S, required: unknown, touched: Set<string>, prefix: string): TreeNode[] {
  const req = new Set(Array.isArray(required) ? required : []);
  return Object.entries(props).map(([name, raw]) => {
    const s: S = raw && typeof raw === 'object' ? raw : {}, path = prefix + name;
    const isArr = typeName(s) === 'array', el: S = isArr && s.items && typeof s.items === 'object' ? s.items : {};
    const body: S = isArr ? el : s, type = isArr ? `${typeName(el)}[]` : typeName(s);
    const children = body.properties && typeof body.properties === 'object' ? build(body.properties, body.required, touched, `${path}.`) : [];
    const base = (isArr ? typeName(el) : type);
    const kind = isArr ? 'arr' : children.length || type === 'object' ? 'obj' : /^[A-Z]/.test(base) && !PLAIN.has(base) ? 'ref' : '';
    const used = touched.has(path) || [...touched].some((t) => t.startsWith(`${path}.`) || path.startsWith(`${t}.`));
    return { name, path, type, kind, note: noteOf(s) || noteOf(el), required: req.has(name), used, children };
  });
}

/** The field tree of a schema (JSON Schema or the manual {fields} shape, both read by ddlOf), `touched`: the field paths the flow reads or writes. Empty when it has no fields. */
export function schemaTree(content: unknown, touched: string[] = []): TreeNode[] {
  const d = ddlOf(content);
  return d.schema?.properties ? build(d.schema.properties, d.schema.required, new Set(touched.map((p) => p.replace(/\[\]/g, ''))), '') : [];
}
export const countFields = (t: TreeNode[]): number => t.reduce((n, x) => n + 1 + countFields(x.children), 0);
/** The paths a card's operations use (filter, projection, update, sort). */
export const touchedPaths = (card: Pick<Card, 'ops'>): string[] => [...new Set(card.ops.flatMap((o) => o.fields.flatMap((g) => g.items.map((i) => i.path))))];

/** A key template cut into text and `{placeholder}` parts, so the UI can colour the placeholders. */
export const templateParts = (t: string): { text: string; ph: boolean }[] => t.split(/(\{[^}]*\})/).filter(Boolean).map((text) => ({ text, ph: /^\{[^}]*\}$/.test(text) }));

const TYPE_OF: [RegExp, string][] = [[/^h[a-z]*$/, 'hash'], [/^(l(push|pop|range|len|rem|trim|index)|rpush|rpop|brpop|blpop)$/, 'list'], [/^(s(add|rem|members|ismember|card)|spop)$/, 'set'], [/^z/, 'sorted set'], [/^x/, 'stream'], [/^(incr|incrby|decr|decrby)$/, 'string (counter)'], [/^(get|set|setex|setnx|getset|getdel|mget|mset|append|psetex)$/, 'string']];
/** The Redis type the operations imply (hget -> hash, lpush -> list ...); null when none says. */
export function inferType(ops: Pick<OpRow, 'op'>[]): string | null {
  for (const o of ops) { const n = o.op.toLowerCase().split(/\s/)[0]; for (const [re, t] of TYPE_OF) if (re.test(n)) return t; }
  return null;
}
const SETS_TTL = /^(setex|psetex|expire|pexpire|expireat|set|getex)$/i;
/** What the Key tab shows: the template's parts, type (inferred), TTL and the code that sets it, db, other spellings. */
export function keyFacts(card: Card) {
  const setter = card.ops.find((o) => SETS_TTL.test(o.op.split(/\s/)[0]) && o.links.length)?.links[0] ?? null;
  return { parts: card.template ? templateParts(card.template) : [], type: inferType(card.ops), ttl: card.ttl.values.length ? ttlLine(card.ttl) : null, setBy: setter ? setter.key : null, dbs: card.dbs, variants: card.variants };
}
