// The env picker's four groups (frame 27b/27f): My designs, Shared with me, Published, Harvested. `row(name, line)` draws one option.
// A design belongs to the first group that fits: mine (I own it), shared with me (I am listed), published (everyone reads it), and, for an admin,
// "Other designs" (private or shared designs of other people, which only an admin can see). Empty groups say what they are for.

import { h } from '../dom.js';
import { envLine } from '../env-info.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function envGroups(metas, { me, admin, row, isMine, close }) {
  const designs = metas.filter((m) => m.kind === 'design'), sealed = metas.filter((m) => m.kind !== 'design');
  const mine = designs.filter((m) => isMine(m.access));
  const shared = designs.filter((m) => !isMine(m.access) && m.access?.member);
  const published = designs.filter((m) => !isMine(m.access) && !m.access?.member && m.access?.visibility === 'published');
  const other = admin ? designs.filter((m) => ![...mine, ...shared, ...published].includes(m)) : [];
  const owner = (m) => m.access?.ownerName ?? 'no owner';
  const head = (label, n, note) => h('div.env-gh', { role: 'presentation' }, h('span', label), h('em', String(n)), note ? h('small', note) : null);
  const none = (title, text, action) => h('div.env-none', { role: 'presentation' }, h('b', title), h('span', text), action ?? null);
  const out = [];
  out.push(head('My designs', mine.length));
  if (mine.length) out.push(...mine.map((m) => row(m.name, envLine(m))));
  else out.push(none('No designs yet', 'Copy a harvested environment to start one. It stays private until you share it.', h('a.btn.sm', { href: '#/envs/new', 'data-qa': 'picker-new', on: { click: close } }, 'New design')));
  out.push(head('Shared with me', shared.length));
  if (shared.length) out.push(...shared.map((m) => row(m.name, `${owner(m)} · you can ${m.access.member === 'editor' ? 'edit' : 'view'}`)));
  else out.push(none('Nothing shared with you yet', "When someone shares a design with you, it shows up here with the owner's name."));
  if (published.length) { out.push(head('Published', published.length)); out.push(...published.map((m) => row(m.name, `${owner(m)} · read-only`))); }
  if (other.length) { out.push(head('Other designs', other.length, 'admin')); out.push(...other.map((m) => row(m.name, `${owner(m)} · ${m.access?.visibility}`))); }
  out.push(head('Harvested', sealed.length, 'Sealed, read-only for everyone'));
  out.push(...sealed.map((m) => row(m.name, `${plural(m.counts?.components ?? 0, 'component')} · harvested`)));
  void me;
  return out;
}
