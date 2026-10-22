// The sign-in (0.32.0, frame 18e read as the sign-in): pick a user from the registry (search) or add yourself ("I am new"). There are no
// passwords; the choice is the login and is remembered on this browser. Shown from the rail's user button and, once, when a viewer does
// anything that writes while nobody is signed in: `ensureUser()` resolves with the user (then the action continues) or rejects when cancelled.

import { h } from '../dom.js';
import { api } from '../api.js';
import { filterUsers, matchUser, pickable, MAX_USER_NAME } from '../../core/users-match.js';
import { userAvatar } from './avatar.js';
import { loadUsers, me, remember, users } from './directory.js';
import { legacyName, setMyId } from './me.js';

let open = null; // the one dialog that may be open: its promise

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const detail = (u, suggested) => [u.counts ? plural(u.counts.comments, 'comment') : null, suggested ? 'remembered name on this browser' : null, u.externalIds?.length ? u.externalIds.map((e) => e.source).join(', ') : null].filter(Boolean).join(' · ');

/** signIn({ reason }) -> Promise<user | null>: null when cancelled. Reuses the dialog that is already open. */
export function signIn({ reason = '' } = {}) {
  if (open) return open;
  open = new Promise((resolve) => {
    let q = '', pick = me()?.id ?? null, fresh = '', busy = false;
    const old = legacyName();
    const guess = old ? matchUser(users(), { name: old })?.user ?? null : null;
    if (!pick && guess) pick = guess.id;
    const search = h('input.input', { type: 'search', placeholder: 'Search…', 'aria-label': 'Search users', autocomplete: 'off', 'data-qa': 'su-search', on: { input: () => { q = search.value; draw(); } } });
    const nameIn = h('input.input', { type: 'text', placeholder: 'Your name', maxLength: MAX_USER_NAME, 'aria-label': 'Your name', autocomplete: 'off', 'data-qa': 'su-new', on: { input: () => { fresh = nameIn.value; if (fresh.trim()) pick = null; draw(false); }, focus: () => { if (fresh.trim()) { pick = null; draw(false); } } } });
    const list = h('div.u-who', { role: 'radiogroup', 'aria-label': 'Users' });
    const sug = h('div.u-sug', { hidden: true });
    const err = h('div.cm-err', { role: 'alert' });
    const go = h('button.btn.sm.primary', { type: 'button', 'data-qa': 'su-go', on: { click: () => submit() } }, 'Continue');
    const cancel = h('button.btn.sm', { type: 'button', 'data-qa': 'su-cancel', on: { click: () => done(null) } }, 'Cancel');
    const dlg = h('dialog.u-dialog', { 'aria-label': 'Sign in', on: { cancel: (e) => { e.preventDefault(); done(null); }, mousedown: (e) => { if (e.target === dlg) done(null); }, keydown: (e) => { if (e.key === 'Enter' && e.target !== cancel && !go.disabled && e.target.tagName !== 'BUTTON') { e.preventDefault(); submit(); } } } },
      h('header', h('h3', 'Sign in'), h('p', reason || 'There are no passwords yet. Picking a user only labels what you write, and is remembered on this browser.')),
      h('div.bd', sug, search, list,
        h('div.u-or', 'not in the list?'),
        h('label.u-wr.u-new', h('span.u-rad', { class: '' }), h('b', 'I am new:'), nameIn), err),
      h('footer', h('span.hint', 'Picking someone does not verify anything.'), cancel, go));
    const done = (u) => { dlg.close(); dlg.remove(); open = null; resolve(u); };
    function draw(rebuild = true) {
      const shown = filterUsers(pickable(users()), q);
      if (rebuild) list.replaceChildren(...shown.map((u) => {
        const on = pick === u.id;
        return h('div.u-wr', { role: 'radio', 'aria-checked': String(on), tabindex: 0, class: on ? 'on' : '', 'data-qa': 'su-user', 'data-id': u.id,
          on: { click: () => { pick = u.id; fresh = ''; nameIn.value = ''; draw(); }, keydown: (e) => { if (e.key === ' ') { e.preventDefault(); pick = u.id; draw(); } } } },
          h('span.u-rad', { class: on ? 'on' : '' }), userAvatar(u), h('div', h('b', u.name), h('small', detail(u, guess?.id === u.id))), guess?.id === u.id ? h('span.u-tag', 'suggested') : null);
      }), !shown.length ? h('div.u-none', users().length ? 'No user matches.' : 'No users yet.') : null);
      else list.querySelectorAll('.u-wr').forEach((r) => { const on = r.dataset.id === pick; r.classList.toggle('on', on); r.setAttribute('aria-checked', String(on)); r.querySelector('.u-rad')?.classList.toggle('on', on); });
      sug.hidden = !guess || !!me(); if (guess) sug.replaceChildren('From this browser: you were “', h('b', old), '” (the name remembered before users existed). Is that you? Pick it below, or pick another user.');
      const who = fresh.trim() ? fresh.trim() : users().find((u) => u.id === pick)?.name;
      go.textContent = who ? `Continue as ${who}` : 'Continue'; go.disabled = busy || !who;
    }
    async function submit() {
      if (go.disabled) return;
      busy = true; err.textContent = ''; draw(false);
      try {
        let u = users().find((x) => x.id === pick);
        if (!u) { u = await api.createUser({ name: fresh.trim(), match: true }); remember(u); } // an existing name is the same user, not a duplicate
        setMyId(u.id); await loadUsers(true);
        done(u);
      } catch (e) { busy = false; err.textContent = e.message || 'Could not sign in.'; draw(false); }
    }
    document.body.append(dlg);
    loadUsers().catch(() => {}).finally(() => { draw(); });
    draw();
    dlg.showModal();
    (pick ? list.querySelector('.u-wr.on') ?? search : search).focus();
  });
  return open;
}

/** The signed-in user; when nobody is, the sign-in opens first. Rejects (`cancelled`) when the viewer cancels: callers stop quietly. */
export async function ensureUser(reason) {
  await loadUsers().catch(() => {});
  const m = me();
  if (m) return m;
  const u = await signIn({ reason });
  if (!u) { const e = new Error('Sign in to continue.'); e.cancelled = true; throw e; }
  return u;
}
