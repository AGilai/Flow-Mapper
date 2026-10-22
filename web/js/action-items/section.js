// The "Action items (3 open · 5)" section above Comments (0.29.0, frame 15): a collapsible box (open state remembered per viewer) with the table,
// the new-item row, the fold of closed rows, and nothing at all when the flow has no items and no new row is open. It shares a store with
// the comments thread: "Make action item" there opens the new row here, and the events here show under the comment there.

import { h } from '../dom.js';
import { isOpen } from '../../core/action-items.js';
import { myName, users } from '../users/directory.js';
import { actionRow } from './row.js';
import { createEditor } from './editor.js';
import { todayLocal, ownerNames } from './pure.js';

const OPEN = 'flow-mapper.action-items-open';
const read = () => { try { return localStorage.getItem(OPEN) !== '0'; } catch { return true; } };
const write = (v) => { try { localStorage.setItem(OPEN, v ? '1' : '0'); } catch { /* storage unavailable */ } };

/**
 * createActionItems({ store, walk }) -> { el, dispose() }
 * pane (0.34.0): the tab pane's hub ({ shown(), reveal(), set(data) }); the items are then a tab panel with an empty state (no summary, no fold).
 * walk: the tab's step walk ({ steps(), current(), picked(), go(n), watch(fn) }).
 */
export function createActionItems({ store, walk, pane = null }) {
  const title = h('span.cm-t', 'Action items'), count = h('span.muted.sm', ''), add = h('button.abtn', { type: 'button', 'data-qa': 'ai-add', on: { click: (e) => { e.preventDefault(); if (!store.draft) store.startNew(); else focusEditor(); } } }, '+ Add');
  const table = h('div.ai-t'), fold = h('button.ai-fold', { type: 'button', 'data-qa': 'ai-fold', on: { click: () => { showClosed = !showClosed; draw(); } } });
  const empty = h('div.cm-empty', { 'data-qa': 'ai-empty', hidden: true }, 'No action items for this flow. Add one with + Add action item.');
  const el = pane ? h('div.cm-sec.ai-sec.ai-pane', { 'data-qa': 'action-items' }, empty, table, fold) : h('details.cm-sec.ai-sec', { open: read(), hidden: true, 'data-qa': 'action-items' }, h('summary', title, count, add), table, fold);
  let showClosed = false, editing = null, hl = 0, editor = null, draftRef = null;
  const editors = new Map(); // item id -> its open editor: a redraw (a refresh, a focus) keeps what was typed
  if (!pane) el.addEventListener('toggle', () => write(el.open));
  const reveal = () => { if (pane) pane.reveal(); else if (!el.open) el.open = true; };

  const stepNow = () => { const s = walk.picked() ? walk.steps()[walk.current() - 1] : null; return s ? { n: s.n, key: s.key } : null; };
  const stepOf = (key) => { const s = walk.steps().find((x) => x.key === key); return s ? { n: s.n } : null; };
  const me = () => myName();
  const commentOf = (id) => { let f = null; const walkc = (c) => { if (c.id === id) f = c; (c.replies ?? []).forEach(walkc); }; store.comments.forEach(walkc); return f; };
  const focusEditor = () => { editor?.focus(); };
  const names = () => { const seen = ownerNames({ me: me(), comments: store.comments, items: store.items }); for (const u of users()) if (!seen.includes(u.name)) seen.push(u.name); return seen; };

  function draw() {
    const items = store.items, d = store.draft;
    const none = !items.length && !d;
    if (pane) { empty.hidden = !none; table.hidden = none; fold.hidden = none; pane.set({ open: items.filter((i) => isOpen(i.status)).length + (d ? 1 : 0), all: items.length + (d ? 1 : 0) }); } else el.hidden = none;
    if (none) { editors.clear(); editor = null; draftRef = null; return; }
    const open = items.filter((i) => isOpen(i.status)).length + (d ? 1 : 0), all = items.length + (d ? 1 : 0);
    count.textContent = items.length || !d ? `(${open} open · ${all})` : '(1 open)';
    add.style.opacity = d ? '.5' : '';
    const x = { today: todayLocal(), commentOf, stepOf, jump: (n) => walk.go(n), toComment: (id) => store.focusComment(id), edit: (it) => { editing = it.id; draw(); editors.get(it.id)?.focus(); }, remove: (it) => store.remove(it.id, me()) };
    const rows = (showClosed ? items : items.filter((i) => isOpen(i.status) || i.id === editing)).map((it) => {
      if (editing !== it.id) return actionRow(it, x).el;
      if (!editors.has(it.id)) editors.set(it.id, createEditor({ item: it, names: names(), stepNow, stepOf, onCancel: () => { editors.delete(it.id); editing = null; draw(); }, onSave: async (b) => { await store.update(it.id, { actor: b.name, owner: b.owner, description: b.description, status: b.status, due: b.due, step: b.step }); editors.delete(it.id); editing = null; draw(); } }));
      return editors.get(it.id).el;
    });
    for (const id of [...editors.keys()]) if (id !== editing) editors.delete(id);
    if (d) {
      if (draftRef !== d) { draftRef = d; editor = createEditor({ item: null, number: store.next, prefill: d, names: names(), stepNow, stepOf, onCancel: () => { editor = null; draftRef = null; store.cancelNew(); }, onSave: async (b) => { await store.add({ owner: b.owner, description: b.description, status: b.status, due: b.due, step: b.step, commentId: d.commentId ?? null, actor: b.name }); editor = null; draftRef = null; } }); reveal(); setTimeout(() => editor?.focus(), 0); }
      rows.push(editor.el);
    } else { editor = null; draftRef = null; }
    table.replaceChildren(h('div.ai-r.h', h('span', '#'), h('span', 'Owner'), h('span', 'Description'), h('span', 'Due'), h('span', 'Status'), h('span')), ...rows);
    const closed = items.filter((i) => !isOpen(i.status)).length;
    fold.hidden = !closed;
    fold.textContent = showClosed ? '▾ Hide closed' : `▸ Show ${closed} closed`;
    fold.setAttribute('aria-expanded', String(showClosed));
  }

  function goTo(number) { // "#4" in the thread: open the section, unfold, scroll to the row and outline it
    reveal();
    const it = store.items.find((i) => i.number === number);
    if (it && !isOpen(it.status) && !showClosed) { showClosed = true; draw(); }
    const row = table.querySelector(`.ai-r[data-number="${number}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    row.classList.add('hl'); clearTimeout(hl); hl = setTimeout(() => { row.classList.remove('hl'); hl = 0; }, 2200);
  }
  const off = store.on(() => { if (store.focusing != null) goTo(store.focusing); else draw(); });
  const unwatch = walk.watch(() => { // a step moved: the editors' step pill; the rows' pills when the walk's steps changed
    editors.forEach((e) => e.refreshStep?.()); editor?.refreshStep?.();
    if (editing == null && !store.draft && (pane || !el.hidden) && !table.querySelector('.cm-ask')) draw();
  });
  draw();
  const addNew = () => { reveal(); if (!store.draft) store.startNew(); else focusEditor(); };
  return { el, add: addNew, dispose: () => { off(); unwatch(); clearTimeout(hl); } };
}
