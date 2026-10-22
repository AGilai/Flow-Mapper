// Comments under a flow (0.27.0), the pure part shared by the server, the static preview and the UI: the row and thread shapes,
// the flow anchor, and the tree a list returns (oldest first, one level of replies, soft-deleted comments folded away).

export interface CommentRow {
  id: number; anchor: string; step: string | null; parentId: number | null; author: string;
  body: string; createdAt: string; editedAt: string | null; deletedAt: string | null;
  /** 0.29.2 (importers): the comment's id in the system it came from, who wrote it there, and the resolved state (kept on the top comment; replies follow it). */
  externalId: string | null; externalSource: string | null; authorExternalId: string | null; resolvedAt: string | null; resolvedBy: string | null;
}
/** One comment as the list returns it. A deleted one that still has replies has `deleted: true`, no author and an empty body. */
export interface CommentNode {
  id: number; step: string | null; author: string | null; body: string; createdAt: string; editedAt: string | null; deleted: boolean; replies: CommentNode[];
  externalId: string | null; externalSource: string | null; authorExternalId: string | null; resolved: boolean; resolvedBy: string | null; resolvedAt: string | null;
}
/** `count` is every live comment (replies and resolved threads included); `resolvedThreads` is the live top comments that are resolved. */
export interface Thread { anchor: string; count: number; resolvedThreads: number; comments: CommentNode[] }

export const MAX_AUTHOR = 80;
export const MAX_EXTERNAL = 200;
/** A name as it is stored and compared: control, bidi and zero-width characters removed, runs of whitespace (newlines too) made one space, trimmed. */
// eslint-disable-next-line no-control-regex
export const cleanName = (a: string) => a.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]+/g, (m) => (/[\t\n\r\f\v]/.test(m) ? ' ' : '')).replace(/\s+/g, ' ').trim();
export const flowAnchor = (service: string, ingress: string) => `flow:${service}/${ingress}`;
/** `flow:<service>/<ingress>` -> its parts (the service name has no '/'), or null. */
export function parseFlowAnchor(anchor: unknown): { service: string; ingress: string } | null {
  if (typeof anchor !== 'string' || !anchor.startsWith('flow:')) return null;
  const rest = anchor.slice(5), i = rest.indexOf('/');
  return i > 0 && i < rest.length - 1 ? { service: rest.slice(0, i), ingress: rest.slice(i + 1) } : null;
}

/** `top` is the thread's top row: a reply is resolved with it (the state lives on the top comment only). */
const node = (r: CommentRow, replies: CommentNode[], top: CommentRow = r): CommentNode => {
  const res = { resolved: !!top.resolvedAt, resolvedBy: top.resolvedBy, resolvedAt: top.resolvedAt };
  return r.deletedAt
    ? { id: r.id, step: null, author: null, body: '', createdAt: r.createdAt, editedAt: null, deleted: true, replies, externalId: null, externalSource: null, authorExternalId: null, ...res }
    : { id: r.id, step: r.step, author: r.author, body: r.body, createdAt: r.createdAt, editedAt: r.editedAt, deleted: false, replies, externalId: r.externalId, externalSource: r.externalSource, authorExternalId: r.authorExternalId, ...res };
};

/** The thread of one anchor from its rows (any order). `count` is the live comments, replies included. */
export function buildThread(anchor: string, rows: CommentRow[]): Thread {
  const sorted = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id));
  const replies = new Map<number, CommentNode[]>();
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of sorted) if (r.parentId != null && !r.deletedAt) (replies.get(r.parentId) ?? replies.set(r.parentId, []).get(r.parentId)!).push(node(r, [], byId.get(r.parentId) ?? r));
  const comments: CommentNode[] = [];
  for (const r of sorted) {
    if (r.parentId != null) continue;
    const rep = replies.get(r.id) ?? [];
    if (r.deletedAt && !rep.length) continue;
    comments.push(node(r, rep));
  }
  return { anchor, count: rows.filter((r) => !r.deletedAt).length, resolvedThreads: comments.filter((c) => c.resolved && !c.deleted).length, comments };
}

/** An ISO 8601 time as an importer gives it, as the UTC instant the thread sorts by; `null` when it is not a time. */
export function isoTime(t: unknown): string | null {
  if (typeof t !== 'string' || !/^\d{4}-\d\d-\d\d(T|\s)\d\d:\d\d/.test(t.trim())) return null;
  const ms = Date.parse(t.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
