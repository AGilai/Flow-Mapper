// The rail's environment picker: a dropdown showing the ACTIVE environment (name and its small line, "sealed · 55 components"
// or "design · from prod, Oct 21"). Click opens a listbox of all environments and "+ New environment". Arrows/Home/End move,
// Enter or click picks, Esc or a click outside closes and returns focus to the trigger.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, setEnv } from '../state.js';
import { envLine, metaOf, canDeleteEnv } from '../env-info.js';
import { isPreview } from '../api.js';
import { deleteEnvDialog } from './env-delete.js';
import { envDot, paintEnv } from './env-chip.js';
import { account, isCognito, isMine } from '../account.js';
import { visBadge } from './env-badge.js';
import { envGroups } from './env-groups.js';

const rowBody = (name, line, badge = false) => [envDot(name), h('b', name), h('small', line ?? envLine(metaOf(state.envMeta, name))), badge && isCognito() ? visBadge(metaOf(state.envMeta, name)) : null];

let refocus = false; // a pick re-renders the rail: put focus back on the new trigger

export function envPicker() {
  let pop = null;
  const trigger = h('button.env-trigger', { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', title: `Environment ${state.env}: ${envLine(metaOf(state.envMeta, state.env))}`, on: { click: () => (pop ? close(true) : open()) } },
    h('span.env-cur', ...rowBody(state.env)), icon('chev'));
  paintEnv(trigger, state.env); // the left border in the env colour
  const wrap = h('div.env-pick', trigger);
  if (refocus) { refocus = false; requestAnimationFrame(() => trigger.focus()); }

  const close = (refocus) => {
    if (!pop) return;
    pop.remove(); pop = null;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    removeEventListener('resize', place);
    if (refocus) trigger.focus();
  };
  const outside = (e) => { if (!wrap.contains(e.target)) close(false); };
  /** Fit the popover in the viewport: above the trigger when the rail is at the bottom, below it otherwise. */
  const place = () => {
    if (!pop) return;
    const r = trigger.getBoundingClientRect(), w = Math.min(Math.max(r.width, isCognito() ? 340 : 240), innerWidth - 16);
    const up = r.top > innerHeight - r.bottom;
    Object.assign(pop.style, { width: `${w}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`,
      maxHeight: `${Math.max(120, (up ? r.top : innerHeight - r.bottom) - 12)}px`,
      top: up ? 'auto' : `${r.bottom + 4}px`, bottom: up ? `${innerHeight - r.top + 4}px` : 'auto' });
  };
  const open = () => {
    const row = (name, line) => {
      const on = name === state.env;
      return h('button.env-opt', { type: 'button', role: 'option', 'data-env': name, 'aria-selected': String(on), tabindex: on ? 0 : -1, title: `${name}: ${line ?? envLine(metaOf(state.envMeta, name))}`,
        on: { click: () => { close(false); if (!on) { refocus = true; setEnv(name); } else trigger.focus(); } } }, rowBody(name, line, true));
    };
    // accounts: four groups by who owns what (frame 27b); a server without accounts keeps the flat list as before
    const list = h('div.env-list', { role: 'listbox', 'aria-label': 'Environment' }, isCognito() ? envGroups(state.envMeta.filter((m) => state.envs.includes(m.name)), { me: account.user, admin: account.admin, row, isMine, close: () => close(false) }) : state.envs.map((name) => row(name)));
    pop = h('div.env-pop', { on: { keydown: (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
      const rows = [...list.querySelectorAll('.env-opt')], i = rows.indexOf(document.activeElement);
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rows.length - 1 }[e.key];
      if (to === undefined || i < 0) return;
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, to))];
      rows.forEach((r) => { r.tabIndex = r === next ? 0 : -1; });
      next.focus();
    } } }, list, h('a.env-opt.env-add', { href: '#/envs/new', on: { click: () => close(false) } }, isCognito() ? [h('b', '+ New design'), h('small', 'Copy a harvested or published environment')] : '+ New environment'),
      h('a.env-opt.env-add', { href: `#/envs/${encodeURIComponent(state.env)}/settings`, 'data-qa': 'env-settings', on: { click: () => close(false) } }, 'Environment settings'),
      canDeleteEnv(metaOf(state.envMeta, state.env), state.envs) && !isPreview && (!isCognito() || metaOf(state.envMeta, state.env).access?.role === 'owner')
        ? h('button.env-opt.env-del', { type: 'button', 'data-qa': 'env-delete', on: { click: () => { close(false); deleteEnvDialog(state.env); } } }, 'Delete environment') : null);
    wrap.append(pop);
    trigger.setAttribute('aria-expanded', 'true');
    place();
    document.addEventListener('pointerdown', outside, true);
    addEventListener('resize', place);
    (list.querySelector('[aria-selected=true]') ?? list.firstChild)?.focus();
  };
  trigger.addEventListener('keydown', (e) => { if (!pop && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); open(); } });
  return wrap;
}
