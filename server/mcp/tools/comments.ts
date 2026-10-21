// Comments under a flow for agents: read the discussion of a flow, add a comment or a reply. Like set_description these are annotations:
// they work in any environment, sealed ones included.

import { flowAnchor, type CommentNode } from '../../../core/comments.ts';
import { commentHtml } from '../../../core/rich-text-md.ts';
import { plainText } from '../../../core/rich-text-text.ts';
import { addComment, listThread } from '../../store/comments.ts';
import { type Tool, env, obj, envOf, draftArg } from './common.ts';

const out = (n: CommentNode, parentId: number | null = null): unknown => ({
  id: n.id, parentId, author: n.author, deleted: n.deleted, step: n.step, createdAt: n.createdAt, editedAt: n.editedAt,
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
  description: "Add a comment (or a reply with parentId) under a flow. body: plain text with Markdown-lite (**bold**, ~~strike~~, '- ' lists, blank line = new paragraph), or HTML from this subset: p br b strong i em s u ul ol li a(http/https href) table thead tbody tr th td span(class cc-coral|cc-ochre|cc-sage|cc-cyan|cc-sky|cc-violet) code pre blockquote; anything else is removed. step: a step key (#step:...) from the flow's trace to attach it to a step. author: your name (at most 80 characters). Works in any environment. draft: an open draft, for a flow that exists only there.",
  inputSchema: obj({ env, service: { type: 'string' }, ingress: { type: 'string', description: 'Ingress id of the flow entry' }, author: { type: 'string' }, body: { type: 'string' }, step: { type: 'string' }, parentId: { type: 'integer' }, draft: draftArg }, ['service', 'ingress', 'author', 'body']),
  run: (c, a) => {
    const e = envOf(a), row = addComment(c.db, c.view(e, a.draft || null).g, e, { anchor: flowAnchor(a.service, a.ingress), step: a.step ?? null, parentId: a.parentId ?? null, author: a.author, body: commentHtml(a.body) });
    return { id: row.id, parentId: row.parentId, anchor: row.anchor, createdAt: row.createdAt, html: row.body };
  },
};
