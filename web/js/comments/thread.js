// The "Comments (n)" section under a flow's description (0.27.0, frame 13): a collapsible box (open state remembered per viewer), the thread
// oldest first with one level of replies, the empty state, and the composer at the end. It loads the thread of one flow, loads it again
// after every change of its own and when the window is focused again (the UI has no push channel; comment.* events are on /api/events for
// agents), and redraws when the walk's steps are known or change (the step pills read them).

import { h } from '../dom.js';
import { api } from '../api.js';
import { flowAnchor } from '../../core/comments.js';
import { commentItem } from './comment.js';
import { createComposer } from './composer.js';
import { userAvatar } from '../users/avatar.js';
import { myName, me, watchUsers, loadUsers } from '../users/directory.js';
import { refreshChips } from '../users/chips.js';
import { startsOpen, relTime, fullDate, visibleThread, mentionedOnly, countMentions } from './pure.js';
import { announceSeen } from '../users/unread.js';
import { prefill, stripTables, eventParts } from '../action-items/pure.js';
import { sanitize, plainText } from '../../core/rich-text.js';

const OPEN = 'flow-mapper.comments-open';
const read = () => { try { const v = localStorage.getItem(OPEN); return v === null ? true : v === '1'; } catch { return true; } };
const write = (v) => { try { localStorage.setItem(OPEN, v ? '1' : '0'); } catch { /* storage unavailable */ } };
const plural = (n, w) => `${n} ${n === 1 ? w : w === 'reply' ? 'replies' : `${w}s`}`;

/**
 * createComments({ env, root: { service, ingress }, walk, store, onCount(n) }) -> { el, refresh(), dispose() }
 * store: the flow's action item store (0.29.0): "+ Action item", "Make action item", the events under a comment and the outline of the comment an item is being made from.
 * walk: the tab's step walk ({ steps(), current(), picked(), go(n), watch(fn) }): the pills, "Attach to step N" and the jump.
 */
