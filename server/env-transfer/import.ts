// POST /api/envs/import?as=<name>&owner=<user>&dryRun=1: create a design environment from an export bundle (export.ts), all or nothing.
// Autoincrement ids are re-keyed (old -> new maps per table) and the columns that point at them follow; user ids are mapped by name.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { HttpError, badRequest, conflict } from '../errors.ts';
import { actorId, authOff, currentWho } from '../auth/context.ts';
import { ensureUser, findUser } from '../store/users.ts';
import { newEnvSlot } from '../store/env-color.ts';
import { FORMAT, q, schemaVersion } from './export.ts';
import { SPECS } from './spec.ts';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
class Rollback extends Error {}

const columnsOf = (db: DB, table: string) => (db.prepare(`PRAGMA table_info(${q(table)})`).all() as { name: string }[]).map((c) => c.name);

function resolveOwner(db: DB, owner: string | null): string | null {
  const who = currentWho();
  if (!owner) return authOff() ? null : actorId();
  if (!authOff() && !who?.admin) throw new HttpError(403, 'FORBIDDEN', 'only an admin can import on behalf of another owner');
  const u = findUser(db, owner) ?? (() => { const r = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND merged_into IS NULL').get(owner) as { id: string } | undefined; return r ? findUser(db, r.id) : undefined; })();
  if (!u) throw badRequest(`unknown owner '${owner}' (a user id or email)`);
  return u.id;
}

export function importEnv(db: DB, bundle: any, opts: { as?: string | null; owner?: string | null; dryRun?: boolean }) {
  if (!bundle || bundle.format !== FORMAT || bundle.formatVersion !== 1 || !bundle.env || !bundle.tables) throw new HttpError(400, 'BAD_FORMAT', `not a ${FORMAT} bundle of formatVersion 1`);
  if (!Number.isInteger(bundle.schemaVersion) || bundle.schemaVersion > schemaVersion(db)) throw conflict('SCHEMA_NEWER', `the bundle has schema ${bundle.schemaVersion}, this server only ${schemaVersion(db)}: upgrade the server first`);
  const name = String(opts.as || bundle.env.name || '');
  if (!NAME.test(name)) throw badRequest(`environment name '${name}' is not valid (letters, digits, . _ -)`);
  if (bundle.env.kind !== 'design') throw badRequest('only design environments can be imported');
  if (db.prepare('SELECT 1 FROM envs WHERE name = ? UNION SELECT 1 FROM snapshots WHERE env = ?').get(name, name)) throw conflict('ENV_EXISTS', `environment '${name}' already exists: pass ?as=<another name>`);
  const owner = resolveOwner(db, opts.owner ?? null);
  const warnings: string[] = [], counts: Record<string, number> = {};
  const warn = (w: string) => { if (!warnings.includes(w)) warnings.push(w); };
  const created = new Set<string>();
  /** The user of the same name here; one is made when there is none (as every comment author already is), so colours and mentions keep working. */
  const userMap = (id: unknown): string | null => {
    const n = bundle.users?.[id as string];
    if (typeof n !== 'string') return null;
    const before = db.prepare('SELECT count(*) AS n FROM users').get() as { n: number };
    const u = ensureUser(db, { name: n });
    if ((db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n > before.n) created.add(n);
    return u?.id ?? null;
  };

  const run = () => tx(db, () => {
    const meta = bundle.env as Record<string, unknown>;
    const have = new Set(columnsOf(db, 'envs'));
    const row: Record<string, unknown> = { ...meta, name, owner_user_id: owner, visibility: authOff() ? 'published' : 'private', color: newEnvSlot(db) };
    insert(db, 'envs', row, have, warn);
    const maps = new Map<string, Map<unknown, number>>();
    const unmappedUsers = new Set<string>();
    for (const s of SPECS) {
      const rows: Record<string, unknown>[] = bundle.tables[s.table] ?? [];
      const cols = new Set(columnsOf(db, s.table));
      const map = new Map<unknown, number>(); maps.set(s.table, map);
      const later: { id: number; col: string; old: unknown }[] = [];
      let n = 0;
      for (const r0 of rows) {
        const r = { ...r0 };
        if (!s.parent) r.env = name;
        if (s.parent) {
          const np = maps.get(s.parent.table)!.get(r[s.parent.col]);
          if (np === undefined) continue; // orphan child: its parent is not in the bundle
          r[s.parent.col] = np;
        }
        for (const c of s.nulls ?? []) r[c] = null;
        for (const c of s.owner ?? []) r[c] = owner;
        for (const c of s.users ?? []) if (r[c] != null) { const m = userMap(r[c]); if (m === null) unmappedUsers.add(String(bundle.users?.[r[c] as string] ?? r[c])); r[c] = m; }
        if (s.table === 'comment_mentions' && r.user_id == null) continue; // a mention of someone unknown here has nobody to point at
        const old = r.id;
        const selfLater: [string, unknown][] = [];
        for (const [c, t] of Object.entries(s.refs ?? {})) {
          if (r[c] == null) continue;
          if (t === s.table) { selfLater.push([c, r[c]]); r[c] = null; } else r[c] = maps.get(t)!.get(r[c]) ?? null;
        }
        if (s.auto) delete r.id;
        const id = insert(db, s.table, r, cols, warn);
        if (s.auto) map.set(old, id);
        for (const [col, o] of selfLater) later.push({ id, col, old: o });
        n++;
      }
      for (const f of later) { const to = map.get(f.old); if (to !== undefined) db.prepare(`UPDATE ${q(s.table)} SET ${q(f.col)} = ? WHERE id = ?`).run(to, f.id); }
      counts[s.table] = n;
    }
    for (const t of Object.keys(bundle.tables)) if (!SPECS.some((s) => s.table === t)) warn(`table '${t}' is not known here: ignored`);
    if (created.size) warn(`users created here from names in the bundle: ${[...created].join(', ')}`);
    if (unmappedUsers.size) warn(`user ids without a name in the bundle, left unlinked: ${[...unmappedUsers].join(', ')}`);
    const src = meta.source;
    if (typeof src === 'string' && src && !db.prepare('SELECT 1 FROM envs WHERE name = ?').get(src)) warn(`source ${src} not here: imported standalone (the baseline is carried; compare against the source is unavailable)`);
    if (opts.dryRun) throw new Rollback();
  });
  try { run(); } catch (e) { if (!(e instanceof Rollback)) throw e; }
  return { env: name, counts, warnings };
}

/** INSERT by column name: columns the target does not have are dropped (warned), missing ones take their default. Returns the new rowid. */
function insert(db: DB, table: string, row: Record<string, unknown>, have: Set<string>, warn: (w: string) => void): number {
  const keys = Object.keys(row).filter((k) => { if (have.has(k)) return true; warn(`${table}.${k}: no such column here, dropped`); return false; });
  try {
    return Number(db.prepare(`INSERT INTO ${q(table)} (${keys.map(q).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k] as any)).lastInsertRowid);
  } catch (e: any) {
    throw new HttpError(422, 'INVALID', `${table}: ${e.message}`);
  }
}
