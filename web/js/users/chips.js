// Mention chips (0.31.0, frame 18b): a body holds `@[userId]` tokens (core/mentions.ts); the renderer turns each into a chip with the user's
// CURRENT name (a rename changes old comments), a filled chip for "you", a dashed "@unknown user" when the id has no user (never silently
// replaced by a name). Clicking a chip opens a small card. The editor draws the same chips (not editable) and writes the token back.

import { h } from '../dom.js';
import { splitMentions } from '../../core/mentions.js';
import { isMe, isLoaded, userById } from './directory.js';
import { userAvatar } from './avatar.js';

/** Name, class and title of a chip for `id` as the directory says now. */
function look(id) {
  const u = userById(id);
  if (u) return { text: `@${u.name}`, cls: isMe(id, null) ? 'me' : '', title: u.name, unknown: false };
  return isLoaded() ? { text: '@unknown user', cls: 'gone', title: 'This mention points at a user that does not exist', unknown: true } : { text: '@…', cls: 'pending', title: '', unknown: false };
}
/** Relabel a chip element after the directory changed. */
export function labelChip(el) {
  const l = look(el.dataset.user);
  el.textContent = l.text; el.title = l.title;
  el.classList.toggle('me', l.cls === 'me'); el.classList.toggle('gone', l.cls === 'gone'); el.classList.toggle('pending', l.cls === 'pending');
  if (l.unknown || el.dataset.mention) { el.removeAttribute('role'); el.removeAttribute('tabindex'); } else { el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); }
}

let card = null;
const closeCard = () => { card?.remove(); card = null; document.removeEventListener('pointerdown', outside, true); };
const outside = (e) => { if (card && !card.contains(e.target)) closeCard(); };
/** The small card a chip opens: face, name, aliases, external ids, what the user has written and been asked. */
export function openCard(chipEl) {
  closeCard();
  const u = userById(chipEl.dataset.user);
  if (!u) return;
  const r = chipEl.getBoundingClientRect(), c = u.counts;
  card = h('div.u-card', { role: 'dialog', 'aria-label': u.name, style: `left:${Math.max(8, Math.min(r.left, innerWidth - 268))}px;top:${Math.min(r.bottom + 6, innerHeight - 160)}px`, on: { keydown: (e) => { if (e.key === 'Escape') { closeCard(); chipEl.focus(); } } } },
    userAvatar(u, 'l'), h('div', h('b', u.name),
      u.aliases?.length ? h('small', `also ${u.aliases.join(', ')}`) : null,
      u.externalIds?.length ? h('small.mono', u.externalIds.map((e) => `${e.source} ${e.externalId}`).join(' · ')) : null,
      c ? h('small', `${c.comments} comment${c.comments === 1 ? '' : 's'} · ${c.mentions} mention${c.mentions === 1 ? '' : 's'}`) : null));
  document.body.append(card);
  document.addEventListener('pointerdown', outside, true);
}

/** One chip. `editable: true` is the editor's (not editable by itself, carries data-mention too). */
export function chip(id, { editable = false } = {}) {
  const el = h('span.u-chip', { 'data-user': id, ...(editable ? { contentEditable: 'false', 'data-mention': id } : {}) });
  labelChip(el);
  if (!editable) el.addEventListener('click', () => openCard(el));
  if (!editable) el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(el); } });
  return el;
}

/** Turn every `@[id]` in the text of `root` into a chip (not inside links or code). */
export function renderChips(root, opts) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.includes('@[') && !n.parentElement.closest('a, code, pre, .u-chip')) nodes.push(n);
  for (const n of nodes) n.replaceWith(...splitMentions(n.nodeValue).map((p) => (typeof p === 'string' ? document.createTextNode(p) : chip(p.id, opts))));
  return root;
}
/** The reverse, for the editor: chips back to tokens (on a clone the caller owns). */
export function chipsToTokens(root) {
  root.querySelectorAll('.u-chip[data-mention]').forEach((c) => c.replaceWith(document.createTextNode(`@[${c.dataset.mention}]`)));
  return root;
}
/** Relabel every chip under `root` (after a rename, a merge or the first load of the directory). */
export const refreshChips = (root) => root.querySelectorAll('.u-chip[data-user]').forEach(labelChip);