export function createComments({ env, root, walk, store, onCount }) {
  const anchor = flowAnchor(root.service, root.ingress);
  let thread = { count: 0, resolvedThreads: 0, comments: [] }, showResolved = false, items = [], composer = null, replying = null, loaded = false, seq = 0, own = false, flash = 0, mineOnly = false, considered = false;
  const fresh = new Set(); // comment ids that mention me and were unread when this thread opened: they carry a "new" mark until the page is left
  const title = h('span.cm-t', 'Comments'), count = h('span.muted.sm', '(0)'), hint = h('span.cm-hint.cm-sum');
  const list = h('div.cm-list'), tail = h('div.cm-tail');
  const addAi = h('button.abtn', { type: 'button', 'data-qa': 'cm-add-action', on: { click: (e) => { e.preventDefault(); store.startNew(); } } }, '+ Action item');
  // 0.29.2: resolved threads are hidden until the viewer asks (not remembered: a new visit starts with the open discussions)
  const showBtn = h('button.abtn.cm-showres', { type: 'button', 'data-qa': 'cm-show-resolved', 'aria-pressed': 'false', on: { click: (e) => { e.preventDefault(); showResolved = !showResolved; draw(); } } });
  // 0.32.0: only the threads that mention the signed-in user
  const meBtn = h('button.abtn.cm-mentioned', { type: 'button', 'data-qa': 'cm-mentioned', 'aria-pressed': 'false', hidden: true, on: { click: (e) => { e.preventDefault(); mineOnly = !mineOnly; draw(); } } });
  const el = h('details.cm-sec', { open: false, 'data-qa': 'comments' }, h('summary', title, count, hint, showBtn, meBtn, addAi), list, tail);
  let auto = false; // the toggle the first load makes itself is not the viewer's choice
  el.addEventListener('toggle', () => { consider(); if (auto) { auto = false; return; } if (visibleThread(thread, showResolved).count) write(el.open); });

  const stepOf = (key) => { const s = walk.steps().find((x) => x.key === key); return s ? { n: s.n } : null; };
  const stepNow = () => { const s = walk.picked() ? walk.steps()[walk.current() - 1] : null; return s ? { n: s.n, key: s.key } : null; };
  const busy = () => !!list.querySelector('.cm-editing, .cm-composer.reply');
  const run = async (fn) => { await fn(); await refresh(true); };
  const author = () => myName(); // the signed-in user (the server takes the id from X-Flow-User; the name is for the preview and old clients)
  const api_ = {
    edit: (id, html) => run(() => api.editComment(env, id, { author: author(), body: html })),
    remove: (id) => run(() => api.deleteComment(env, id, author())),
    resolve: (id, resolved, name) => run(() => api.resolveComment(env, id, { actor: name, resolved })),
    reply: (id) => { replying = replying === id ? null : id; draw(); },
    make: (n) => store.startNew({ description: prefill(plainText(stripTables(sanitize(n.body)))), step: n.step, commentId: n.id, commentAuthor: n.author }),
  };
  const events = (id) => store.events.filter((e) => e.commentId === id).map((e) => {
    const p = eventParts(e);
    return h('div.ai-ev', { 'data-qa': 'ai-event' }, h('span', h('b', e.actor), ` ${p.verb} `, h('button.lnk', { type: 'button', title: 'Show that action item', on: { click: () => store.focus(e.number) } }, `#${e.number}`), p.tail, ' \u00b7 ', h('span', { title: fullDate(e.at) }, relTime(e.at))));
  });
  /** The outline of the comment a new action item is being made from, and the "from X's comment" jump. */
  const mark = () => { addAi.hidden = !!store.items.length || !!store.draft || !loaded || !store.loaded; list.querySelectorAll('.cm[data-id]').forEach((c) => c.classList.toggle('hl', Number(c.dataset.id) === store.draft?.commentId)); };

  const drawMe = () => { const m = tail.querySelector('.cm-me'); if (m) m.replaceChildren(me() ? userAvatar(me()) : userAvatar({ name: '?' })); };
  const offUsers = watchUsers(() => { drawMe(); refreshChips(el); consider(); }); // a rename, a merge or the first load of the users: avatars and chips follow
  loadUsers().catch(() => {});
  const people = () => { const ids = []; const walkc = (c) => { if (c.authorId && !ids.includes(c.authorId)) ids.push(c.authorId); (c.replies ?? []).forEach(walkc); }; thread.comments.forEach(walkc); return ids; };

  function draw() {
    items.forEach((i) => i.dispose()); items = [];
    const x = (top) => ({ people, fresh: (id) => fresh.has(id), step: stepOf, jump: (n) => walk.go(n), top, api: api_ });
    const u = me(), mineN = u ? countMentions(thread, u.id) : 0;
    if (!mineN) mineOnly = false;
    const vis = mineOnly && u ? mentionedOnly(visibleThread(thread, showResolved), u.id) : visibleThread(thread, showResolved), hiddenN = thread.resolvedThreads ?? 0;
    meBtn.hidden = !mineN; meBtn.setAttribute('aria-pressed', String(mineOnly)); meBtn.textContent = `@ Mentioned me (${mineN})`;
    const nodes = vis.comments.map((c) => {
      const it = commentItem(c, x(true)); items.push(it);
      const rep = c.replies.flatMap((r) => { const ri = commentItem(r, x(false)); items.push(ri); return [ri.el, ...events(r.id)]; });
      let rc = null;
      if (replying === c.id && !c.deleted) {
        rc = createComposer({ mode: 'reply', people, onSubmit: async ({ html, name }) => { await api.addComment(env, { anchor, parentId: c.id, author: name, body: html }); replying = null; await refresh(true); }, onCancel: () => { replying = null; draw(); } });
        items.push(rc);
      }
      return h('div.cm-thread', it.el, ...events(c.id), rep.length || rc ? h('div.cm-reply', rep, rc?.el) : null);
    });
    list.replaceChildren(...(nodes.length ? nodes : loaded ? [h('div.cm-empty', hiddenN ? 'No open comments: every discussion is resolved.' : 'No comments yet. Start the discussion.')] : []));
    list.hidden = !nodes.length && !loaded;
    const top = vis.comments.filter((c) => !c.deleted).length, replies = vis.count - top;
    count.textContent = `(${vis.count})`;
    showBtn.hidden = !hiddenN; showBtn.setAttribute('aria-pressed', String(showResolved)); showBtn.textContent = `${showResolved ? 'Hide' : 'Show'} resolved (${hiddenN})`;
    hint.textContent = vis.count ? `${plural(top, 'comment')}${replies ? ` and ${plural(replies, 'reply')}` : ''}, oldest first` : loaded ? '· Add' : '';
    if (!composer) {
      composer = createComposer({ mode: 'new', people, step: stepNow, onSubmit: async ({ html, step, name }) => { await api.addComment(env, { anchor, step, author: name, body: html }); await refresh(true); } });
      tail.replaceChildren(h('div.cm-compose', h('span.cm-me'), composer.el)); drawMe();
    }
    mark();
    const r = replying !== null ? list.querySelector('.cm-composer.reply') : null; r?.querySelector('[data-qa=rte]')?.focus();
  }

  /** The first time the thread is open and loaded: the mentions of me that are unread get a "new" mark, and are marked seen after 2 seconds on screen. */
  async function consider() {
    const u = me();
    if (considered || !el.open || !loaded || !u) return;
    considered = true;
    const r = await api.mentions({ user: u.id, unread: true, env, anchor }).catch(() => null);
    if (!r?.mentions.length) return;
    r.mentions.forEach((m) => fresh.add(m.commentId));
    if (!busy()) draw();
    setTimeout(async () => { if (!el.isConnected) return; await api.seenMentions(u.id, r.mentions.map((m) => m.commentId)).catch(() => {}); announceSeen(); }, 2000);
  }

  /** Load the thread. While a reply or an edit is open the list is left as it is (its text must not be lost); `force` redraws anyway (the person's own save or post). */
  async function refresh(force = false) {
    const mine = ++seq;
    try {
      const t = await api.comments(env, anchor);
      if (mine !== seq) return;
      thread = t; own = true; store.setComments(t.comments); own = false;
      if (!loaded) { const open = startsOpen({ count: visibleThread(t, false).count, remembered: read(), stepKey: walk.picked() ? walk.steps()[walk.current() - 1]?.key : null, comments: t.comments }); if (open !== el.open) { auto = true; el.open = open; } }
      loaded = true;
      if (force || !busy()) draw();
      consider();
      onCount?.(t.count);
    } catch (e) {
      if (mine === seq && !loaded) { loaded = true; list.replaceChildren(h('div.cm-empty', `Comments could not be loaded: ${e.message}`)); list.hidden = false; }
    }
  }

  const onFocus = () => { if (document.visibilityState !== 'hidden') refresh(); };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  let sig = '';
  const unwatch = walk.watch(() => { // a step moved: the composer's "Attach to step N"; the pills only when the walk's steps themselves changed
    composer?.refreshStep();
    const now = walk.steps().map((s) => s.key).join('|');
    if (now !== sig) { sig = now; if (loaded && !busy()) draw(); }
  });
  const off = store.on(() => { // the items changed: events and the button redraw the list (not over an open reply or edit); a "#n" or "from X" link scrolls here
    if (own) return;
    if (store.commentFocus != null) { if (!el.open) el.open = true; const c = list.querySelector(`.cm[data-id="${store.commentFocus}"]`); if (c) { c.scrollIntoView({ block: 'nearest' }); c.classList.add('flash'); clearTimeout(flash); flash = setTimeout(() => c.classList.remove('flash'), 2200); } return; }
    if (loaded && !busy()) draw(); else mark();
  });
  refresh(true);
  return { el, refresh, dispose: () => { off(); offUsers(); clearTimeout(flash); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); unwatch(); items.forEach((i) => i.dispose()); composer?.dispose(); } };
}
