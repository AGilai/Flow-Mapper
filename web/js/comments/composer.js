// The composer (0.27.0, frame 13): a quiet "Add a comment…" box that opens into the editor. It never asks for a name (0.31.0): it writes as the
// signed-in user, and Post opens the sign-in first when nobody is. Post and Cancel, Ctrl/Cmd+Enter posts, Esc cancels (a menu first).
// Modes: 'new' (collapsed to start with, "Attach to step N" while a step is selected), 'reply' (open, under its comment) and 'edit' (open, in place).

import { h } from '../dom.js';
import { createEditor } from './rte.js';
import { createToolbar } from './rte-toolbar.js';
import { ensureUser } from '../users/signin.js';
import { myName, watchUsers } from '../users/directory.js';

/**
 * createComposer({ mode, html, step, onSubmit({ html, step, name, user }), onCancel }) -> { el, refreshStep(), focus(), dispose() }
 * step: () => { n, key } | null, the walk's current step (for "Attach to step N"). onSubmit may throw: the message is shown and the text stays.
 */
export function createComposer({ mode = 'new', html = '', step = () => null, people, onSubmit, onCancel }) {
  const edit = mode === 'edit', quiet = mode === 'new';
  let open = !quiet, busy = false, attach = true, ed = null, tb = null;
  const el = h(`div.cm-composer.${mode}`);
  const err = h('div.cm-err', { role: 'alert' });

  const who = h('div.asname');
  function drawWho() { // "Commenting as X" once signed in; nothing to ask
    const n = myName();
    who.hidden = edit || !n;
    who.replaceChildren(n ? h('span.cm-hint', 'Commenting as ', h('b', n)) : '');
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
  function sync() { post.disabled = busy || !ed || ed.isEmpty(); cancel.disabled = busy; tb?.update(); }

  async function submit() {
    if (post.disabled) return;
    const body = ed.getHtml();
    if (!body) return;
    const s = mode === 'new' && attach ? step() : null;
    busy = true; err.textContent = ''; sync();
    try { const user = edit ? null : await ensureUser('Sign in to post. There are no passwords yet: picking a user only labels what you write.'); await onSubmit({ html: body, step: s?.key ?? null, name: user?.name ?? myName(), user }); busy = false; drawWho(); if (quiet) { dispose(); open = false; draw(); } } catch (e) { busy = false; err.textContent = e.cancelled ? '' : e.message || 'Could not save the comment.'; sync(); }
  }
  function close() { if (busy) return; if (quiet) { dispose(); open = false; draw(); const b = el.querySelector('.cm-quiet'); b?.focus(); } else onCancel?.(); }
  function dispose() { tb?.dispose(); ed?.dispose(); ed = tb = null; }

  function draw() {
    err.textContent = '';
    if (!open) {
      el.replaceChildren(h('button.cm-quiet', { type: 'button', 'data-qa': 'cm-open', on: { click: () => { open = true; draw(); ed.focus(); } } }, 'Add a comment…'),
        h('div.cm-hint.cm-as', myName() ? ['Commenting as ', h('b', myName())] : 'You sign in when you post.'));
      return;
    }
    ed = createEditor({ html, label: edit ? 'Edit comment' : 'Comment', placeholder: edit ? '' : 'Write a comment…', onSubmit: submit, onEscape: () => { if (!tb.closeMenu()) close(); }, onChange: sync, people });
    tb = createToolbar(ed);
    const wrap = h('div.rte-wrap', tb.el, ed.el, foot);
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); if (!tb.closeMenu()) close(); } });
    drawWho();
    el.replaceChildren(who, wrap, err);
    syncStep(); sync();
  }
  let seen = false;
  const off = watchUsers(() => { if (el.isConnected) { seen = true; if (!open) draw(); else drawWho(); } else if (seen) off(); }); // "Commenting as X" follows a switch of user
  draw();
  return { el, refreshStep: syncStep, focus: () => ed?.focus?.(), dispose };
}
