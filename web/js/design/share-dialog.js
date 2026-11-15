// Frame 27c: the Share dialog of a design environment (owner or admin): add people (viewer | editor), change a role, remove, publish to everyone,
// copy the link. Every change is saved at once (PUT /api/envs/:env/access); Done closes it and the page head's badge follows.

import { h } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { account } from '../account.js';
import { loadUsers, users } from '../users/directory.js';
import { userAvatar } from '../users/avatar.js';
import { visBadge } from '../components/env-badge.js';

const ROLES = [['viewer', 'Viewer'], ['editor', 'Editor']];

export async function openShare(env = state.env, onChange = () => {}) {
  const opener = document.activeElement;
  let acc = await api.envAccess(env);
  await loadUsers().catch(() => {});
  const err = h('div.ac-err', { role: 'alert' });
  const name = h('input.input', { id: 'ac-add', type: 'text', list: 'ac-people', placeholder: 'Name', 'aria-label': 'Add people', autocomplete: 'off', 'data-qa': 'share-name' });
  const role = h('select.input', { 'aria-label': 'Role', 'data-qa': 'share-role' }, ROLES.map(([v, t]) => h('option', { value: v }, t)));
  const people = h('div.ac-pl', { 'data-qa': 'share-people' });
  const body = h('div');
  const link = `${location.origin}/#/flows?env=${encodeURIComponent(env)}`;
  const done = () => { dlg.close(); dlg.remove(); opener?.focus?.(); onChange(); };
  const dlg = h('dialog.ac-dlg', { 'aria-label': `Share ${env}`, on: { cancel: (e) => { e.preventDefault(); done(); } } }, body);

  const save = async (patch) => {
    err.textContent = '';
    try { acc = await api.putEnvAccess(env, patch); state.envMeta = await api.envMeta().catch(() => state.envMeta); draw(); }
    catch (e) { err.textContent = e.message; draw(); }
  };
  const members = () => acc.members.map((m) => ({ userId: m.user.id, role: m.role }));
  const add = async () => {
    const v = name.value.trim().toLowerCase();
    const u = users().find((x) => x.name.toLowerCase() === v);
    if (!u) { err.textContent = v ? `No user named “${name.value.trim()}”. People appear here once they have signed in.` : 'Type a name.'; return; }
    if (u.id === acc.owner?.id) { err.textContent = 'The owner already has full access.'; return; }
    await save({ members: [...members().filter((m) => m.userId !== u.id), { userId: u.id, role: role.value }] });
    name.value = '';
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  function draw() {
    const who = (p, extra) => h('div.ac-pr', userAvatar(p), h('div.who', h('b', p.name, p.id === account.user?.id ? h('small', ' (you)') : null), h('span', p.email ?? '')), extra);
    people.replaceChildren(
      ...(acc.owner ? [who(acc.owner, h('span.ac-own', 'Owner'))] : []),
      ...acc.members.map((m) => who(m.user, h('div.ac-end',
        h('select.input', { 'aria-label': `Role of ${m.user.name}`, on: { change: (e) => save({ members: members().map((x) => (x.userId === m.user.id ? { ...x, role: e.target.value } : x)) }) } }, ROLES.map(([v, t]) => h('option', { value: v, selected: v === m.role }, t))),
        h('button.ac-ib', { type: 'button', title: `Remove ${m.user.name}`, 'aria-label': `Remove ${m.user.name}`, on: { click: () => save({ members: members().filter((x) => x.userId !== m.user.id) }) } }, icon('close'))))));
    const sw = h('button.ac-sw', { type: 'button', role: 'switch', 'aria-checked': String(acc.published), 'aria-label': 'Publish to everyone', class: acc.published ? 'on' : '', 'data-qa': 'share-publish', on: { click: () => save({ published: !acc.published }) } }, h('i'));
    body.replaceChildren(
      h('div.ac-dh', h('div', h('h3', `Share “${env}”`), h('p', `Design environment · you are the ${acc.role === 'owner' && acc.owner?.id !== account.user?.id ? 'admin' : 'owner'}`)), visBadge({ kind: 'design', access: acc }),
        h('button.ac-ib', { type: 'button', 'aria-label': 'Close', on: { click: done } }, icon('close'))),
      h('div.ac-ds', h('label.ac-l', { for: 'ac-add' }, 'Add people'),
        h('div.ac-addrow', h('div.ac-fld', name), role, h('button.btn.primary', { type: 'button', 'data-qa': 'share-add', on: { click: add } }, 'Add')),
        h('p.ac-h', 'Viewers can read. Editors can also open drafts.'), err,
        h('datalist#ac-people', users().filter((u) => u.id !== acc.owner?.id).map((u) => h('option', { value: u.name })))),
      h('div.ac-ds', h('div.ac-l', 'People with access ', h('small', String(acc.members.length + (acc.owner ? 1 : 0)))), people),
      h('div.ac-ds', h('div.ac-pubrow', h('div', h('b', 'Publish to everyone (read-only)'),
        h('p', acc.published ? 'Everyone who signs in can find this design and open it read-only. Only the people above can edit. Turn it off to hide it from everyone else again; the people above keep their access.'
          : 'Everyone who signs in can find this design and open it read-only. Only the people above can edit. It stays hidden from everyone else until you turn this on.')), sw)),
      h('div.ac-ds', h('div.ac-l', 'Link'), h('div.ac-addrow', h('div.ac-fld', h('input.input.mono', { readOnly: true, value: link, 'aria-label': 'Link', on: { focus: (e) => e.target.select() } })),
        h('button.btn', { type: 'button', 'data-qa': 'share-copy', on: { click: async (e) => { try { await navigator.clipboard.writeText(link); e.target.textContent = 'Copied'; } catch { /* clipboard blocked: the field is selectable */ } } } }, 'Copy link')),
        h('p.ac-h', acc.published ? 'Anyone signed in can open it.' : 'Only the people above can open it. Anyone else sees “not found”.')),
      h('div.ac-df', h('div.ac-note', icon('info'), 'Only the owner (or an admin) can share, publish or delete this design.'), h('button.btn.primary', { type: 'button', 'data-qa': 'share-done', on: { click: done } }, 'Done')));
  }
  draw();
  document.body.append(dlg);
  dlg.showModal();
  name.focus();
}
