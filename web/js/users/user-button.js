// The sign-in button in the rail, under the environment picker (0.31.0): a round avatar with the user's initials and colour and the name,
// or an outlined "Sign in" icon when nobody is signed in. Click: the sign-in (nobody) or a small menu: the name, Switch user, Users, Sign out.
// Collapsed rail: the avatar alone (CSS). Same place in the 760 px rail.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { loadUsers, me, signOut, watchUsers } from './directory.js';
import { userAvatar } from './avatar.js';
import { signIn } from './signin.js';

export function userButton() {
  let pop = null;
  const wrap = h('div.u-btn-wrap');
  const close = (focus) => { if (!pop) return; pop.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); removeEventListener('resize', place); btn()?.setAttribute('aria-expanded', 'false'); if (focus) btn()?.focus(); };
  const outside = (e) => { if (!wrap.contains(e.target)) close(false); };
  const btn = () => wrap.querySelector('.u-btn');

  function draw() {
    const u = me();
    const b = h('button.u-btn', { type: 'button', 'data-qa': 'user-btn', 'aria-haspopup': u ? 'menu' : 'dialog', 'aria-expanded': 'false',
      title: u ? `Signed in as ${u.name}` : 'Sign in', 'aria-label': u ? `Signed in as ${u.name}. Open the user menu` : 'Sign in',
      on: { click: () => (u ? (pop ? close(true) : menu(u)) : signIn()) } },
      u ? userAvatar(u) : h('span.u-av.out', icon('user')), h('span.u-name', u ? u.name : 'Sign in'));
    wrap.replaceChildren(b);
    pop = null;
  }
  /** Fixed beside the button (the rail clips anything inside it): above it in the rail, below it in the 760 px strip. */
  function place() {
    if (!pop) return;
    const r = btn().getBoundingClientRect(), up = r.top > innerHeight - r.bottom, left = Math.max(8, Math.min(r.left, innerWidth - 240));
    Object.assign(pop.style, { left: `${left}px`, top: up ? 'auto' : `${r.bottom + 4}px`, bottom: up ? `${innerHeight - r.top + 4}px` : 'auto' });
  }
  function menu(u) {
    const item = (label, fn, qa, cls = '') => h('button.u-mi', { type: 'button', role: 'menuitem', class: cls, 'data-qa': qa, on: { click: () => { close(false); fn(); } } }, label);
    pop = h('div.u-menu', { role: 'menu', 'aria-label': 'User menu', on: { keydown: (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
      const rows = [...pop.querySelectorAll('.u-mi')], i = rows.indexOf(document.activeElement), to = { ArrowDown: i + 1, ArrowUp: i - 1 }[e.key];
      if (to !== undefined) { e.preventDefault(); rows[(to + rows.length) % rows.length].focus(); }
    } } },
      h('div.u-menu-who', userAvatar(u, 'l'), h('div', h('b', u.name), h('small', 'signed in on this browser'))),
      item('Switch user', () => signIn(), 'um-switch'),
      item('Users', () => { location.hash = '#/users'; }, 'um-users'),
      item('Sign out', () => signOut(), 'um-out', 'd'));
    wrap.append(pop);
    place();
    addEventListener('resize', place);
    btn().setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    pop.querySelector('.u-mi').focus();
  }
  draw();
  const off = watchUsers(() => { if (!wrap.isConnected) { off(); document.removeEventListener('pointerdown', outside, true); return; } close(false); draw(); });
  loadUsers().catch(() => {});
  return wrap;
}
