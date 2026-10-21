// Bug reports for Flow-Mapper itself: versioned, prioritized by severity + graph impact,
// with log attachments, comments and a status workflow. See docs/DESIGN.md §6.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import type { GraphIndex } from '../../core/graph-index.ts';
import { impact, suggestPriority, type EntityLink, type Priority, type Severity } from '../../core/impact.ts';
import { bugCommented, bugCreated, bugPatched } from '../events/emitters.ts';
import { HttpError, badRequest, conflict, invalid, notFound } from '../errors.ts';

export const STATUSES = ['open', 'triaged', 'in_progress', 'fixed', 'verified', 'closed', 'wont_fix', 'duplicate'] as const;
export type Status = (typeof STATUSES)[number];
const SEVERITIES = ['S1', 'S2', 'S3', 'S4'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const LINK_TYPES = ['service', 'function', 'ingress', 'egress', 'channel', 'resource'];
const CHANNELS = ['api', 'web', 'mcp'];

const TRANSITIONS: Record<Status, Status[]> = {
  open: ['triaged', 'in_progress', 'wont_fix', 'duplicate'],
  triaged: ['open', 'in_progress', 'wont_fix', 'duplicate'],
  in_progress: ['triaged', 'fixed', 'wont_fix'],
  fixed: ['verified', 'in_progress'],
  verified: ['closed', 'in_progress'],
  closed: ['open'],
  wont_fix: ['open'],
  duplicate: ['open'],
};
export const OPEN_STATUSES: Status[] = ['open', 'triaged', 'in_progress'];
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const now = () => new Date().toISOString();

/** Compare dotted versions numerically: 0.10.0 > 0.9.3. */
export function versionGte(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return true;
}

export interface BugInput {
  title: string; description?: string; steps?: string; severity?: Severity; appVersion?: string; env?: string;
  reporter?: string; assignee?: string; channel?: string; links?: EntityLink[]; priority?: Priority;
}

function checkLinks(links: unknown): EntityLink[] {
  if (links === undefined) return [];
  if (!Array.isArray(links)) throw invalid('links must be an array');
  for (const l of links) {
    if (!l || !LINK_TYPES.includes(l.type) || typeof l.id !== 'string') throw invalid(`bad link ${JSON.stringify(l)}; need {type: ${LINK_TYPES.join('|')}, id, service?}`);
  }
  return links as EntityLink[];
}

function scorePriority(g: GraphIndex, severity: Severity, links: EntityLink[]) {
  const imp = impact(g, links);
  return { impact: imp.flows, suggested: suggestPriority(severity, imp.flows, imp.totalFlows), totalFlows: imp.totalFlows };
}

export function createBug(db: DB, g: (env: string) => GraphIndex, input: BugInput, appVersion: string) {
  if (!input || typeof input.title !== 'string' || !input.title.trim()) throw invalid('title is required');
  const severity = (input.severity ?? 'S3') as Severity;
  if (!SEVERITIES.includes(severity)) throw invalid(`severity must be one of ${SEVERITIES.join(', ')}`);
  if (input.priority && !PRIORITIES.includes(input.priority)) throw invalid(`priority must be one of ${PRIORITIES.join(', ')}`);
  const channel = input.channel ?? 'api';
  if (!CHANNELS.includes(channel)) throw invalid(`channel must be one of ${CHANNELS.join(', ')}`);
  const links = checkLinks(input.links);
  const env = input.env ?? 'default';
  const score = scorePriority(g(env), severity, links);
  const priority = input.priority ?? score.suggested;
  const t = now();
  const id = tx(db, () => {
    const r = db.prepare(`INSERT INTO bugs (title, description, steps, status, severity, priority, priority_override, impact, app_version, env, reporter, assignee, channel, created_at, updated_at)
      VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.title.trim(), input.description ?? '', input.steps ?? '', severity, priority, input.priority ? 1 : 0, score.impact,
        input.appVersion ?? appVersion, env, input.reporter ?? 'anonymous', input.assignee ?? null, channel, t, t);
    const id = Number(r.lastInsertRowid);
    setLinks(db, id, links);
    return id;
  });
  bugCreated(db, id, { title: input.title.trim(), severity, priority, env, reporter: input.reporter ?? 'anonymous', links });
  return id;
}

function setLinks(db: DB, id: number, links: EntityLink[]) {
  db.prepare('DELETE FROM bug_links WHERE bug_id = ?').run(id);
  const ins = db.prepare('INSERT OR IGNORE INTO bug_links (bug_id, type, service, ref_id) VALUES (?, ?, ?, ?)');
  for (const l of links) ins.run(id, l.type, l.service ?? null, l.id);
}

function row(db: DB, id: number): any {
  const r = db.prepare('SELECT * FROM bugs WHERE id = ?').get(id) as any;
  if (!r) throw notFound(`bug #${id}`);
  return r;
}

const shape = (r: any, appVersion: string) => ({
  id: r.id, title: r.title, description: r.description, steps: r.steps, status: r.status, severity: r.severity,
  priority: r.priority, priorityOverride: !!r.priority_override, impact: r.impact, appVersion: r.app_version,
  fixedInVersion: r.fixed_in_version, env: r.env, reporter: r.reporter, assignee: r.assignee, channel: r.channel,
  resolution: r.resolution ? JSON.parse(r.resolution) : null, createdAt: r.created_at, updatedAt: r.updated_at,
  needsVerification: r.status === 'fixed' && !!r.fixed_in_version && versionGte(appVersion, r.fixed_in_version),
});

export function getBug(db: DB, id: number, appVersion: string) {
  const r = row(db, id);
  return {
    ...shape(r, appVersion),
    links: (db.prepare('SELECT type, service, ref_id AS id FROM bug_links WHERE bug_id = ?').all(id) as any[]).map((l) => ({ ...l, service: l.service ?? undefined })),
    attachments: db.prepare('SELECT id, filename, content_type AS contentType, size, suggestions, uploaded_at AS uploadedAt FROM bug_attachments WHERE bug_id = ? ORDER BY id').all(id)
      .map((a: any) => ({ ...a, suggestions: JSON.parse(a.suggestions) })),
    comments: db.prepare('SELECT id, author, body, created_at AS createdAt FROM bug_comments WHERE bug_id = ? ORDER BY id').all(id),
    allowedTransitions: TRANSITIONS[r.status as Status],
  };
}

export interface BugFilter {
  status?: string; priority?: string; severity?: string; service?: string; version?: string; q?: string; open?: boolean; limit?: number;
  /** comma list of reporters, e.g. the harvester's own name */
  reporter?: string;
  /** ISO time: only bugs changed after it (status, fields or a new comment), for cheap polling */
  updatedSince?: string;
}

export function listBugs(db: DB, f: BugFilter, appVersion: string) {
  const where: string[] = [], args: (string | number)[] = [];
  const inList = (col: string, csv?: string) => {
    if (!csv) return;
    const xs = csv.split(',').filter(Boolean);
    where.push(`${col} IN (${xs.map(() => '?').join(',')})`);
    args.push(...xs);
  };
  if (f.open) inList('status', OPEN_STATUSES.join(','));
  inList('status', f.status);
  inList('priority', f.priority);
  inList('severity', f.severity);
  inList('reporter', f.reporter);
  if (f.updatedSince) { where.push('updated_at > ?'); args.push(f.updatedSince); }
  if (f.version) { where.push('(app_version = ? OR fixed_in_version = ?)'); args.push(f.version, f.version); }
  if (f.q) { where.push('(title LIKE ? OR description LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`); }
  if (f.service) { where.push('id IN (SELECT bug_id FROM bug_links WHERE service = ? OR (type = \'service\' AND ref_id = ?))'); args.push(f.service, f.service); }
  const sql = `SELECT * FROM bugs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY priority ASC, impact DESC, created_at ASC LIMIT ?`;
  return (db.prepare(sql).all(...args, f.limit ?? 200) as any[]).map((r) => shape(r, appVersion));
}

export interface BugPatch {
  title?: string; description?: string; steps?: string; severity?: Severity; priority?: Priority | null; assignee?: string | null;
  status?: Status; fixedInVersion?: string; resolution?: { type: string; ref?: string; note?: string }; links?: EntityLink[];
}

export function updateBug(db: DB, g: (env: string) => GraphIndex, id: number, patch: BugPatch) {
  const cur = row(db, id);
  const set: Record<string, unknown> = {};
  if (patch.title !== undefined) { if (!patch.title.trim()) throw invalid('title cannot be empty'); set.title = patch.title.trim(); }
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.steps !== undefined) set.steps = patch.steps;
  if (patch.assignee !== undefined) set.assignee = patch.assignee;
  if (patch.severity !== undefined) { if (!SEVERITIES.includes(patch.severity)) throw invalid('bad severity'); set.severity = patch.severity; }
  if (patch.priority !== undefined) {
    if (patch.priority === null) set.priority_override = 0;
    else { if (!PRIORITIES.includes(patch.priority)) throw invalid('bad priority'); set.priority = patch.priority; set.priority_override = 1; }
  }
  if (patch.fixedInVersion !== undefined) set.fixed_in_version = patch.fixedInVersion;
  if (patch.resolution !== undefined) {
    if (!patch.resolution || !['code', 'map-data', 'config', 'none'].includes(patch.resolution.type)) throw invalid('resolution.type must be code | map-data | config | none');
    set.resolution = JSON.stringify(patch.resolution);
  }
  if (patch.status !== undefined && patch.status !== cur.status) {
    if (!STATUSES.includes(patch.status)) throw invalid(`status must be one of ${STATUSES.join(', ')}`);
    if (!TRANSITIONS[cur.status as Status].includes(patch.status))
      throw conflict('BAD_TRANSITION', `cannot move from ${cur.status} to ${patch.status}`, { allowed: TRANSITIONS[cur.status as Status] });
    if (patch.status === 'fixed') {
      if (!(patch.fixedInVersion ?? cur.fixed_in_version)) throw invalid('fixedInVersion is required to mark a bug fixed');
      if (!(patch.resolution ?? cur.resolution)) throw invalid('resolution is required to mark a bug fixed');
    }
    set.status = patch.status;
  }
  tx(db, () => {
    const links = patch.links !== undefined ? checkLinks(patch.links) : null;
    if (links) setLinks(db, id, links);
    const sev = (set.severity ?? cur.severity) as Severity;
    const override = set.priority_override !== undefined ? set.priority_override : cur.priority_override;
    if (links || set.severity || set.priority_override === 0) {
      const all = links ?? (db.prepare('SELECT type, service, ref_id AS id FROM bug_links WHERE bug_id = ?').all(id) as any[]);
      const s = scorePriority(g(cur.env), sev, all.map((l: any) => ({ ...l, service: l.service ?? undefined })));
      set.impact = s.impact;
      if (!override) set.priority = s.suggested;
    }
    set.updated_at = now();
    const cols = Object.keys(set);
    db.prepare(`UPDATE bugs SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...(Object.values(set) as any[]), id);
  });
  bugPatched(db, cur, row(db, id), Object.keys(patch).filter((k) => (patch as any)[k] !== undefined));
}

export function addComment(db: DB, id: number, author: string | undefined, body: unknown) {
  const bug = row(db, id);
  if (typeof body !== 'string' || !body.trim()) throw invalid('comment body is required');
  const r = db.prepare('INSERT INTO bug_comments (bug_id, author, body, created_at) VALUES (?, ?, ?, ?)').run(id, author || 'anonymous', body, now());
  db.prepare('UPDATE bugs SET updated_at = ? WHERE id = ?').run(now(), id);
  bugCommented(db, bug, Number(r.lastInsertRowid), author || 'anonymous', body);
  return Number(r.lastInsertRowid);
}

/** Scan log text for known service names and bind keys; return suggested links (not applied). */
export function suggestLinks(g: GraphIndex, text: string): (EntityLink & { hits: number })[] {
  const out: (EntityLink & { hits: number })[] = [];
  const count = (needle: string) => (needle.length < 4 ? 0 : text.split(needle).length - 1);
  for (const s of g.model.services) { const n = count(s.name); if (n) out.push({ type: 'service', id: s.name, hits: n }); }
  for (const i of g.model.ingress) { const n = count(i.bindKey.replace(/^[a-z-]+:/, '')); if (n && i.match !== 'glob') out.push({ type: 'ingress', service: i.service, id: i.id, hits: n }); }
  for (const f of g.model.functions) { const n = count(f.name); if (n) out.push({ type: 'function', service: f.service, id: f.id, hits: n }); }
  return out.sort((a, b) => b.hits - a.hits).slice(0, 20);
}

export function addAttachment(db: DB, g: (env: string) => GraphIndex, dataDir: string, id: number, filename: string, contentType: string, body: Buffer) {
  const bug = row(db, id);
  if (!filename || /[\\/]/.test(filename)) throw badRequest('filename is required and must not contain slashes');
  if (body.length > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'TOO_LARGE', `attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
  const dir = join(dataDir, 'uploads', String(id));
  mkdirSync(dir, { recursive: true });
  const stored = `${Date.now()}-${filename}`;
  writeFileSync(join(dir, stored), body);
  const text = contentType.startsWith('text/') || /\.(log|txt|json|csv)$/i.test(filename) ? body.toString('utf8') : '';
  const suggestions = text ? suggestLinks(g(bug.env), text) : [];
  const r = db.prepare('INSERT INTO bug_attachments (bug_id, filename, content_type, size, path, suggestions, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, filename, contentType, body.length, join(String(id), stored), JSON.stringify(suggestions), now());
  return { id: Number(r.lastInsertRowid), filename, size: body.length, suggestions };
}

export function readAttachment(db: DB, dataDir: string, bugId: number, attId: number) {
  const a = db.prepare('SELECT * FROM bug_attachments WHERE id = ? AND bug_id = ?').get(attId, bugId) as any;
  if (!a) throw notFound(`attachment #${attId}`);
  return { filename: a.filename as string, contentType: a.content_type as string, body: readFileSync(join(dataDir, 'uploads', a.path)) };
}

export function bugStats(db: DB) {
  const by = (col: string) => Object.fromEntries((db.prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM bugs GROUP BY ${col}`).all() as any[]).map((r) => [r.k, r.n]));
  return { byStatus: by('status'), byPriority: by('priority'), bySeverity: by('severity'), byVersion: by('app_version') };
}
