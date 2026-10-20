// Key templates of one Redis instance (#29): the contract for what a harvester sends, and the pure
// grouping the instance page and MCP read. One entry says "service S uses key template K in db D with
// these commands". An owner is a service that writes the template; a template with several writers is
// Shared, one nobody harvested writes is Unwritten. Pure: the server stores entries, this reads them.

export type KeyAccess = 'read' | 'write' | 'read_write';
export interface KeyEntry { keyTemplate: string; dbIndex: number; commands: string[]; service: string; access: KeyAccess; opsPerHour?: number; ttlSeconds?: number }
export interface KeyError { index: number; field: string; message: string }

export const MAX_KEYS = 50000;
const ACCESS: readonly string[] = ['read', 'write', 'read_write'];
const WRITE = /^(set|setex|setnx|psetex|setrange|mset|msetnx|getset|getdel|getex|append|incr|incrby|incrbyfloat|decr|decrby|del|unlink|expire|expireat|pexpire|pexpireat|persist|rename|renamenx|copy|restore|move|hset|hsetnx|hmset|hdel|hincrby|hincrbyfloat|lpush|rpush|lpushx|rpushx|lpop|rpop|lmove|blpop|brpop|lrem|ltrim|lset|linsert|sadd|srem|spop|smove|zadd|zrem|zincrby|zpopmin|zpopmax|zremrangebyscore|zremrangebyrank|xadd|xdel|xtrim|xack|pfadd|setbit|bitop|json\.set|json\.del)$/i;

/** True when the Redis command changes the key. */
export const isWriteCommand = (c: string) => WRITE.test(c.trim());

/** Access from the commands, for entries that do not say: any write command means a writer. */
export function accessFromCommands(commands: string[]): KeyAccess {
  const w = commands.some(isWriteCommand), r = commands.some((c) => !isWriteCommand(c));
  return w ? (r ? 'read_write' : 'write') : 'read';
}

const pick = (o: any, ...names: string[]) => names.map((n) => o?.[n]).find((v) => v !== undefined);

/** Normalise raw entries (the PUT body, or the interim inline `details.keys`). `defaultService` fills `service` when absent.
 *  Accepted aliases: key_template, db_index, command_kinds, op_count, ttl; `services: [...]` expands to one entry per service. */
export function normaliseKeys(raw: unknown, defaultService?: string): { entries: KeyEntry[]; errors: KeyError[] } {
  const errors: KeyError[] = [], entries: KeyEntry[] = [], seen = new Set<string>();
  if (!Array.isArray(raw)) return { entries, errors: [{ index: -1, field: 'keys', message: 'keys must be an array' }] };
  if (raw.length > MAX_KEYS) return { entries, errors: [{ index: -1, field: 'keys', message: `at most ${MAX_KEYS} entries per instance` }] };
  raw.forEach((x, index) => {
    const bad = (field: string, message: string) => errors.push({ index, field, message });
    const o = typeof x === 'string' ? { keyTemplate: x } : x;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return bad('', 'entry must be an object');
    const keyTemplate = pick(o, 'keyTemplate', 'key_template');
    if (typeof keyTemplate !== 'string' || !keyTemplate.trim() || keyTemplate.length > 512) return bad('keyTemplate', 'a non-empty string of at most 512 characters is required');
    const dbIndex = pick(o, 'dbIndex', 'db_index') ?? 0;
    if (!Number.isInteger(dbIndex) || dbIndex < 0 || dbIndex > 1023) return bad('dbIndex', 'must be an integer from 0 to 1023');
    const cmdRaw = pick(o, 'commands', 'command_kinds') ?? [];
    if (!Array.isArray(cmdRaw) || cmdRaw.some((c: unknown) => typeof c !== 'string' || !c.trim())) return bad('commands', 'must be an array of command names');
    const commands = [...new Set<string>(cmdRaw.map((c: string) => c.trim().toUpperCase()))];
    const services: unknown[] = Array.isArray(o.services) ? o.services : [o.service ?? defaultService];
    if (!services.length || services.some((s) => typeof s !== 'string' || !s.trim())) return bad('service', 'a service name is required');
    const access = o.access ?? accessFromCommands(commands);
    if (!ACCESS.includes(access)) return bad('access', `must be one of ${ACCESS.join(', ')}`);
    const ops = pick(o, 'opsPerHour', 'op_count');
    if (ops != null && !(typeof ops === 'number' && Number.isFinite(ops) && ops >= 0)) return bad('opsPerHour', 'must be a number >= 0');
    const ttl = pick(o, 'ttlSeconds', 'ttl');
    if (ttl != null && !(Number.isInteger(ttl) && ttl >= 0)) return bad('ttlSeconds', 'must be an integer >= 0 (seconds), or left out when there is no TTL or it is unknown');
    for (const service of services as string[]) {
      const id = `${service.trim()}\u0000${dbIndex}\u0000${keyTemplate.trim()}`;
      if (seen.has(id)) { bad('keyTemplate', `duplicate entry for service '${service}', db${dbIndex}, '${keyTemplate}'`); continue; }
      seen.add(id);
      entries.push({ keyTemplate: keyTemplate.trim(), dbIndex, commands, service: service.trim(), access, ...(ops != null ? { opsPerHour: ops } : {}), ...(ttl != null ? { ttlSeconds: ttl } : {}) });
    }
  });
  return { entries, errors };
}

