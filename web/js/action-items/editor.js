// The editing row of an action item (0.29.0, frames 15b and 15d), for a new item and for Edit: owner with name suggestions, a description
import { hiddenPill } from '../views/flow-hidden-pill.js';
// textarea, status, due date, the step pill, Save / Cancel. Enter saves, Shift+Enter is a new line, Esc cancels (the suggestions first).
// It never asks for a name (0.32.0): Save acts as the signed-in user (the sign-in opens first when nobody is).

import { h } from '../dom.js';
import { ensureUser } from '../users/signin.js';
import { STATUS, suggest } from './pure.js';

/**
 * createEditor({ item, number, prefill, names, stepNow, stepOf, onSave(body), onCancel }) -> { el, focus() }
 * item: the item being edited, or null for a new one. prefill: { description, step, commentId, commentAuthor } for a new one.
 * stepNow(): the walk's selected step { n, key } or null. stepOf(key): { n } | null. onSave may throw: the message is shown and the row stays.
 */
export function createEditor({ item, number, prefill = {}, names = [], stepNow = () => null, stepOf = () => null, hidden = () => null, onSave, onCancel }) {
  const fresh = !item;
  let stepKey = fresh ? (prefill.commentId != null ? prefill.step ?? null : prefill.step ?? stepNow()?.key ?? null) : item.step, busy = false, pick = -1;
  const owner = h('input.ai-in', { type: 'text', value: item?.owner ?? '', placeholder: 'Owner', maxLength: 80, autocomplete: 'off', 'aria-label': 'Owner', 'data-qa': 'ai-owner', role: 'combobox', 'aria-expanded': 'false' });
  const desc = h('textarea.ai-in.ta', { rows: 2, value: item?.description ?? prefill.description ?? '', placeholder: 'What needs doing?', maxLength: 2000, 'aria-label': 'Description', 'data-qa': 'ai-desc' });
  const status = h('select.ai-in.ai-sel', { 'aria-label': 'Status', 'data-qa': 'ai-status' }, ...Object.entries(STATUS).map(([k, v]) => h('option', { value: k, selected: (item?.status ?? 'open') === k }, v)));
  const due = h('input.ai-in.ai-date', { type: 'date', value: item?.due ?? '', 'aria-label': 'Due date (optional)', 'data-qa': 'ai-due' });
  const err = h('div.cm-err', { role: 'alert' });
  const sug = h('div.ai-sug', { role: 'listbox', hidden: true });
  const meta = h('div.ai-meta');
  const save = h('button.btn.sm.primary', { type: 'button', 'data-qa': 'ai-save', on: { click: () => submit() } }, 'Save');
  const cancel = h('button.btn.sm', { type: 'button', 'data-qa': 'ai-cancel', on: { click: () => onCancel() } }, 'Cancel');
  const keys = h('div.ai-keys', save, cancel, h('span', 'Enter saves · Esc cancels'));
  const el = h('div.ai-r.edit', { 'data-qa': 'ai-editor', 'data-number': fresh ? '' : item.number },
    h('span.ai-n', { style: { paddingTop: '6px' } }, `#${fresh ? number : item.number}`),
    h('div', { style: { position: 'relative' } }, owner, sug),
    h('div', { style: { gridColumn: '3 / -1' } }, desc, meta, keys, err));

  function drawMeta() {
    const s = stepKey ? stepOf(stepKey) : null, hid = stepKey && !s ? hidden(stepKey) : null, now = stepNow();
    meta.replaceChildren(...[status, due,
      stepKey ? (s ? h('span.spill', { title: `Step ${s.n}` }, `step ${s.n}`) : hid ? hiddenPill(hid) : h('span.spill', { title: 'A step that is no longer in the flow' }, 'step (gone)')) : null,
      stepKey ? h('button.lnk', { type: 'button', 'data-qa': 'ai-unstep', on: { click: () => { stepKey = null; drawMeta(); } } }, 'remove step') : now ? h('button.lnk', { type: 'button', 'data-qa': 'ai-attach', on: { click: () => { stepKey = now.key; drawMeta(); } } }, `attach to step ${now.n}`) : null,
      stepKey && fresh && !prefill.step && stepKey === now?.key ? h('span', 'attached to the selected step') : null,
      prefill.commentAuthor ? h('span', `from ${prefill.commentAuthor}’s comment`) : null].filter(Boolean));
  }
  function sync() { save.disabled = busy || !owner.value.trim() || !desc.value.trim(); cancel.disabled = busy; }

  function drawSug() {
    const list = suggest(names, owner.value).slice(0, 6);
    sug.hidden = !list.length || document.activeElement !== owner; owner.setAttribute('aria-expanded', String(!sug.hidden));
    pick = Math.min(pick, list.length - 1);
    sug.replaceChildren(...list.map((n, i) => h('div', { role: 'option', class: i === pick ? 'on' : '', on: { mousedown: (e) => { e.preventDefault(); choose(n); } } }, n, h('small', 'recent'))));
    return list;
  }
  function choose(n) { owner.value = n; sug.hidden = true; pick = -1; sync(); desc.focus(); }

  async function submit() {
    if (save.disabled) return;
    busy = true; err.textContent = ''; sync();
    try { const user = await ensureUser('Sign in to save. There are no passwords yet: picking a user only labels what you write.'); await onSave({ owner: owner.value.trim(), description: desc.value.trim(), status: status.value, due: due.value || null, step: stepKey, name: user.name }); } catch (e) { busy = false; err.textContent = e.cancelled ? '' : e.message || 'Could not save the action item.'; sync(); }
  }
  const onKey = (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!sug.hidden) { sug.hidden = true; return; } onCancel(); return; }
    if (e.key === 'Enter' && !e.shiftKey && e.target !== status && e.target.tagName !== 'BUTTON') {
      if (e.target === owner && !sug.hidden && pick >= 0) { e.preventDefault(); choose(drawSug()[pick]); return; }
      e.preventDefault(); submit();
    }
  };
  el.addEventListener('keydown', onKey);
  owner.addEventListener('input', () => { pick = -1; drawSug(); sync(); });
  owner.addEventListener('focus', drawSug);
  owner.addEventListener('blur', () => { sug.hidden = true; });
  owner.addEventListener('keydown', (e) => {
    if (sug.hidden || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault(); const n = drawSug().length; pick = ((pick + 1 + (e.key === 'ArrowDown' ? 1 : -1) + n + 1) % (n + 1)) - 1; drawSug();
  });
  desc.addEventListener('input', sync);
  drawMeta(); sync();
  return { el, focus: () => (owner.value ? desc : owner).focus(), refreshStep: drawMeta };
}
