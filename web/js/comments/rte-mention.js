// The "@" picker of the comment editor (0.32.0, frame 18a): typing "@" after a space (or at the start) opens an anchored list under the caret;
// the text after it narrows the list (people already in this thread first, then the rest by last seen); Up/Down choose, Enter or Tab insert a
// chip and a space, Esc closes and leaves the typed text as plain text. "+ New user" makes a user from the typed text. The toolbar's
// "@ Mention" button types the "@" for you. The chip is not editable text; the editor writes it back as the token `@[id]`.

import { h } from '../dom.js';
import { api } from '../api.js';
import { filterUsers, nameKey, pickable } from '../../core/users-match.js';
import { userAvatar } from '../users/avatar.js';
import { chip } from '../users/chips.js';
import { me, remember, users } from '../users/directory.js';
import { relTime } from './pure.js';

const TRIGGER = /(^|[\s ])@([^\s@[\]{}]{0,40})$/;

/** attachMention(ed, { people: () => [userId] }) -> { open(), close(), dispose() }. people: the users already in this thread (listed first). */
export function attachMention(ed, { people = () => [] } = {}) {
  let pop = null, at = null, items = [], idx = 0, busy = false; // at: { node, start, caret }
  const el = ed.el;

  const caretText = () => {
    const r = ed.range();
    if (!r || !r.collapsed || r.startContainer.nodeType !== 3 || r.startContainer.parentElement?.closest('.u-chip')) return null;
    return { node: r.startContainer, caret: r.startOffset, before: r.startContainer.nodeValue.slice(0, r.startOffset) };
  };
  function detect() {
    const c = caretText(), m = c && TRIGGER.exec(c.before);
    if (!m) return close();
    at = { node: c.node, start: c.caret - m[2].length - 1, caret: c.caret, q: m[2] };
    draw();
  }
  function close() { pop?.remove(); pop = null; at = null; }

  function list(q) {
    const here = new Set(people()), all = users();
    const found = filterUsers(pickable(all), q);
    const fresh = (a) => a.filter((u) => !here.has(u.id)), mine = found.filter((u) => here.has(u.id));
    const groups = [['Recent', mine], ['Everyone else', fresh(found)]].filter(([, l]) => l.length);
    return { groups, flat: groups.flatMap(([, l]) => l), canNew: !!nameKey(q) && !all.some((u) => nameKey(u.name) === nameKey(q)) };
  }
  const mark = (name, q) => { const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1; return i < 0 ? name : [name.slice(0, i), h('em', name.slice(i, i + q.length)), name.slice(i + q.length)]; };

  function draw() {
    const { groups, flat, canNew } = list(at.q);
    items = [...flat, ...(canNew ? [{ fresh: at.q }] : [])];
    idx = Math.max(0, Math.min(idx, items.length - 1));
    if (!items.length) return close();
    const rows = [];
    let n = 0;
    for (const [title, l] of groups) {
      rows.push(h('h5', title));
      for (const u of l) { const i = n++; rows.push(h('div.u-pk', { role: 'option', 'aria-selected': String(i === idx), class: i === idx ? 'on' : '', 'data-qa': 'mention-opt', on: { mousedown: (e) => { e.preventDefault(); choose(i); } } },
        userAvatar(u, 's'), h('b', mark(u.name, at.q)), h('small', me()?.id === u.id ? 'you' : u.externalIds?.[0]?.source ?? (u.lastSeenAt ? relTime(u.lastSeenAt) : '')))); }
    }
    if (canNew) { const i = n++; rows.push(h('div.u-pk.new', { role: 'option', 'aria-selected': String(i === idx), class: i === idx ? 'on' : '', 'data-qa': 'mention-new', on: { mousedown: (e) => { e.preventDefault(); choose(i); } } }, h('span.plus', '+'), h('span', `New user “${at.q}”`), h('small'))); }
    const box = h('div.u-pick', { role: 'listbox', 'aria-label': 'Mention someone' }, rows, h('div.u-keys', h('kbd', '↑'), ' ', h('kbd', '↓'), ' choose · ', h('kbd', 'Enter'), ' insert · ', h('kbd', 'Esc'), ' close'));
    pop ? pop.replaceWith(box) : document.body.append(box);
    pop = box;
    place();
  }
  function place() {
    const r = document.createRange();
    r.setStart(at.node, Math.min(at.start, at.node.nodeValue.length)); r.setEnd(at.node, Math.min(at.caret, at.node.nodeValue.length));
    const b = r.getClientRects()[0] ?? el.getBoundingClientRect(), w = Math.min(300, innerWidth - 16), up = b.bottom + 260 > innerHeight && b.top > 260;
    Object.assign(pop.style, { width: `${w}px`, left: `${Math.max(8, Math.min(b.left, innerWidth - w - 8))}px`, top: up ? 'auto' : `${b.bottom + 4}px`, bottom: up ? `${innerHeight - b.top + 4}px` : 'auto' });
    pop.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }

  async function choose(i) {
    const it = items[i];
    if (!it || busy || !at) return;
    const { node, start, caret } = at;
    let user = it;
    if (it.fresh) { busy = true; try { user = await api.createUser({ name: it.fresh, match: true }); remember(user); } catch { busy = false; return; } busy = false; }
    close();
    el.focus({ preventScroll: true });
    const r = document.createRange();
    r.setStart(node, Math.min(start, node.nodeValue.length)); r.setEnd(node, Math.min(caret, node.nodeValue.length)); r.deleteContents();
    const c = chip(user.id, { editable: true }), sp = document.createTextNode(' ');
    r.insertNode(c); c.after(sp);
    const s = getSelection(), nr = document.createRange();
    nr.setStart(sp, 1); nr.collapse(true); s.removeAllRanges(); s.addRange(nr);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const onKey = (e) => {
    if (!pop) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; draw(); }
    else if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); choose(idx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  };
  const onInput = () => { idx = 0; detect(); };
  const onMove = () => { if (pop) detect(); };
  el.addEventListener('keydown', onKey, true);
  el.addEventListener('input', onInput);
  el.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') onMove(); });
  el.addEventListener('blur', () => setTimeout(close, 120));
  return {
    open() { // the toolbar button: type an "@" (with a space before it when the caret follows a word)
      ed.exec((r) => { const c = r?.startContainer, prev = c?.nodeType === 3 ? c.nodeValue.slice(0, r.startOffset).slice(-1) : ''; document.execCommand('insertText', false, prev && !/\s/.test(prev) ? ' @' : '@'); });
    },
    close, dispose: close,
  };
}
