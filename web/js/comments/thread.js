// The "Comments (n)" section under a flow's description (0.27.0, frame 13): a collapsible box (open state remembered per viewer), the thread
// oldest first with one level of replies, the empty state, and the composer at the end. It loads the thread of one flow, loads it again
// after every change of its own and when the window is focused again (the UI has no push channel; comment.* events are on /api/events for
// agents), and redraws when the walk's steps are known or change (the step pills read them).

import { h } from '../dom.js';
import { api } from '../api.js';
import { flowAnchor, cleanName } from '../../core/comments.js';
import { commentItem } from './comment.js';
import { createComposer, avatar, remembered } from './composer.js';
import { startsOpen, relTime, fullDate } from './pure.js';
import { prefill, stripTables, eventParts } from '../action-items/pure.js';
import { sanitize, plainText } from '../../core/rich-text.js';

const OPEN = 'flow-mapper.comments-open';
const read = () => { try { const v = localStorage.getItem(OPEN); return v === null ? true : v === '1'; } catch { return true; } };
const write = (v) => { try { localStorage.setItem(OPEN, v ? '1' : '0'); } catch { /* storage unavailable */ } };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * createComments({ env, root: { service, ingress }, walk, store, onCount(n) }) -> { el, refresh(), dispose() }
 * store: the flow's action item store (0.29.0): "+ Action item", "Make action item", the events under a comment and the outline of the comment an item is being made from.
 * walk: the tab's step walk ({ steps(), current(), picked(), go(n), watch(fn) }): the pills, "Attach to step N" and the jump.
 */
export function createComments({ env, root, walk, store, onCount }) {
  const anchor = flowAnchor(root.service, root.ingress);
  let thread = { count: 0, comments: [] }, items = [], composer = null, replying = null, loaded = false, seq = 0, own = false, flash = 0;
  const title = h('span.cm-t', 'Comments'), count = h('span.muted.sm', '(0)'), hint = h('span.cm-hint.cm-sum');
  const list = h('div.cm-list'), tail = h('div.cm-tail');
  const addAi = h('button.abtn', { type: 'button', 'data-qa': 'cm-add-action', on: { click: (e) => { e.preventDefault(); store.startNew(); } } }, '+ Action item');
  const el = h('details.cm-sec', { open: false, 'data-qa': 'comments' }, h('summary', title, count, hint, addAi), list, tail);
  let auto = false; // the toggle the first load makes itself is not the viewer's choice
  el.addEventListener('toggle', () => { if (auto) { auto = false; return; } if (thread.count) write(el.open); });

  const stepOf = (key) => { const s = walk.steps().find((x) => x.key === key); return s ? { n: s.n } : null; };
  const stepNow = () => { const s = walk.picked() ? walk.steps()[walk.current() - 1] : null; return s ? { n: s.n, key: s.key } : null; };
  const busy = () => !!list.querySelector('.cm-editing, .cm-composer.reply');
  const run = async (fn) => { await fn(); await refresh(true); };
  const author = () => cleanName(remembered()); // as the server stores and compares it
  const api_ = {
    edit: (id, html) => run(() => api.editComment(env, id, { author: author(), body: html })),
    remove: (id) => run(() => api.deleteComment(env, id, author())),
    reply: (id) => { replying = replying === id ? null : id; draw(); },
    make: (n) => store.startNew({ description: prefill(plainText(stripTables(sanitize(n.body)))), step: n.step, commentId: n.id, commentAuthor: n.author }),
  };
  const events = (id) => store.events.filter((e) => e.commentId === id).map((e) => {
    const p = eventParts(e);
    return h('div.ai-ev', { 'data-qa': 'ai-event' }, h('span', h('b', e.actor), ` ${p.verb} `, h('button.lnk', { type: 'button', title: 'Show that action item', on: { click: () => store.focus(e.number) } }, `#${e.number}`), p.tail, ' \u00b7 ', h('span', { title: fullDate(e.at) }, relTime(e.at))));
  });
  /** The outline of the comment a new action item is being made from, and the "from X's comment" jump. */
  const mark = () => { addAi.hidden = !!store.items.length || !!store.draft || !loaded || !store.loaded; list.querySelectorAll('.cm[data-id]').forEach((c) => c.classList.toggle('hl', Number(c.dataset.id) === store.draft?.commentId)); };

  function draw() {
    items.forEach((i) => i.dispose()); items = [];
    const x = (top) => ({ me: author, step: stepOf, jump: (n) => walk.go(n), top, api: api_ });
    const nodes = thread.comments.map((c) => {
      const it = commentItem(c, x(true)); items.push(it);
      const rep = c.replies.flatMap((r) => { const ri = commentItem(r, x(false)); items.push(ri); return [ri.el, ...events(r.id)]; });
      let rc = null;
      if (replying === c.id && !c.deleted) {
        rc = createComposer({ mode: 'reply', onSubmit: async ({ html, name }) => { await api.addComment(env, { anchor, parentId: c.id, author: name, body: html }); replying = null; await refresh(true); }, onCancel: () => { replying = null; draw(); } });
        items.push(rc);
      }
      return h('div.cm-thread', it.el, ...events(c.id), rep.length || rc ? h('div.cm-reply', rep, rc?.el) : null);
    });
    list.replaceChildren(...(nodes.length ? nodes : loaded ? [h('div.cm-empty', 'No comments yet. Start the discussion.')] : []));
    list.hidden = !nodes.length && !loaded;
    const top = thread.comments.filter((c) => !c.deleted).length, replies = thread.count - top;
    count.textContent = `(${thread.count})`;
    hint.textContent = thread.count ? `${plural(top, 'comment')}${replies ? ` and ${plural(replies, 'reply')}` : ''}, oldest first` : loaded ? '· Add' : '';
    if (!composer) {
      composer = createComposer({ mode: 'new', step: stepNow, onSubmit: async ({ html, step, name }) => { await api.addComment(env, { anchor, step, author: name, body: html }); await refresh(true); } });
      tail.replaceChildren(h('div.cm-compose', avatar(remembered()), composer.el));
    }
    mark();
    const r = replying !== null ? list.querySelector('.cm-composer.reply') : null; r?.querySelector('[data-qa=rte]')?.focus();
  }

  /** Load the thread. While a reply or an edit is open the list is left as it is (its text must not be lost); `force` redraws anyway (the person's own save or post). */
  async function refresh(force = false) {
    const mine = ++seq;
    try {
      const t = await api.comments(env, anchor);
      if (mine !== seq) return;
      thread = t; own = true; store.setComments(t.comments); own = false;
      if (!loaded) { const open = startsOpen({ count: t.count, remembered: read(), stepKey: walk.picked() ? walk.steps()[walk.current() - 1]?.key : null, comments: t.comments }); if (open !== el.open) { auto = true; el.open = open; } }
      loaded = true;
      if (force || !busy()) draw();
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
  return { el, refresh, dispose: () => { off(); clearTimeout(flash); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); unwatch(); items.forEach((i) => i.dispose()); composer?.dispose(); } };
}
