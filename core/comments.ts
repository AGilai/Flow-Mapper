// Comments under a flow (0.27.0), the pure part shared by the server, the static preview and the UI: the row and thread shapes,
// the flow anchor, and the tree a list returns (oldest first, one level of replies, soft-deleted comments folded away).

export interface CommentRow {
  id: number; anchor: string; step: string | null; parentId: number | null; author: string;
  body: string; createdAt: string; editedAt: string | null; deletedAt: string | null;
}
/** One comment as the list returns it. A deleted one that still has replies has `deleted: true`, no author and an empty body. */
export interface CommentNode {
  id: number; step: string | null; author: string | null; body: string; createdAt: string; editedAt: string | null; deleted: boolean; replies: CommentNode[];
}
export interface Thread { anchor: string; count: number; comments: CommentNode[] }

export const MAX_AUTHOR = 80;
export const flowAnchor = (service: string, ingress: string) => `flow:${service}/${ingress}`;
/** `flow:<service>/<ingress>` -> its parts (the service name has no '/'), or null. */
export function parseFlowAnchor(anchor: unknown): { service: string; ingress: string } | null {
  if (typeof anchor !== 'string' || !anchor.startsWith('flow:')) return null;
  const rest = anchor.slice(5), i = rest.indexOf('/');
  return i > 0 && i < rest.length - 1 ? { service: rest.slice(0, i), ingress: rest.slice(i + 1) } : null;
}

const node = (r: CommentRow, replies: CommentNode[]): CommentNode => r.deletedAt
  ? { id: r.id, step: null, author: null, body: '', createdAt: r.createdAt, editedAt: null, deleted: true, replies }
  : { id: r.id, step: r.step, author: r.author, body: r.body, createdAt: r.createdAt, editedAt: r.editedAt, deleted: false, replies };

/** The thread of one anchor from its rows (any order). `count` is the live comments, replies included. */
export function buildThread(anchor: string, rows: CommentRow[]): Thread {
  const sorted = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id));
  const replies = new Map<number, CommentNode[]>();
  for (const r of sorted) if (r.parentId != null && !r.deletedAt) (replies.get(r.parentId) ?? replies.set(r.parentId, []).get(r.parentId)!).push(node(r, []));
  const comments: CommentNode[] = [];
  for (const r of sorted) {
    if (r.parentId != null) continue;
    const rep = replies.get(r.id) ?? [];
    if (r.deletedAt && !rep.length) continue;
    comments.push(node(r, rep));
  }
  return { anchor, count: rows.filter((r) => !r.deletedAt).length, comments };
}
