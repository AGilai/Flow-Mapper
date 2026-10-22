// What the action items section and the comments thread of one flow share (0.29.0): the loaded items and events, the comments the thread has
// loaded (for "from X's comment" and the owner suggestions), the new row that is open (`draft`: nothing saved yet), and the row to scroll to.
// It loads again after every change of its own and when the window is focused again, like the thread (the UI has no push channel;
// action_item.* events are on /api/events for agents).

import { api } from '../api.js';

/** createItemStore({ env, anchor }) -> store */
export function createItemStore({ env, anchor }) {
  let data = { items: [], events: [] }, comments = [], draft = null, loaded = false, seq = 0, error = '';
  const subs = new Set();
  const emit = () => subs.forEach((f) => f());
  const store = {
    get items() { return data.items; }, get events() { return data.events; }, get comments() { return comments; }, get draft() { return draft; },
    get loaded() { return loaded; }, get error() { return error; },
    on: (f) => { subs.add(f); return () => subs.delete(f); },
    setComments: (c) => { comments = c; emit(); },
    /** Open the new-item row: `prefill` { description, step, commentId, commentAuthor } or nothing. */
    startNew: (prefill = {}) => { draft = { ...prefill }; emit(); },
    cancelNew: () => { draft = null; emit(); },
    /** Scroll to a row: the section listens (it opens, unfolds and outlines it). */
    focus: (number) => { store.focusing = number; emit(); store.focusing = null; },
    focusing: null,
    /** Scroll to a comment of the thread (the thread listens). */
    focusComment: (id) => { store.commentFocus = id; emit(); store.commentFocus = null; },
    commentFocus: null,
    get next() { return data.next ?? data.items.reduce((m, i) => Math.max(m, i.number), 0) + 1; },
    async refresh() {
      const mine = ++seq;
      try {
        const d = await api.actionItems(env, anchor);
        if (mine !== seq) return;
        data = d; loaded = true; error = '';
      } catch (e) { if (mine !== seq) return; loaded = true; error = e.message; }
      emit();
    },
    async add(body) { const r = await api.addActionItem(env, { anchor, ...body }); draft = null; await store.refresh(); return r; },
    async update(id, body) { const r = await api.editActionItem(env, id, body); await store.refresh(); return r; },
    async remove(id, actor) { await api.deleteActionItem(env, id, actor); await store.refresh(); },
  };
  const onFocus = () => { if (document.visibilityState !== 'hidden') store.refresh(); };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  store.dispose = () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); subs.clear(); };
  return store;
}
