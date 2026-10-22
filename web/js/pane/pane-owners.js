// Owners in the info pane (0.33.0, info pane extra 3): the Overview's "Owners" fact shows the structured `owners: [userId]` as user chips (the free-text `## Owners`
// section of the About stays); in Edit with a draft its pencil opens a small editor in place: chips with a remove button, a box that finds users (or makes one),
// Save to draft / Cancel. Saving sends the same component or subsystem edit the forms send, with `owners` only.

import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { me } from '../design/who.js';
import { afterEdit } from '../design/after-edit.js';
import { filterUsers, nameKey, pickable } from '../../core/users-match.js';
import { chip, refreshChips } from '../users/chips.js';
import { userAvatar } from '../users/avatar.js';
import { loadUsers, remember, userById, users } from '../users/directory.js';
import { ownersEdit, addOwner, removeOwner } from './pane-edit-pure.js';

/** The value of the Owners fact: a chip per owner (named by the registry), "None" when there are none, and the pencil (null outside a design). */
export function ownersValue(ids, pencil = null) {
  const box = h('span.pane-owners', { 'data-qa': 'owners-value' }, ids.length ? ids.map((id) => chip(id)) : h('span.muted', 'None'), pencil);
  if (ids.length) loadUsers().then(() => refreshChips(box)).catch(() => {});
  return box;
}

/** Replace the value box by the editor. `ctx`: { ids, target, header, onClose() }. Returns the editor's node. */
export function startOwnersEdit(box, { ids: first, target, header, onClose }) {
  let ids = [...first], busy = false, idx = 0;
  const chips = h('div.pane-ochips'), input = h('input.input', { type: 'text', placeholder: 'Add an owner by name', 'aria-label': 'Add an owner', autocomplete: 'off', 'data-qa': 'owners-input' });
  const list = h('div.pane-opick', { role: 'listbox', hidden: true }), err = h('div.error-box', { hidden: true, role: 'alert' });
  const save = h('button.btn.primary.sm', { type: 'button', 'data-qa': 'owners-save' }, 'Save to draft'), cancel = h('button.btn.sm', { type: 'button', 'data-qa': 'owners-cancel', on: { click: () => close() } }, 'Cancel');

  const name = (id) => userById(id)?.name ?? 'unknown user';
  const paintChips = () => chips.replaceChildren(...[...ids.map((id) => h('span.u-chip.pane-ochip', { 'data-user': id }, `@${name(id)}`, h('button', { type: 'button', 'aria-label': `Remove ${name(id)}`, title: `Remove ${name(id)}`, on: { click: () => { ids = removeOwner(ids, id); paintChips(); input.focus(); } } }, '×'))),
    ids.length ? null : h('span.muted.xs', 'No owners')].filter(Boolean));
  let items = [];
  function paintList() {
    const q = input.value.trim(), all = users(), found = filterUsers(pickable(all).filter((u) => !ids.includes(u.id)), q).slice(0, 6);
    items = [...found, ...(nameKey(q) && !all.some((u) => nameKey(u.name) === nameKey(q)) ? [{ fresh: q }] : [])];
    idx = Math.max(0, Math.min(idx, items.length - 1));
    list.hidden = !items.length || document.activeElement !== input;
    list.replaceChildren(...items.map((u, i) => h('div.u-pk', { role: 'option', 'aria-selected': String(i === idx), class: `${i === idx ? 'on' : ''} ${u.fresh ? 'new' : ''}`.trim(), 'data-qa': u.fresh ? 'owner-new' : 'owner-opt', on: { mousedown: (e) => { e.preventDefault(); pick(i); } } },
      u.fresh ? [h('span.plus', '+'), h('span', `New user “${u.fresh}”`), h('small')] : [userAvatar(u, 's'), h('b', u.name)])));
  }
  async function pick(i) {
    const it = items[i];
    if (!it || busy) return;
    let user = it;
    if (it.fresh) { busy = true; try { user = await api.createUser({ name: it.fresh, match: true }); remember(user); } catch (e) { busy = false; err.hidden = false; err.textContent = e.message; return; } busy = false; }
    ids = addOwner(ids, user.id); input.value = ''; idx = 0; paintChips(); list.hidden = true; input.focus(); // the list stays closed until the next key, so Save is not covered
  }
  input.addEventListener('input', () => { idx = 0; paintList(); });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
  input.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && list.hidden) paintList();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = items.length ? (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length : 0; paintList(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!list.hidden && items.length) pick(idx); else save.click(); }
    else if (e.key === 'Escape') { e.stopPropagation(); if (!list.hidden) { list.hidden = true; } else close(); }
    else if (e.key === 'Backspace' && !input.value && ids.length) { ids = removeOwner(ids, ids[ids.length - 1]); paintChips(); }
  });
  save.addEventListener('click', async () => {
    err.hidden = true; save.disabled = true;
    try { await api.designEdit(state.env, state.draft, ownersEdit(target, ids, header), me()); toast(`Saved to draft ${state.draft}`); onClose(true); afterEdit(); }
    catch (e) { save.disabled = false; err.hidden = false; err.textContent = e.message; }
  });
  const node = h('div.pane-oed', { 'data-qa': 'owners-editor' }, chips, h('div.pane-opw', input, list), err, h('div.pane-oacts', cancel, save));
  const prev = [...box.childNodes];
  function close(saved = false) { box.replaceChildren(...prev); onClose(saved); }
  box.replaceChildren(node);
  loadUsers().then(() => { paintChips(); }).catch(() => {});
  paintChips();
  input.focus();
  return node;
}
