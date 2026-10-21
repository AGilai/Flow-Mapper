// In-process pub/sub for the push event stream (GET /api/events). One bus per database (busFor(db)), so the
// store layer can emit without plumbing. Events get a monotonically increasing id from the `events` table
// (persisted: replay survives a restart; pruned on insert) and sit in a bounded ring for fast replay.
// Emitting never throws into the write that caused it: the write has already committed.

import type { DB } from '../db/connection.ts';

export interface PushEvent {
  id: number; type: string; at: string; env?: string; bugId?: number; reporter?: string; summary: string; data: Record<string, unknown>;
}
export type Draft = Omit<PushEvent, 'id' | 'at'>;
export interface EventFilter { types?: RegExp[]; reporters?: string[]; envs?: string[] }

export const RING_SIZE = 1000;
export const KEEP_ROWS = 5000;
export const KEEP_MS = 7 * 24 * 3600 * 1000;

const globRe = (g: string) => new RegExp('^' + g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');

/** `types=bug.*,version.deployed&reporter=a,b&env=prod`. A reporter/env filter only drops events that carry a different value; events without one (version.deployed) pass. */
export function parseFilter(q: URLSearchParams): EventFilter {
  const csv = (k: string) => (q.get(k) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const types = csv('types'), reporters = csv('reporter'), envs = csv('env');
  return { types: types.length ? types.map(globRe) : undefined, reporters: reporters.length ? reporters : undefined, envs: envs.length ? envs : undefined };
}

export function matches(e: PushEvent, f: EventFilter): boolean {
  if (f.types && !f.types.some((r) => r.test(e.type))) return false;
  if (f.reporters && e.reporter !== undefined && !f.reporters.includes(e.reporter)) return false;
  if (f.envs && e.env !== undefined && !f.envs.includes(e.env)) return false;
  return true;
}

const fromRow = (r: any): PushEvent => {
  const e: PushEvent = { id: r.id, type: r.type, at: r.at, summary: r.summary, data: JSON.parse(r.data) };
  if (r.env !== null) e.env = r.env;
  if (r.bug_id !== null) e.bugId = r.bug_id;
  if (r.reporter !== null) e.reporter = r.reporter;
  return e;
};

export class Bus {
  private subs = new Set<(e: PushEvent) => void>();
  private ring: PushEvent[];
  private db: DB;
  constructor(db: DB) {
    this.db = db;
    this.ring = (db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(RING_SIZE) as any[]).reverse().map(fromRow);
  }

  emit(d: Draft): PushEvent | null {
    try {
      const at = new Date().toISOString();
      const r = this.db.prepare('INSERT INTO events (type, at, env, bug_id, reporter, summary, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(d.type, at, d.env ?? null, d.bugId ?? null, d.reporter ?? null, d.summary, JSON.stringify(d.data ?? {}));
      const id = Number(r.lastInsertRowid);
      const e: PushEvent = { id, type: d.type, at, ...(d.env !== undefined && { env: d.env }), ...(d.bugId !== undefined && { bugId: d.bugId }),
        ...(d.reporter !== undefined && { reporter: d.reporter }), summary: d.summary, data: d.data ?? {} };
      this.ring.push(e);
      if (this.ring.length > RING_SIZE) this.ring.shift();
      this.prune(id, at);
      for (const fn of [...this.subs]) { try { fn(e); } catch (err) { console.error('event subscriber failed', err); } }
      return e;
    } catch (err) {
      console.error('flow-mapper: could not record event', d.type, err);
      return null;
    }
  }

  private prune(id: number, at: string) {
    this.db.prepare('DELETE FROM events WHERE id <= ? OR at < ?').run(id - KEEP_ROWS, new Date(Date.parse(at) - KEEP_MS).toISOString());
  }

  subscribe(fn: (e: PushEvent) => void): () => void { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  get clients() { return this.subs.size; }

  /** Events after `id` (oldest first) that pass the filter. From the ring when it reaches back far enough, else from the table. */
  since(id: number, f: EventFilter = {}, limit = KEEP_ROWS): PushEvent[] {
    const covered = this.ring.length > 0 && this.ring[0].id <= id + 1;
    const all = covered || !this.ring.length ? this.ring.filter((e) => e.id > id)
      : (this.db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?').all(id, KEEP_ROWS) as any[]).map(fromRow);
    return all.filter((e) => matches(e, f)).slice(0, limit);
  }

  /** The newest `n` events that pass the filter, oldest first. */
  latest(n: number, f: EventFilter = {}): PushEvent[] {
    return this.ring.filter((e) => matches(e, f)).slice(-n);
  }

  lastId(): number { return this.ring.length ? this.ring[this.ring.length - 1].id : 0; }

  /** State kept across restarts (e.g. the last deployed version). */
  getState(key: string): string | null { return (this.db.prepare('SELECT value FROM event_state WHERE key = ?').get(key) as any)?.value ?? null; }
  setState(key: string, value: string) { this.db.prepare('INSERT INTO event_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value); }
}

const buses = new WeakMap<DB, Bus>();
export function busFor(db: DB): Bus {
  let b = buses.get(db);
  if (!b) buses.set(db, (b = new Bus(db)));
  return b;
}
/** Emit on the bus of `db`. Call after the write's transaction has committed. */
export const emit = (db: DB, d: Draft) => busFor(db).emit(d);

/** Once at startup: record `version.deployed` when the version differs from the last recorded one. */
export function announceVersion(db: DB, version: string) {
  const bus = busFor(db), prev = bus.getState('app_version');
  if (prev === version) return;
  bus.setState('app_version', version);
  bus.emit({ type: 'version.deployed', summary: `Flow-Mapper ${version} deployed${prev ? ` (was ${prev})` : ''}`, data: { version, previous: prev } });
}