export interface KeyUse { service: string; access: KeyAccess; commands: string[]; opsPerHour: number | null; ttlSeconds: number | null }
export interface KeyProblem { kind: 'no-writer' | 'ttl-disagree'; why: string; follows: string }
/** An entry point whose flow runs a step that touches the key (`details.keyTemplate`), with the function chain to it. */
export interface KeyFlow { access: KeyAccess | 'unknown'; service: string; ingress: string; bindKey: string; transport: string; entryPoint: boolean; chain: string[]; operation: string; step: { service: string; fn: string; seq: number }; ttlSeconds?: number }
export interface KeyRow {
  keyTemplate: string; dbIndex: number; commands: string[]; writeCommands: string[]; opsPerHour: number | null;
  ttl: { seconds: number | null; values: { service: string; ttlSeconds: number }[]; disagree: boolean };
  writers: KeyUse[]; readers: KeyUse[]; problem: KeyProblem | null; flows: KeyFlow[];
}
export interface KeyGroup { kind: 'unwritten' | 'shared' | 'owner'; owner?: string; label: string; opsPerHour: number | null; templates: number; rows: KeyRow[] }
export interface KeyFilter { db?: number; q?: string; problems?: boolean; service?: string }
export interface DbCount { db: number; templates: number; problems: number }
export interface ProblemRef { kind: KeyProblem['kind']; keyTemplate: string; dbIndex: number; services: string[]; ttls: { service: string; ttlSeconds: number }[] }
export interface KeySummary { templates: number; services: number; writers: number; shared: number; unwritten: number; ttlDisagreements: number; dbs: DbCount[]; problems: ProblemRef[]; problemCount: number }

const sum = (xs: (number | null | undefined)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);
export const isWriter = (e: { access: KeyAccess }) => e.access === 'write' || e.access === 'read_write';
const use = (e: KeyEntry): KeyUse => ({ service: e.service, access: e.access, commands: e.commands, opsPerHour: e.opsPerHour ?? null, ttlSeconds: e.ttlSeconds ?? null });
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
const ops = (n: number | null) => (n == null ? '' : ` ${n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : n} times an hour`);

/** One row per (template, db): who writes, who only reads, the TTL and what is wrong. Flows are attached separately. */
export function keyRows(entries: KeyEntry[]): KeyRow[] {
  const by = new Map<string, KeyEntry[]>();
  for (const e of entries) { const k = `${e.dbIndex}\u0000${e.keyTemplate}`; (by.get(k) ?? by.set(k, []).get(k)!).push(e); }
  const rows: KeyRow[] = [];
  for (const es of by.values()) {
    const writers = es.filter(isWriter).map(use).sort((a, b) => a.service.localeCompare(b.service));
    const readers = es.filter((e) => !isWriter(e)).map(use).sort((a, b) => a.service.localeCompare(b.service));
    const values = writers.filter((w) => w.ttlSeconds != null).map((w) => ({ service: w.service, ttlSeconds: w.ttlSeconds! }));
    const distinct = [...new Set(values.map((v) => v.ttlSeconds))];
    const disagree = distinct.length > 1;
    const commands = [...new Set(es.flatMap((e) => e.commands))];
    const { keyTemplate, dbIndex } = es[0];
    const readerNames = list(readers.map((r) => r.service));
    let problem: KeyProblem | null = null;
    if (!writers.length) {
      problem = {
        kind: 'no-writer',
        why: `${readerNames} ${readers.length > 1 ? 'read' : 'reads'} ${keyTemplate}${readers.length === 1 ? ops(readers[0].opsPerHour) : ''}. No harvested service writes it, so its TTL and write flows are unknown. The writer may be a script (Lua, redis-cli job) or a service nobody has harvested.`,
        follows: "Changes to this key's format can only be checked against its readers. Harvest the writing service to see its flows.",
      };
    } else if (disagree) {
      problem = {
        kind: 'ttl-disagree', why: `${writers.length} writers disagree on the TTL of ${keyTemplate}.`,
        follows: 'If both are right, whoever writes last sets the lifetime: a key touched by the writer with the shorter TTL expires early until the other writes it again.',
      };
    }
    rows.push({
      keyTemplate, dbIndex, commands, writeCommands: commands.filter(isWriteCommand), opsPerHour: sum(es.map((e) => e.opsPerHour)),
      ttl: { seconds: distinct.length === 1 ? distinct[0] : null, values, disagree }, writers, readers, problem, flows: [],
    });
  }
  return rows.sort((a, b) => a.keyTemplate.localeCompare(b.keyTemplate) || a.dbIndex - b.dbIndex);
}

