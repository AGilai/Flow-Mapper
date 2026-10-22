// Users (0.32.0, frame 18d): the registry. Global (not per environment). Search, rename inline (Enter saves, Esc cancels; optionally keep the old
// name as an alias) and merge two users (users-merge.js). A hint marks names that look like one person. There is no delete: a user with history
// cannot vanish (that would orphan authors). At 760 px the table becomes cards.

import { h } from '../dom.js';
import { api } from '../api.js';
import { pageHead } from '../components/page.js';
import { filterUsers, lookalikes, MAX_USER_NAME } from '../../core/users-match.js';
import { relTime, fullDate } from '../comments/pure.js';
import { loadUsers, me, remember, users, watchUsers } from '../users/directory.js';
import { userAvatar } from '../users/avatar.js';
import { openMerge } from './users-merge.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** A small source mark with the external id, e.g. "C Confluence 712020:bdf1…". */
export const extMark = (e) => h('span.u-ext', h('span.u-src', h('i', e.source[0].toUpperCase()), e.source), h('span.mono', { title: e.externalId }, e.externalId.length > 14 ? `${e.externalId.slice(0, 13)}…` : e.externalId));
export const lastSeen = (u) => (u.lastSeenAt ? relTime(u.lastSeenAt) : `added ${relTime(u.createdAt)}`);

export async function render({ main }) {
  let q = '', editing = null, err = '';
  const sub = h('span.muted.sm'), body = h('div.content.us-body');
  const search = h('input.input.us-search', { type: 'search', placeholder: 'Search users…', 'aria-label': 'Search users', 'data-qa': 'us-search', on: { input: () => { q = search.value; draw(); } } });
  main.append(pageHead('Users', 'No passwords: a user is a name and a colour.', search), body);

  async function reload() { await loadUsers(true).catch((e) => { err = e.message; }); draw(); }

  function nameCell(u, dup) {
    if (editing !== u.id) return h('div.u-nm', userAvatar(u), h('div', h('b', u.name), me()?.id === u.id ? [' ', h('span.u-you', 'you')] : null,
      dup ? h('small', h('span.u-dup', `⚠ looks like ${dup.name}`)) : u.aliases?.length ? h('small', `also ${u.aliases.join(', ')}`) : null));
    let alias = false;
    const input = h('input.input.us-edit', { type: 'text', value: u.name, maxLength: MAX_USER_NAME, 'aria-label': `New name for ${u.name}`, 'data-qa': 'us-rename-input',
      on: { keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(u, input.value, alias); } if (e.key === 'Escape') { editing = null; draw(); } } } });
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return h('div.u-nm', userAvatar(u), h('div', input, h('label.u-keep', h('input', { type: 'checkbox', on: { change: (e) => { alias = e.target.checked; } } }), ' keep the old name as an alias'), h('small', 'Enter saves, Esc cancels')));
  }
  async function save(u, name, keepAlias) {
    err = '';
    try { remember({ ...(await api.renameUser(u.id, { name, keepAlias })), counts: u.counts }); editing = null; await reload(); } catch (e) { err = e.message; draw(); }
  }

  function draw() {
    const all = users(), dups = lookalikes(all), list = filterUsers(all, q);
    sub.textContent = `${plural(all.length, 'user')}`;
    const rows = list.map((u) => {
      const c = u.counts ?? { comments: 0, items: 0, mentions: 0 }, dup = dups.get(u.id);
      return h('tr', { 'data-qa': 'us-row', 'data-id': u.id },
        h('td.c-nm', nameCell(u, dup)),
        h('td.c-ex', u.externalIds?.length ? h('span.u-exts', u.externalIds.map(extMark)) : h('span.muted.xs', 'none')),
        h('td.c-st.nw', { title: u.lastSeenAt ? fullDate(u.lastSeenAt) : '' }, lastSeen(u)),
        h('td.num', String(c.comments)), h('td.num', String(c.items)), h('td.num', String(c.mentions)),
        h('td.c-ac', editing === u.id
          ? h('div.u-ra', h('button.lnk', { type: 'button', 'data-qa': 'us-save', on: { click: (e) => save(u, e.target.closest('tr').querySelector('.us-edit').value, e.target.closest('tr').querySelector('.u-keep input').checked) } }, 'Save'), h('button.lnk.d', { type: 'button', on: { click: () => { editing = null; draw(); } } }, 'Cancel'))
          : h('div.u-ra', h('button.lnk', { type: 'button', 'data-qa': 'us-rename', 'aria-label': `Rename ${u.name}`, on: { click: () => { editing = u.id; draw(); } } }, 'Rename'),
            h('button.lnk', { type: 'button', 'data-qa': 'us-merge', 'aria-label': `Merge ${u.name} into another user`, disabled: all.length < 2, on: { click: () => openMerge(u, { onDone: reload, preferInto: dup }) } }, 'Merge…'))));
    });
    body.replaceChildren(...[sub, err ? h('div.error-box', { role: 'alert' }, err) : null,
      h('table.grid.u-table.us-t', h('thead', h('tr', [['User'], ['External ids'], ['Last seen', 'nw'], ['Comments', 'num'], ['Actions', 'num'], ['Mentioned', 'num'], ['']].map(([t, c]) => h('th', { class: c ?? '' }, t)))),
        h('tbody', rows.length ? rows : h('tr', h('td.muted', { colSpan: 7 }, all.length ? 'No user matches.' : 'No users yet.'))))].filter(Boolean));
  }

  await loadUsers().catch((e) => { err = e.message; });
  draw();
  const off = watchUsers(() => { if (!main.isConnected) { off(); return; } if (editing === null) draw(); });
  return { dispose: off };
}
