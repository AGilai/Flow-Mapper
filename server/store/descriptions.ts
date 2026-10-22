// Flow descriptions: two records per key (human | ai). Humans write theirs through REST, AI tools theirs through the
// MCP tool set_description; neither ever overwrites the other. See core/description.ts and docs/API.md.

import type { DB } from '../db/connection.ts';
import type { GraphIndex } from '../../core/graph-index.ts';
import { badRequest, notFound, HttpError } from '../errors.ts';
import { trace } from '../../core/trace.ts';
import { flowDescriptions, MAX_TITLE, traceHash, HASH_TRACE, calleeService, isStepKey, hasStep, type DescRow, type FlowDescriptions } from '../../core/description.ts';

const MAX_TEXT = 4000;
interface Row { callee: string; source: 'human' | 'ai'; text: string; title: string | null; author: string | null; model: string | null; trace_hash: string | null; updated_at: string }
const toRow = (r: Row): DescRow => ({ callee: r.callee, source: r.source, text: r.text, author: r.author, model: r.model, traceHash: r.trace_hash, updatedAt: r.updated_at, title: r.title });

export function rowsFor(db: DB, env: string, service: string, ingress: string): DescRow[] {
  return (db.prepare('SELECT callee, source, text, title, author, model, trace_hash, updated_at FROM descriptions WHERE env = ? AND service = ? AND ingress = ? ORDER BY callee, source')
    .all(env, service, ingress) as unknown as Row[]).map(toRow);
}

/** Every row of an env with its flow key, for the static preview build. */
export function allRows(db: DB, env: string): (DescRow & { service: string; ingress: string })[] {
  return (db.prepare('SELECT service, ingress, callee, source, text, title, author, model, trace_hash, updated_at FROM descriptions WHERE env = ?').all(env) as unknown as (Row & { service: string; ingress: string })[])
    .map((r) => ({ ...toRow(r), service: r.service, ingress: r.ingress }));
}

function flowTrace(g: GraphIndex, env: string, service: string, ingress: string) {
  if (!g.model.services.length) throw notFound(`env '${env}'`);
  return trace(g, { service, ingress }, HASH_TRACE) ?? (() => { throw notFound(`ingress '${ingress}' of service '${service}' in env '${env}'`); })();
}

/** The descriptions of one flow with their outdated flags (read against the flow's current trace). */
export function describeFlow(db: DB, g: GraphIndex, env: string, service: string, ingress: string): FlowDescriptions {
  return flowDescriptions(flowTrace(g, env, service, ingress), service, ingress, rowsFor(db, env, service, ingress));
}

function check(g: GraphIndex, env: string, service: unknown, ingress: unknown, callee: unknown, text: unknown, title?: unknown) {
  if (typeof service !== 'string' || !service || typeof ingress !== 'string' || !ingress) throw badRequest('service and ingress are required');
  if (callee !== undefined && callee !== null && typeof callee !== 'string') throw badRequest('callee must be a string');
  if (typeof text !== 'string') throw badRequest('text is required');
  if (text.length > MAX_TEXT) throw badRequest(`text is longer than ${MAX_TEXT} characters`);
  if (title !== undefined && title !== null && typeof title !== 'string') throw badRequest('title must be a string');
  if (typeof title === 'string' && title.trim().length > MAX_TITLE) throw badRequest(`title is longer than ${MAX_TITLE} characters`);
  const t = flowTrace(g, env, service, ingress);
  const c = (callee ?? '') as string;
  if (c && isStepKey(c)) { if (!hasStep(t, c)) throw badRequest(`step '${c}' is not in the flow ${service} / ${ingress}`); } else if (c && !g.model.services.some((s) => s.name === calleeService(c))) throw badRequest(`callee '${c}' is not a service in env '${env}'`);
  // A title belongs to a step; elsewhere it is ignored. undefined = keep what is stored; '' or null = clear it.
  const ttl = isStepKey(c) && title !== undefined ? (typeof title === 'string' ? title.trim() : '') || null : undefined;
  return { t, callee: c, title: ttl };
}
const oldTitle = (db: DB, env: string, a: { service: string; ingress: string }, callee: string, source: string) =>
  (db.prepare('SELECT title FROM descriptions WHERE env = ? AND service = ? AND ingress = ? AND callee = ? AND source = ?').get(env, a.service, a.ingress, callee, source) as { title: string | null } | undefined)?.title ?? null;

