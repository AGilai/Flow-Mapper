// The expanded info pane (0.33.0, frame 19h): the drawer's item as a full-screen page over the whole app. Accordion rows (pane-acc.js), Expand all / Collapse all,
// an "On this page" outline from 1280 px, Esc or Collapse back to the drawer (which stays mounted under it, so its scroll and the open rows are untouched).
//   const ex = createExpanded({ onCollapse, onClose, onShowOnMap });  ex.open(spec);  ex.update(spec);  ex.collapse();  ex.isOpen();

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { createAccordion } from './pane-acc.js';
import { outlineOf, siblingRow, currentJump, showOutline } from './pane-pure.js';

const inField = (t) => t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

export function createExpanded({ onCollapse = null, onClose = null, onShowOnMap = null } = {}) {
  let el = null, spec = null, restoreFocus = null, scrollEl = null, token = 0;

  async function render(next) {
    const mine = ++token;
    spec = next;
    const acc = createAccordion();
    let rows;
    try { rows = await spec.expanded(); } catch { rows = []; }
    if (mine !== token || !el) return;
    const goQ = () => acc.reveal('q');
    const collapseBtn = h('button.pane-ib.b', { type: 'button', 'data-qa': 'pane-collapse', title: 'Back to the drawer (Esc)', on: { click: () => collapse() } }, icon('unmax'), 'Collapse', h('kbd', 'Esc'));
    const onMap = h('button.btn.sm', { type: 'button', 'data-qa': 'pane-onmap', on: { click: () => { collapse(false); onShowOnMap?.(spec.target); } } }, 'Show on map');
    const top = h('div.pane-x-top', spec.tile(), h('div.pane-x-title', h('h3', { class: spec.mono ? 'mono' : '' }, spec.title), h('div.crumb', [state.env, ...(spec.crumb ?? [])].filter(Boolean).join(' · '))),
      h('div.pane-marks', spec.marks?.(goQ) ?? [], spec.inDraft ? h('span.st.new', 'in draft') : null),
      h('div.sp', onMap, collapseBtn, h('button.pane-ib', { type: 'button', 'aria-label': 'Close details', title: 'Close details', on: { click: () => { collapse(false); onClose?.(); } } }, icon('close'))));
    const bar = h('div.pane-x-bar', h('span', 'Expand all / Collapse all:'), h('button.btn.sm', { type: 'button', 'data-qa': 'acc-all', on: { click: () => acc.all(true) } }, 'Expand all'),
      h('button.btn.sm', { type: 'button', 'data-qa': 'acc-none', on: { click: () => acc.all(false) } }, 'Collapse all'), h('span.sp.muted', 'Open rows are remembered per browser'));
    const col = h('div.pane-accs', rows.map((r) => acc.row(r)));
    const out = outlineOf(rows);
    const outline = h('div.pane-out', out.map((o) => h('button', { type: 'button', class: `${o.depth ? 'sub' : ''} ${o.q ? 'q' : ''}`.trim(), 'data-out': o.id, on: { click: () => acc.reveal(o.id) } }, o.q ? '? ' : '', o.title, o.count ? h('small', String(o.count)) : null)));
    const aside = h('aside.pane-x-aside', h('div', h('div.pane-cap', h('b', 'On this page')), outline),
      h('div.pane-keys', h('span', h('b', 'Esc'), ' collapses to the drawer'), h('span', h('b', 'E'), ' expands, ', h('b', '['), ' / ', h('b', ']'), ' previous / next row')));
    const main = h('div.pane-x-main', col, aside);
    scrollEl = main;
    const spy = () => {
      const t0 = main.getBoundingClientRect().top, tops = out.map((o) => (acc.el(o.id)?.isConnected ? acc.el(o.id).getBoundingClientRect().top - t0 : null));
      const cur = currentJump(tops, 40);
      outline.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === cur));
    };
    main.addEventListener('scroll', () => requestAnimationFrame(spy), { passive: true });
    el.replaceChildren(top, bar, main);
    requestAnimationFrame(spy);
    el.dataset.out = showOutline(innerWidth) ? '1' : '0';
    el._acc = acc;
  }

  function onKey(e) {
    if (!el) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); collapse(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || inField(e.target)) return;
    if (e.key === 'e' || e.key === 'E') { e.preventDefault(); collapse(); return; }
    if (e.key === '[' || e.key === ']') {
      const acc = el._acc;
      if (!acc) return;
      const ids = acc.ids().filter((id) => acc.el(id)?.isConnected), cur = document.activeElement?.closest?.('.pane-acc')?.dataset.acc ?? null;
      const to = siblingRow(ids, cur, e.key === ']' ? 1 : -1);
      if (to) { e.preventDefault(); acc.btn(to)?.focus(); acc.el(to)?.scrollIntoView({ block: 'nearest' }); }
    }
  }

  function open(next) {
    if (el) return update(next);
    restoreFocus = document.activeElement;
    el = h('div.pane-x', { 'data-pane-overlay': '', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${next.title}, expanded` });
    document.body.append(el);
    document.querySelector('.app')?.setAttribute('inert', '');
    addEventListener('keydown', onKey, true);
    render(next).then(() => el?.querySelector('[data-qa=pane-collapse]')?.focus());
  }
  function update(next) { if (el) { el.setAttribute('aria-label', `${next.title}, expanded`); render(next); } }
  function collapse(focusBack = true, silent = false) {
    if (!el) return;
    token++;
    removeEventListener('keydown', onKey, true);
    el.remove(); el = null; scrollEl = null;
    document.querySelector('.app')?.removeAttribute('inert');
    if (focusBack) restoreFocus?.focus?.({ preventScroll: true });
    if (!silent) onCollapse?.();
  }
  return { open, update, collapse, isOpen: () => !!el, scroller: () => scrollEl };
}
