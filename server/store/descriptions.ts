// Flow descriptions: two records per key (human | ai). Humans write theirs through REST, AI tools theirs through the
// MCP tool set_description; neither ever overwrites the other. See core/description.ts and docs/API.md.

import type { DB } from '../db/connection.ts';
import type { GraphIndex } from '../../core/graph-index.ts';
import { badRequest, notFound } from '../errors.ts';
import { trace } from '../../core/trace.ts';
import { flowDescriptions, traceHash, HASH_TRACE, calleeService, type DescRow, type FlowDescriptions } from '../../core/description.ts';

const MAX_TEXT = 4000;
interface Row { callee: string; source: 'human' | 'ai'; text: string; author: string | null; model: string | null; trace_hash: string | null; updated_at: string }
const toRow = (r: Row): DescRow => ({ callee: r.callee, source: r.source, text: r.text, author: r.author, model: r.model, traceHash: r.trace_hash, updatedAt: r.updated_at });

export function rowsFor(db: DB, env: string, service: string, ingress: string): DescRow[] {
  return (db.prepare('SELECT callee, source, text, author, model, trace_hash, updated_at FROM descriptions WHERE env = ? AND service = ? AND ingress = ? ORDER BY callee, source')
    .all(env, service, ingress) as unknown as Row[]).map(toRow);
}

/** Every row of an env with its flow key, for the static preview build. */
export function allRows(db: DB, env: string): (DescRow & { service: string; ingress: string })[] {
  return (db.prepare('SELECT service, ingress, callee, source, text, author, model, trace_hash, updated_at FROM descriptions WHERE env = ?').all(env) as unknown as (Row & { service: string; ingress: string })[])
    .map((r) => ({ ...toRow(r), service: r.service, ingress: r.ingress }));
}

const flowTrace =(g: GraphIndex, env: string, service: string, ingress: string) =>
  trace(g, { service, ingress }, HASH_TRACE) ?? (() => { throw notFound(`ingress '${ingress}' of service '${service}' in env '${env}'`); })();

/** The descriptions of one flow with their outdated flags (read against the flow's current trace). */
export function describeFlow(db: DB, g: GraphIndex, env: string, service: string, ingress: string): FlowDescriptions {
  return flowDescriptions(flowTrace(g, env, service, ingress), service, ingress, rowsFor(db, env, service, ingress));
}

function check(g: GraphIndex, env: string, service: unknown, ingress: unknown, callee: unknown, text: unknown) {
  if (typeof service !== 'string' || !service || typeof ingress !== 'string' || !ingress) throw badRequest('service and ingress are required');
  if (callee !== undefined && callee !== null && typeof callee !== 'string') throw badRequest('callee must be a string');
  if (typeof text !== 'string') throw badRequest('text is required');
  if (text.length > MAX_TEXT) throw badRequest(`text is longer than ${MAX_TEXT} characters`);
  const t = flowTrace(g, env, service, ingress);
  const c = (callee ?? '') as string;
  if (c && !g.model.services.some((s) => s.name === calleeService(c))) throw badRequest(`callee '${c}' is not a service in env '${env}'`);
  return { t, callee: c };
}

/** The human record. Empty text removes it. Returns the flow's descriptions. */
export function putHuman(db: DB, g: GraphIndex, env: string, a: { service: string; ingress: string; callee?: string; text: string; editedBy?: string }) {
  const { callee } = check(g, env, a.service, a.ingress, a.callee, a.text);
  const text = a.text.trim();
  if (!text) db.prepare("DELETE FROM descriptions WHERE env = ? AND service = ? AND ingress = ? AND callee = ? AND source = 'human'").run(env, a.service, a.ingress, callee);
  else db.prepare(`INSERT INTO descriptions (env, service, ingress, callee, source, text, author, updated_at) VALUES (?, ?, ?, ?, 'human', ?, ?, ?)
    ON CONFLICT (env, service, ingress, callee, source) DO UPDATE SET text = excluded.text, author = excluded.author, updated_at = excluded.updated_at`)
    .run(env, a.service, a.ingress, callee, text, (a.editedBy ?? 'web').slice(0, 80), new Date().toISOString());
  return describeFlow(db, g, env, a.service, a.ingress);
}

/** The AI record, with the hash of the flow's trace as it is now. Never touches the human record. */
export function putAi(db: DB, g: GraphIndex, env: string, a: { service: string; ingress: string; callee?: string; text: string; model: string }) {
  const { t, callee } = check(g, env, a.service, a.ingress, a.callee, a.text);
  if (!a.text.trim()) throw badRequest('text must not be empty');
  if (typeof a.model !== 'string' || !a.model.trim()) throw badRequest('model is required (the name of the AI model that wrote the text)');
  db.prepare(`INSERT INTO descriptions (env, service, ingress, callee, source, text, model, trace_hash, updated_at) VALUES (?, ?, ?, ?, 'ai', ?, ?, ?, ?)
    ON CONFLICT (env, service, ingress, callee, source) DO UPDATE SET text = excluded.text, model = excluded.model, trace_hash = excluded.trace_hash, updated_at = excluded.updated_at`)
    .run(env, a.service, a.ingress, callee, a.text.trim(), a.model.trim().slice(0, 80), traceHash(t, callee), new Date().toISOString());
  return describeFlow(db, g, env, a.service, a.ingress);
}

export interface SampleDescription { service: string; ingress: string; callee?: string; source: 'human' | 'ai'; text: string; editedBy?: string; model?: string; generatedAt?: string; outdated?: boolean }

/** Seed data (samples/descriptions/*.json): AI records are replaced on every seed; `outdated: true` stores a trace hash that cannot match, for the demo. */
export function loadDescriptions(db: DB, g: GraphIndex, env: string, list: SampleDescription[]): number {
  for (const d of list) {
    // A human note is someone's own words: seeding never replaces one that is already there.
    if (d.source === 'human') { if (!rowsFor(db, env, d.service, d.ingress).some((r) => r.source === 'human' && r.callee === (d.callee ?? ''))) putHuman(db, g, env, d); continue; }
    putAi(db, g, env, { ...d, model: d.model ?? 'claude-sonnet-5-5' });
    db.prepare(`UPDATE descriptions SET updated_at = COALESCE(?, updated_at)${d.outdated ? ", trace_hash = 'outdated-sample'" : ''} WHERE env = ? AND service = ? AND ingress = ? AND callee = ? AND source = 'ai'`)
      .run(d.generatedAt ?? null, env, d.service, d.ingress, d.callee ?? '');
  }
  return list.length;
}

/** Every record of a service (all its flows), for get_service. */
export function listForService(db: DB, env: string, service: string) {
  return (db.prepare('SELECT ingress, callee, source, text, author, model, updated_at FROM descriptions WHERE env = ? AND service = ? ORDER BY ingress, callee, source')
    .all(env, service) as unknown as { ingress: string; callee: string; source: string; text: string; author: string | null; model: string | null; updated_at: string }[])
    .map((r) => ({ ingress: r.ingress, callee: r.callee || null, source: r.source, text: r.text, by: r.source === 'ai' ? r.model : r.author, at: r.updated_at }));
}