/** The human record. Empty text and no title removes it (a step may keep a title with empty text). Returns the flow's descriptions. */
export function putHuman(db: DB, g: GraphIndex, env: string, a: { service: string; ingress: string; callee?: string; text: string; title?: string | null; editedBy?: string }) {
  const { callee, title } = check(g, env, a.service, a.ingress, a.callee, a.text, a.title);
  const text = a.text.trim(), ttl = title === undefined ? oldTitle(db, env, a, callee, 'human') : title;
  if (!text && !ttl) db.prepare("DELETE FROM descriptions WHERE env = ? AND service = ? AND ingress = ? AND callee = ? AND source = 'human'").run(env, a.service, a.ingress, callee);
  else db.prepare(`INSERT INTO descriptions (env, service, ingress, callee, source, text, title, author, updated_at) VALUES (?, ?, ?, ?, 'human', ?, ?, ?, ?)
    ON CONFLICT (env, service, ingress, callee, source) DO UPDATE SET text = excluded.text, title = excluded.title, author = excluded.author, updated_at = excluded.updated_at`)
    .run(env, a.service, a.ingress, callee, text, ttl, (a.editedBy ?? 'web').slice(0, 80), new Date().toISOString());
  return describeFlow(db, g, env, a.service, a.ingress);
}

/** The AI record, with the hash of the flow's trace as it is now. Never touches the human record. A step may carry a title with empty text. */
export function putAi(db: DB, g: GraphIndex, env: string, a: { service: string; ingress: string; callee?: string; text: string; title?: string | null; model: string }) {
  const { t, callee, title } = check(g, env, a.service, a.ingress, a.callee, a.text, a.title);
  const ttl = title === undefined ? oldTitle(db, env, a, callee, 'ai') : title;
  if (!a.text.trim() && !ttl) throw badRequest('text must not be empty');
  if (typeof a.model !== 'string' || !a.model.trim()) throw badRequest('model is required (the name of the AI model that wrote the text)');
  db.prepare(`INSERT INTO descriptions (env, service, ingress, callee, source, text, title, model, trace_hash, updated_at) VALUES (?, ?, ?, ?, 'ai', ?, ?, ?, ?, ?)
    ON CONFLICT (env, service, ingress, callee, source) DO UPDATE SET text = excluded.text, title = excluded.title, model = excluded.model, trace_hash = excluded.trace_hash, updated_at = excluded.updated_at`)
    .run(env, a.service, a.ingress, callee, a.text.trim(), ttl, a.model.trim().slice(0, 80), traceHash(t, callee), new Date().toISOString());
  return describeFlow(db, g, env, a.service, a.ingress);
}

export interface SampleDescription { service: string; ingress: string; callee?: string; source: 'human' | 'ai'; text: string; title?: string; editedBy?: string; model?: string; generatedAt?: string; outdated?: boolean }

/** Seed data (samples/descriptions/*.json): AI records are replaced on every seed; `outdated: true` stores a trace hash that cannot match, for the demo. */
export function loadDescriptions(db: DB, g: GraphIndex, env: string, list: SampleDescription[], warn: (m: string) => void = () => {}): number {
  let n = 0;
  for (const d of list) {
    try {
      // A human note is someone's own words: seeding never replaces one that is already there.
      if (d.source === 'human') {
        const mine = rowsFor(db, env, d.service, d.ingress).find((r) => r.source === 'human' && r.callee === (d.callee ?? ''));
        if (!mine) putHuman(db, g, env, d); else if (d.title && !mine.title) putHuman(db, g, env, { ...d, text: mine.text }); // a title the human has not set yet may be seeded; their words never are
        n++; continue;
      }
      putAi(db, g, env, { ...d, model: d.model ?? 'claude-sonnet-5-5' });
      db.prepare(`UPDATE descriptions SET updated_at = COALESCE(?, updated_at)${d.outdated ? ", trace_hash = 'outdated-sample'" : ''} WHERE env = ? AND service = ? AND ingress = ? AND callee = ? AND source = 'ai'`)
        .run(d.generatedAt ?? null, env, d.service, d.ingress, d.callee ?? '');
      n++;
    } catch (e) {
      // The flow in this env may differ from the samples (harvested data on a shared instance): skip, don't abort the seed.
      if (!(e instanceof HttpError)) throw e;
      warn(`skipped description ${d.service} / ${d.ingress}${d.callee ? ` / ${d.callee}` : ''}: ${e.message}`);
    }
  }
  return n;
}

/** Every record of a service (all its flows), for get_service. */
export function listForService(db: DB, env: string, service: string) {
  return (db.prepare('SELECT ingress, callee, source, text, title, author, model, updated_at FROM descriptions WHERE env = ? AND service = ? ORDER BY ingress, callee, source')
    .all(env, service) as unknown as { ingress: string; callee: string; source: string; text: string; title: string | null; author: string | null; model: string | null; updated_at: string }[])
    .map((r) => ({ ingress: r.ingress, callee: r.callee || null, source: r.source, text: r.text, ...(r.title ? { title: r.title } : {}), by: r.source === 'ai' ? r.model : r.author, at: r.updated_at }));
}
