// Comments under a flow for agents: read the discussion of a flow, add a comment or a reply. Like set_description these are annotations:
// they work in any environment, sealed ones included.

import { flowAnchor, type CommentNode } from '../../../core/comments.ts';
import { commentHtml } from '../../../core/rich-text-md.ts';
import { plainText } from '../../../core/rich-text-text.ts';
import { addComment, listThread, resolveComment } from '../../store/comments.ts';
import { out as rowOut } from '../../store/comments-rows.ts';
import { ASSISTANT } from '../../identity.ts';
import { type Tool, env, obj, envOf, draftArg } from './common.ts';

const out = (n: CommentNode, parentId: number | null = null): unknown => ({
  id: n.id, parentId, author: n.author, authorId: n.authorId, deleted: n.deleted, step: n.step, createdAt: n.createdAt, editedAt: n.editedAt,
  externalId: n.externalId, externalSource: n.externalSource, authorExternalId: n.authorExternalId, resolved: n.resolved, resolvedBy: n.resolvedBy, resolvedAt: n.resolvedAt,
  text: plainText(n.body), html: n.body, replies: n.replies.map((r) => out(r, n.id)),
});

export const listCommentsTool: Tool = {
  name: 'list_comments',
  description: "The discussion under a flow (service + ingress): comments oldest first, each with its author, time, optional step key, plain `text` and sanitized `html`, and its replies (one level). since: an ISO time; only comments created or edited after it are returned (for polling). Read only.",
  inputSchema: obj({ env, service: { type: 'string' }, ingress: { type: 'string', description: 'Ingress id of the flow entry' }, draft: draftArg, since: { type: 'string', description: 'ISO time: only newer comments' } }, ['service', 'ingress']),
  run: (c, a) => {
    const t = listThread(c.db, envOf(a), flowAnchor(a.service, a.ingress));
    const newer = (n: CommentNode): boolean => !!a.since && (n.createdAt > a.since || (n.editedAt ?? '') > a.since);
    const keep = (n: CommentNode): CommentNode | null => { const reps = n.replies.map(keep).filter(Boolean) as CommentNode[]; return !a.since || newer(n) || reps.length ? { ...n, replies: !a.since ? n.replies : reps } : null; };
    const comments = t.comments.map(keep).filter(Boolean) as CommentNode[];
    return { anchor: t.anchor, count: t.count, comments: comments.map((n) => out(n)) };
  },
};

export const addCommentTool: Tool = {
  name: 'add_comment',
  description: "Add a comment (or a reply with parentId) under a flow. body: plain text with Markdown-lite (**bold**, ~~strike~~, '- ' lists, blank line = new paragraph), or HTML from this subset (to mention someone write @[userId] or @{Display Name}: the name is matched to a user, a new one is created if none matches; see list_users): p br b strong i em s u ul ol li a(http/https href) table thead tbody tr th td span(class cc-coral|cc-ochre|cc-sage|cc-cyan|cc-sky|cc-violet) code pre blockquote; anything else is removed. step: a step key (#step:...) from the flow's trace to attach it to a step. author: your name (at most 80 characters; default \"Assistant\"); it is matched to a user (created when new). Works in any environment. draft: an open draft, for a flow that exists only there. Importers: createdAt (ISO 8601, not in the future) keeps the original time; externalSource + externalId (both or neither, at most 200 characters each) make the call idempotent: the same pair again updates that comment and returns updated: true; authorExternalId; parentExternalId replies to the comment of that externalSource and id; resolved (with resolvedBy, resolvedAt) sets the thread's state (top comments only).",
  inputSchema: obj({ env, service: { type: 'string' }, ingress: { type: 'string', description: 'Ingress id of the flow entry' }, author: { type: 'string' }, body: { type: 'string' }, step: { type: 'string' }, parentId: { type: 'integer' }, draft: draftArg,
    createdAt: { type: 'string' }, externalId: { type: 'string' }, externalSource: { type: 'string' }, authorExternalId: { type: 'string' }, parentExternalId: { type: 'string' }, resolved: { type: 'boolean' }, resolvedBy: { type: 'string' }, resolvedAt: { type: 'string' } }, ['service', 'ingress', 'body']),
  run: (c, a) => {
    const e = envOf(a), row = addComment(c.db, c.view(e, a.draft || null).g, e, { anchor: flowAnchor(a.service, a.ingress), step: a.step ?? null, parentId: a.parentId ?? null, author: a.author ?? ASSISTANT, body: commentHtml(a.body),
      createdAt: a.createdAt, externalId: a.externalId, externalSource: a.externalSource, authorExternalId: a.authorExternalId, parentExternalId: a.parentExternalId, resolved: a.resolved, resolvedBy: a.resolvedBy, resolvedAt: a.resolvedAt });
    return { id: row.id, parentId: row.parentId, anchor: row.anchor, createdAt: row.createdAt, html: row.body, externalId: row.externalId, externalSource: row.externalSource, resolved: row.resolved, ...(row.updated && { updated: true }) };
  },
};

export const resolveCommentTool: Tool = {
  name: 'resolve_comment',
  description: "Resolve or reopen a discussion: id is a top comment (a reply cannot be resolved alone; its thread follows). resolved: true or false. author: your name (default \"Assistant\"). Anyone may resolve or reopen. Resolved threads are hidden in the UI behind \"Show resolved\" and not counted in the Flows list. Works in any environment.",
  inputSchema: obj({ env, id: { type: 'integer' }, author: { type: 'string' }, resolved: { type: 'boolean' } }, ['id', 'resolved']),
  run: (c, a) => { const r = rowOut(resolveComment(c.db, envOf(a), a.id, { actor: a.author ?? ASSISTANT, resolved: a.resolved })); return { id: r.id, resolved: r.resolved, resolvedBy: r.resolvedBy, resolvedAt: r.resolvedAt }; },
};
