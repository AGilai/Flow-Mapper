// The Export menu of the Drivers tab: a CSV of the current view or a Markdown report, built in the browser from the
// same pure functions as GET /api/envs/:env/clients/drivers.csv|.md (core/drivers-export.ts). Works in the static preview.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { driversModel, driversCsv, driversReport } from '../../core/drivers-export.js';
import { kindLabel } from './drivers-kinds.js';

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([type === 'text/csv' ? '﻿' + text : text], { type: `${type};charset=utf-8` }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `rows`: the env's client rows; `get()`: the page's current {env, store, group, q, mixed}. */
export function exportMenu(rows, get) {
  let all = false;
  const menu = h('div.dv-menu', { role: 'menu', hidden: true });
  const btn = h('button.btn.sm', { type: 'button', 'data-qa': 'drivers-export', 'aria-haspopup': 'true', 'aria-expanded': 'false', on: { click: (e) => { e.stopPropagation(); toggle(!menu.hidden ? false : true); } } }, 'Export ', icon('chevdown'));
  const wrap = h('div.dv-exp', btn, menu);
  function toggle(on) {
    menu.hidden = !on; btn.setAttribute('aria-expanded', String(on));
    if (on) { fillMenu(); setTimeout(() => document.addEventListener('click', away), 0); } else document.removeEventListener('click', away);
  }
  function away(e) { if (!wrap.contains(e.target)) toggle(false); }
  function run(kind) {
    const s = get(), store = all || s.group === 'component' ? 'all' : s.store, date = new Date().toISOString().slice(0, 10);
    const o = { env: s.env, store, q: s.q, mixed: s.mixed, date, version: state.version, link: location.href };
    const m = driversModel(rows), stamp = date.replace(/-/g, '');
    if (kind === 'csv') download(`drivers-${s.env}-${store}-${stamp}.csv`, driversCsv(m, o), 'text/csv');
    else download(`drivers-${s.env}-${store}-${stamp}.md`, driversReport(m, o), 'text/markdown');
    toggle(false);
  }
  function fillMenu() {
    const s = get(), pkg = s.group !== 'component';
    menu.replaceChildren(
      h('label.dv-menu-opt', h('input', { type: 'checkbox', checked: all || !pkg, disabled: !pkg, 'data-qa': 'drivers-export-all', on: { change: (e) => { all = e.target.checked; } } }), ' All store types', pkg ? h('span.s.mu', ` (off: ${kindLabel(s.store)} only)`) : null),
      h('button', { type: 'button', role: 'menuitem', 'data-qa': 'drivers-export-csv', on: { click: () => run('csv') } }, 'CSV (this view)'),
      h('button', { type: 'button', role: 'menuitem', 'data-qa': 'drivers-export-md', on: { click: () => run('md') } }, 'Report (Markdown)'),
      h('div.s.mu', 'Uses this environment, the query and the mixed filter; the file says which.'));
  }
  return wrap;
}
