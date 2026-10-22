// Preview backend, mentions (0.32.0): the same answers as server/store/mentions-read.ts, in memory, over the bundled comment rows. "Seen" lasts
// until the page is reloaded (like every other preview write).

import { parseFlowAnchor } from '../core/comments.js';
import { sanitize, plainText } from '../core/rich-text.js';

export function createMentions(data) {
  const seen = new Set(); // `${user}:${commentId}`
  const mentioning = (user) => Object.entries(data.comments ?? {}).flatMap(([env, rows]) => rows.filter((r) => !r.deletedAt && (r.body ?? '').includes(`@[${user}]`)).map((r) => ({ env, r })));
  const fail = (message, status) => { const e = new Error(message); e.status = status; throw e; };
  const known = (user) => { if (!user) fail('user is required', 400); if (!(data.users ?? []).some((u) => u.id === user)) fail(`user '${user}' not found`, 404); return user; };
  return {
    mentions: async (q = {}) => {
      const user = known(q.user);
      const list = mentioning(user).filter(({ env, r }) => (!q.env || q.env === env) && (!q.anchor || q.anchor === r.anchor))
        .map(({ env, r }) => { const f = parseFlowAnchor(r.anchor) ?? { service: '', ingress: '' }, html = sanitize(r.body);
          return { commentId: r.id, env, anchor: r.anchor, service: f.service, ingress: f.ingress, step: r.step, parentId: r.parentId, author: r.author, authorId: r.authorId ?? null, text: plainText(html), html, createdAt: r.createdAt, unread: !seen.has(`${user}:${r.id}`) && r.authorId !== user }; })
        .filter((m) => !q.unread || m.unread).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, q.limit ?? 200);
      const name = (id) => (data.users ?? []).find((u) => u.id === id)?.name ?? 'unknown user', token = `@[${user}]`;   // 0.33.0: mentions in the About of a component (a subsystem's about is not bundled)
      const about = q.unread || q.anchor ? [] : Object.entries(data.models ?? {}).flatMap(([env, m]) => (q.env && q.env !== env ? [] : (m.services ?? []).filter((s) => typeof s.about === 'string' && s.about.includes(token))
        .map((s) => ({ env, kind: 'component', id: s.name, label: s.name, text: (s.about.split('\n').find((l) => l.includes(token)) ?? '').replace(/^\s*(#{1,6}|[-*]|\d+[.)])\s+/, '').replace(/@\[([A-Za-z0-9_-]{1,40})\]/g, (_x, id) => `@${name(id)}`).replace(/[*_~`]/g, '').trim().slice(0, 200) }))));
      return { user, unread: list.filter((m) => m.unread).length, mentions: list, about };
    },
    seenMentions: async (user, ids) => { known(user); let n = 0; for (const id of ids ?? []) if (!seen.has(`${user}:${id}`)) { seen.add(`${user}:${id}`); n++; } return { marked: n }; },
    mentionCounts: async (env, user) => { known(user); const o = {}; for (const { env: e, r } of mentioning(user)) if (e === env && !seen.has(`${user}:${r.id}`) && r.authorId !== user) o[r.anchor] = (o[r.anchor] ?? 0) + 1; return o; },
  };
}