export function keySummary(entries: KeyEntry[], rows = keyRows(entries)): KeySummary {
  const dbs = new Map<number, DbCount>();
  for (const r of rows) {
    const d = dbs.get(r.dbIndex) ?? dbs.set(r.dbIndex, { db: r.dbIndex, templates: 0, problems: 0 }).get(r.dbIndex)!;
    d.templates++;
    if (r.problem) d.problems++;
  }
  const bad = rows.filter((r) => r.problem);
  return {
    templates: rows.length, services: new Set(entries.map((e) => e.service)).size, writers: new Set(entries.filter(isWriter).map((e) => e.service)).size,
    shared: rows.filter((r) => r.writers.length > 1).length, unwritten: rows.filter((r) => !r.writers.length).length,
    ttlDisagreements: rows.filter((r) => r.ttl.disagree).length,
    dbs: [...dbs.values()].sort((a, b) => a.db - b.db), problemCount: bad.length,
    problems: bad.slice(0, 50).map((r) => ({ kind: r.problem!.kind, keyTemplate: r.keyTemplate, dbIndex: r.dbIndex, services: [...r.writers, ...r.readers].map((u) => u.service), ttls: r.ttl.values })),
  };
}

export function filterRows(rows: KeyRow[], f: KeyFilter = {}): KeyRow[] {
  const q = f.q?.trim().toLowerCase();
  return rows.filter((r) => (f.db == null || r.dbIndex === f.db) && (!f.problems || r.problem) && (!q || r.keyTemplate.toLowerCase().includes(q)) && (!f.service || r.writers.some((u) => u.service === f.service) || r.readers.some((u) => u.service === f.service)));
}

/** Groups: "No harvested writer" and "Shared" first, then one group per owner (the single writer), by name. A shared row is listed once. */
export function groupRows(rows: KeyRow[]): KeyGroup[] {
  const mk = (kind: KeyGroup['kind'], label: string, rs: KeyRow[], owner?: string): KeyGroup => ({ kind, owner, label, opsPerHour: sum(rs.map((r) => r.opsPerHour)), templates: rs.length, rows: rs });
  const out: KeyGroup[] = [];
  const none = rows.filter((r) => !r.writers.length), many = rows.filter((r) => r.writers.length > 1);
  if (none.length) out.push(mk('unwritten', 'No harvested writer', none));
  if (many.length) {
    const n = new Set(many.flatMap((r) => r.writers.map((w) => w.service))).size;
    out.push(mk('shared', `Shared: written by ${n} services`, many));
  }
  const owners = new Map<string, KeyRow[]>();
  for (const r of rows) if (r.writers.length === 1) (owners.get(r.writers[0].service) ?? owners.set(r.writers[0].service, []).get(r.writers[0].service)!).push(r);
  for (const [o, rs] of [...owners].sort((a, b) => a[0].localeCompare(b[0]))) out.push(mk('owner', o, rs, o));
  return out;
}

/** One service's keys: the templates it writes, the ones it only reads (each names its owner in `writers`), and the rows with a problem among both. */
export function serviceKeys(rows: KeyRow[], service: string): { writes: KeyRow[]; reads: KeyRow[]; problems: KeyRow[] } {
  const writes = rows.filter((r) => r.writers.some((u) => u.service === service));
  const reads = rows.filter((r) => !r.writers.some((u) => u.service === service) && r.readers.some((u) => u.service === service));
  return { writes, reads, problems: [...writes, ...reads].filter((r) => r.problem) };
}

/** Whose card a problem opens: the first writer of a shared key (TTL disagreement), the first reader of a key nobody writes. */
export const problemService = (r: KeyRow): string | null => !r.problem ? null : (r.problem.kind === 'no-writer' ? r.readers[0]?.service : r.writers[0]?.service) ?? null;
