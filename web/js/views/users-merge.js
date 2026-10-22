// The merge dialog of the Users page (0.32.0, frame 18d): "Merge two users". The user on the left moves into the one on the right; the preview
// shows the result before anything changes; a radio swaps who survives (the default is the one with external ids, then the one with more
// activity). The old name stays as an alias. Nothing changes until "Merge".

import { h } from '../dom.js';
import { api } from '../api.js';
import { initials } from '../../core/users-match.js';
import { users } from '../users/directory.js';
import { currentId, setMyId } from '../users/me.js';
import { userAvatar } from '../users/avatar.js';
import { relTime } from '../comments/pure.js';
import { survivor } from './users-pure.js';

const line = (u) => { const c = u.counts ?? { comments: 0, items: 0, mentions: 0 }; return `${c.comments} comment${c.comments === 1 ? '' : 's'} · ${c.items} action${c.items === 1 ? '' : 's'} · ${c.mentions} mention${c.mentions === 1 ? '' : 's'}`; };
const ext = (u) => (u.externalIds?.length ? u.externalIds.map((e) => `${e.source} ${e.externalId}`).join(', ') : 'no external ids');

/** openMerge(user, { onDone, preferInto }) -> the dialog. `user` is the row's user; the other one is picked in the dialog. */
export function openMerge(from, { onDone, preferInto = null } = {}) {
  let other = preferInto ?? users().find((u) => u.id !== from.id), swap = false, busy = false;
  if (other) swap = survivor(from, other) === from; // the one that wins is kept: swap when the row's user wins
  const pick = h('select.select', { 'aria-label': 'Merge with', 'data-qa': 'mg-with', on: { change: () => { other = users().find((u) => u.id === pick.value); swap = survivor(from, other) === from; draw(); } } },
    users().filter((u) => u.id !== from.id).map((u) => h('option', { value: u.id, selected: u.id === other?.id }, u.name)));
  const body = h('div.bd'), err = h('div.cm-err', { role: 'alert' });
  const go = h('button.btn.sm.primary', { type: 'button', 'data-qa': 'mg-go', on: { click: () => submit() } }, 'Merge 2 users');
  const cancel = h('button.btn.sm', { type: 'button', on: { click: () => close() } }, 'Cancel');
  const dlg = h('dialog.u-dialog.u-merge', { 'aria-label': 'Merge users', on: { cancel: (e) => { e.preventDefault(); close(); }, mousedown: (e) => { if (e.target === dlg) close(); } } },
    h('header', h('h3', 'Merge two users'), h('p', 'Everything written by or addressed to the user on the left moves to the user on the right. This cannot be undone; the merge is logged.')),
    body, h('footer', h('span.hint', 'Nothing changes until you press Merge.'), cancel, go));
  const close = () => { dlg.close(); dlg.remove(); };
  const away = () => (swap ? other : from), keep = () => (swap ? from : other);
  const card = (u, keepIt) => h('div.u-card2', { class: keepIt ? 'keep' : '' }, h('span.tag', keepIt ? 'Keep' : 'Merge away'), h('span.u-own', userAvatar(u, 's'), u.name), h('small', line(u)), h('small', u.lastSeenAt ? `last seen ${relTime(u.lastSeenAt)}` : ext(u)), keepIt ? h('small', ext(u)) : null);
  function draw() {
    if (!other) { body.replaceChildren(h('p.muted', 'There is no other user to merge with.')); go.disabled = true; return; }
    const a = away(), k = keep(), ca = a.counts ?? { comments: 0, items: 0, mentions: 0 }, ck = k.counts ?? { comments: 0, items: 0, mentions: 0 };
    const ids = [...(k.externalIds ?? []), ...(a.externalIds ?? [])];
    body.replaceChildren(
      h('label.u-with', h('span', 'Merge ', h('b', from.name), ' with '), pick),
      h('div.u-mg', card(a, false), h('div.u-arrow', { 'aria-hidden': 'true' }, '→'), card(k, true)),
      h('div.u-res', h('div', h('span.k', 'After the merge'), h('b', line({ counts: { comments: ca.comments + ck.comments, items: ca.items + ck.items, mentions: ca.mentions + ck.mentions } }))),
        h('div', h('span.k', 'External ids'), ids.length ? ids.map((e) => `${e.source} ${e.externalId}`).join(', ') : 'none'),
        h('div', h('span.k', 'Name shown'), `${k.name} (the avatar colour of the kept user: ${initials(k.name)})`)),
      h('label.u-opt', h('input', { type: 'radio', name: 'mg', checked: !swap, 'data-qa': 'mg-keep-other', on: { change: () => { swap = false; draw(); } } }), h('span', `Keep “${other.name}”, merge “${from.name}” away`, h('small', `Old comments show “${other.name}”; typing @${from.name} or an importer sending that name still resolves to them: it stays as an alias on their row.`))),
      h('label.u-opt', h('input', { type: 'radio', name: 'mg', checked: swap, 'data-qa': 'mg-swap', on: { change: () => { swap = true; draw(); } } }), h('span', `Swap: keep “${from.name}”, merge “${other.name}” away`, h('small', 'Use when the old name is the one you want to see; external ids move with the user that is kept.'))), err);
    go.disabled = busy;
  }
  async function submit() {
    busy = true; err.textContent = ''; draw();
    try { const gone = away().id, kept = keep().id; await api.mergeUser(gone, kept); if (currentId() === gone) setMyId(kept); close(); await onDone?.(); } catch (e) { busy = false; err.textContent = e.message || 'Could not merge.'; draw(); }
  }
  document.body.append(dlg);
  draw();
  dlg.showModal();
  go.focus();
  return dlg;
}
