// The composer (0.27.0, frame 13): a quiet "Add a comment…" box that opens into the editor; "Comment as" is asked once (the name is the bug
// dialog's remembered reporter), then "Commenting as X · change". Post and Cancel, Ctrl/Cmd+Enter posts, Esc cancels (a menu first).
// Modes: 'new' (collapsed to start with, "Attach to step N" while a step is selected), 'reply' (open, under its comment) and 'edit' (open, in place).

import { h } from '../dom.js';
import { createEditor } from './rte.js';
import { createToolbar } from './rte-toolbar.js';
import { initials } from './pure.js';

const KEY = 'flow-mapper.reporter'; // shared with the bug dialog: the name is asked once for both
export const remembered = () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
export const remember = (n) => { try { localStorage.setItem(KEY, n); } catch { /* storage unavailable */ } };
export const avatar = (name) => h('div.av', { 'aria-hidden': 'true', title: name ?? '' }, initials(name));

/**
 * createComposer({ mode, html, step, onSubmit({ html, step, name }), onCancel }) -> { el, refreshStep(), focus(), dispose() }
 * step: () => { n, key } | null, the walk's current step (for "Attach to step N"). onSubmit may throw: the message is shown and the text stays.
 */
export function createComposer({ mode = 'new', html = '', step = () => null, onSubmit, onCancel }) {
  const edit = mode === 'edit', quiet = mode === 'new';
  let name = remembered(), asking = !name, open = !quiet, busy = false, attach = true, ed = null, tb = null;
  const el = h(`div.cm-composer.${mode}`);
  const err = h('div.cm-err', { role: 'alert' });

  const nameInput = h('input.input', { type: 'text', placeholder: 'Your name', maxLength: 80, 'aria-label': 'Your name', value: name, 'data-qa': 'cm-name', on: { input: () => { name = nameInput.value.trim(); sync(); } } });
  const who = h('div.asname');
  function drawWho() {
    if (edit) { who.hidden = true; return; }
    who.hidden = false;
    who.replaceChildren(...(asking
      ? ['Comment as ', nameInput, h('span.cm-hint', 'remembered on this browser')]
      : [h('span.cm-hint', 'Commenting as ', h('b', name), ' · ', h('a', { href: '#', 'data-qa': 'cm-change', on: { click: (e) => { e.preventDefault(); asking = true; drawWho(); nameInput.focus(); nameInput.select(); } } }, 'change'))]));
  }

  const tog = h('button.tog', { type: 'button', role: 'switch', 'aria-checked': 'true', 'data-qa': 'cm-attach', on: { click: () => { attach = !attach; syncStep(); } } }, h('i'), h('span.tl'));
  const post = h('button.btn.sm.primary', { type: 'button', 'data-qa': 'cm-post', on: { click: () => submit() } }, edit ? 'Save' : mode === 'reply' ? 'Reply' : 'Post');
  const cancel = h('button.btn.sm', { type: 'button', 'data-qa': 'cm-cancel', on: { click: () => close() } }, 'Cancel');
  const foot = h('div.rte-foot', tog, h('span.sp', h('span.cm-hint.keys', `Ctrl/Cmd + Enter to ${edit ? 'save' : 'post'}`), cancel, post));
  function syncStep() {
    const s = quiet || mode === 'new' ? step() : null;
    tog.hidden = !s;
    if (s) { tog.setAttribute('aria-checked', String(attach)); tog.classList.toggle('on', attach); tog.querySelector('.tl').textContent = `Attach to step ${s.n}`; }
  }
  function sync() { post.disabled = busy || !ed || ed.isEmpty() || (!edit && !name); cancel.disabled = busy; tb?.update(); }

  async function submit() {
    if (post.disabled) return;
    const body = ed.getHtml();
    if (!body) return;
    const s = mode === 'new' && attach ? step() : null;
    busy = true; err.textContent = ''; sync();
    if (!edit && asking) remember(name);
    try { await onSubmit({ html: body, step: s?.key ?? null, name }); busy = false; asking = false; if (quiet) { dispose(); open = false; draw(); } } catch (e) { busy = false; err.textContent = e.message || 'Could not save the comment.'; sync(); }
  }
  function close() { if (busy) return; if (quiet) { dispose(); open = false; draw(); const b = el.querySelector('.cm-quiet'); b?.focus(); } else onCancel?.(); }
  function dispose() { tb?.dispose(); ed?.dispose(); ed = tb = null; }

  function draw() {
    err.textContent = '';
    if (!open) {
      el.replaceChildren(h('button.cm-quiet', { type: 'button', 'data-qa': 'cm-open', on: { click: () => { open = true; draw(); ed.focus(); } } }, 'Add a comment…'),
        h('div.cm-hint.cm-as', name ? ['Commenting as ', h('b', name), ' · ', h('a', { href: '#', on: { click: (e) => { e.preventDefault(); asking = true; open = true; draw(); nameInput.focus(); } } }, 'change')] : 'Your name is asked when you post.'));
      return;
    }
    ed = createEditor({ html, label: edit ? 'Edit comment' : 'Comment', placeholder: edit ? '' : 'Write a comment…', onSubmit: submit, onEscape: () => { if (!tb.closeMenu()) close(); }, onChange: sync });
    tb = createToolbar(ed);
    const wrap = h('div.rte-wrap', tb.el, ed.el, foot);
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); if (!tb.closeMenu()) close(); } });
    drawWho();
    el.replaceChildren(who, wrap, err);
    syncStep(); sync();
    if (asking && !edit && !name) setTimeout(() => nameInput.focus(), 0);
  }
  draw();
  return { el, refreshStep: syncStep, focus: () => (asking && !name ? nameInput : ed)?.focus?.(), dispose };
}
