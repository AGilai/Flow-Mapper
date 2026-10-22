// Mentions (0.32.0, frame 18c): the comments that @mention the signed-in user, across every environment. Unread first (a dot and the word "new",
// never colour alone), "All" shows what was seen too. A row opens the flow's discussion and marks the mention seen; "Mark all read" clears the badge.

import { h } from '../dom.js';
import { api } from '../api.js';
import { pageHead } from '../components/page.js';
import { sanitize } from '../../core/rich-text.js';
import { relTime, fullDate } from '../comments/pure.js';
import { currentId } from '../users/me.js';
import { loadUsers, me, userById, watchUsers } from '../users/directory.js';
import { userAvatar } from '../users/avatar.js';
import { renderChips } from '../users/chips.js';
import { signIn } from '../users/signin.js';
import { announceSeen } from '../users/unread.js';

const flowHref = (m) => `#/flows?env=${encodeURIComponent(m.env)}&tabs=${encodeURIComponent(`${m.service}/${m.ingress}`).replace(/%2F/g, '/')}&comment=${m.commentId}`;

export async function render({ main }) {
  await loadUsers().catch(() => {});
  let view = 'unread', data = null, err = '';
  const head = h('div.mn-head'), body = h('div.content.mn-body');
  main.append(pageHead('Mentions', 'Comments that @mention you, in every environment.'), head, body);

  async function load() {
    const id = currentId();
    data = null; err = '';
    if (id) { try { data = await api.mentions({ user: id, limit: 500 }); } catch (e) { err = e.message; } }
    draw();
  }
  const seen = async (ids) => { if (!ids.length) return; await api.seenMentions(currentId(), ids).catch(() => {}); announceSeen(); };

  function draw() {
    const u = me();
    if (!u) {
      head.replaceChildren();
      body.replaceChildren(h('div.mn-empty', h('p', 'Sign in to see who mentioned you.'), h('button.btn.primary', { type: 'button', 'data-qa': 'mn-signin', on: { click: () => signIn() } }, 'Sign in')));
      return;
    }
    const all = data?.mentions ?? [], unread = all.filter((m) => m.unread), list = view === 'unread' ? unread : all;
    const seg = h('div.seg', { role: 'group', 'aria-label': 'Show' },
      [['unread', 'Unread', unread.length], ['all', 'All', all.length]].map(([id, label, n]) => h('button', { type: 'button', 'aria-pressed': String(view === id), 'data-qa': `mn-${id}`, on: { click: () => { view = id; draw(); } } }, label, ' ', h('small', String(n)))));
    head.replaceChildren(seg, h('span.muted.sm.mn-for', `for ${u.name} · `, h('button.lnk', { type: 'button', disabled: !unread.length, 'data-qa': 'mn-all-read', on: { click: async () => { await seen(unread.map((m) => m.commentId)); await load(); } } }, 'Mark all read')));
    if (err) { body.replaceChildren(h('div.error-box', err)); return; }
    const withAbout = () => { if (view === 'all' && data?.about?.length) body.append(aboutBlock(data.about)); };
    if (!data) { body.replaceChildren(h('div.loading', 'Loading…')); return; }
    body.replaceChildren(list.length ? h('table.grid.u-table.mn-t', h('thead', h('tr', ['', 'Comment', 'From', 'Flow', 'When'].map((t) => h('th', t)))),
      h('tbody', list.map((m) => row(m)))) : h('div.mn-empty', h('p', view === 'unread' && all.length ? 'No unread mentions.' : 'Nobody has mentioned you yet.'), view === 'unread' && all.length ? h('button.lnk', { type: 'button', on: { click: () => { view = 'all'; draw(); } } }, 'Show all') : null));
    withAbout();
  }
  /** Mentions in an About (0.33.0): "about of <item>", never unread; a row opens the item's info pane. */
  function aboutBlock(list) {
    const to = (a) => `#/system?env=${encodeURIComponent(a.env)}${a.kind === 'subsystem' ? '&level=subsystems' : ''}&sel=${encodeURIComponent(a.kind === 'subsystem' ? `grp:${a.id}` : `svc:${a.id}`)}`;
    return h('section.mn-about', { 'data-qa': 'mn-about' }, h('h3', 'In an About', h('small', ` ${list.length}`)),
      h('table.grid.u-table.mn-t', h('tbody', list.map((a) => h('tr.clickable.read', { tabindex: 0, 'data-qa': 'mn-about-row', on: { click: () => { location.hash = to(a).slice(1); }, keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); location.hash = to(a).slice(1); } } } },
        h('td.mn-text', renderChips(h('div', a.text))), h('td.nw', h('b', `about of ${a.label}`), h('div.xs.muted', `${a.env} · ${a.kind}`)))))));
  }

  function row(m) {
    const open = async () => { if (m.unread) await seen([m.commentId]); location.hash = flowHref(m).slice(1); };
    const from = userById(m.authorId) ?? { name: m.author, id: m.authorId };
    return h('tr', { class: `clickable${m.unread ? '' : ' read'}`, tabindex: 0, 'data-qa': 'mn-row', 'data-unread': String(m.unread), on: { click: (e) => { if (!e.target.closest('.u-chip')) open(); }, keydown: (e) => { if (e.key === 'Enter') open(); } } },
      h('td.mn-dot', m.unread ? [h('span.dot', { 'aria-hidden': 'true' }), h('span.sr-only', 'new')] : null),
      h('td.mn-text', renderChips(h('div', { html: sanitize(m.html) }))),
      h('td.nw', h('span.u-own', userAvatar(from, 's'), from.name)),
      h('td', h('b', m.ingress), h('div.xs.muted', `${m.env} · ${m.service}${m.step ? ' · step' : ''}`)),
      h('td.nw.muted', { title: fullDate(m.createdAt) }, relTime(m.createdAt)));
  }

  const off = watchUsers(() => { if (!main.isConnected) { off(); return; } load(); });
  await load();
  return { dispose: off };
}
