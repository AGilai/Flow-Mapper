// Minimized flow header (Unreleased, #106, #114): one bold Collapse button at the start of the title row folds the flow's own header (title row, About, mode lines, step bar) into a single thin strip. The view toolbar stays.
// The choice is one global value (localStorage, flow-headmin-pure.js): every flow tab follows it, and it survives a reload. H toggles it. Styles: flow-headmin.css.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { paintEnv } from '../components/env-chip.js';
import { badgeLabel, headTip } from './incomplete-pure.js';
import { loadHeadMin, saveHeadMin, headKeyAction, stepShort, stepWords } from './flow-headmin-pure.js';

let on = loadHeadMin();
const tabs = new Set(); // the open tab views, each repaints when the value changes
const dialogOpen = () => !!document.querySelector('dialog[open], .scrim');
const onKey = (e) => {
  if (headKeyAction(e, { dialogOpen: dialogOpen() }) && document.querySelector('.flows .flow-tab')) { e.preventDefault(); setHeadMin(!on); }
};
const paintPage = () => document.body.classList.toggle('head-min', on);
paintPage();
export function setHeadMin(v) { on = !!v; saveHeadMin(on); paintPage(); tabs.forEach((t) => t.paint()); }
export const headMinOn = () => on;

/** createHeadMin({ host, title, sub, onWhy }) -> { strip, button(), attach(tabEl, walk), setInc(n, source, service, status), dispose() }
 *  title(): the flow's name now; sub: the mono line after it (or null); attach(tabEl, walk): the tab's element and its step walk, once both exist; onWhy(): the incomplete badge was pressed. */
export function createHeadMin({ host, title, sub = null, onWhy }) {
  let tab = null, walk = null, unwatch = null;
  const nameEl = h('span.hs-name'), subEl = sub ? h('span.hs-sub.mono', sub) : null, incSlot = h('span.hs-inc', { hidden: true });
  const btn = (cls, label, click, extra = {}) => h(`button.${cls}`, { type: 'button', title: label, 'aria-label': label, on: { click }, ...extra });
  const prev = btn('stepnav', 'Previous step', () => walk?.move('prev')), next = btn('stepnav', 'Next step', () => walk?.move('next'));
  prev.textContent = '‹'; next.textContent = '›';
  const cnt = h('span.hs-cnt'), live = h('span.sr-only', { role: 'status', 'aria-live': 'polite' });
  const show = btn('btn.sm.hs-show.hs-toggle', 'Expand the flow header (H)', (e) => toggle(false, e), { 'aria-expanded': 'false', 'aria-label': 'Expand flow header', 'data-qa': 'show-header' });
  show.append(icon('chevdown'), h('span.hs-tl', 'Expand'));
  const min = btn('btn.sm.hs-min.hs-toggle', 'Collapse the flow header (H)', (e) => toggle(true, e), { 'aria-expanded': 'true', 'aria-label': 'Collapse flow header', 'data-qa': 'minimize-header' });
  min.append(icon('chevup'), h('span.hs-tl', 'Collapse'));
  const strip = paintEnv(h('div.head-strip', { role: 'group', 'aria-label': 'Flow header, minimized', 'data-qa': 'head-strip' },
    show, h('span.hs-id', nameEl, subEl), incSlot, h('span.grow'), h('span.hs-nav', prev, cnt, next), live, host.max?.button() ?? null), host.env);

  function toggle(v, ev) { // from a button: focus follows the control that is still on screen (the one clicked is hidden now)
    setHeadMin(v);
    if (ev?.detail !== undefined) requestAnimationFrame(() => (v ? show : min).focus({ preventScroll: true }));
  }
  function paintNav() {
    const n = walk?.current() ?? 0, total = walk?.steps().length ?? 0;
    cnt.textContent = stepShort(n, total); cnt.setAttribute('aria-label', stepWords(n, total));
    prev.disabled = n < 1; next.disabled = n >= total; strip.classList.toggle('no-steps', !total);
  }
  const self = { paint() { tab?.classList.toggle('head-min', on); min.setAttribute('aria-expanded', String(!on)); nameEl.textContent = title(); nameEl.title = nameEl.textContent; paintNav(); } };
  tabs.add(self); if (tabs.size === 1) addEventListener('keydown', onKey);
  return {
    strip, self,
    button: () => min,
    attach(el, w) { tab = el; walk = w; unwatch = w.watch(() => paintNav()); self.paint(); },
    setInc(n, source, service, status = null) { // the compact badge: the warning mark and the count; the same press and tip as the full one
      incSlot.replaceChildren(); incSlot.hidden = !(n > 0 || status === 'incomplete');
      if (incSlot.hidden) return;
      incSlot.append(n > 0 ? h('button.inc-badge.sm', { type: 'button', title: headTip(n, source, service), 'aria-label': badgeLabel(n, { button: true }), on: { click: (e) => { e.preventDefault(); onWhy?.(e.currentTarget); } } }, icon('warn'), String(n))
        : h('span.inc-badge.sm', { title: 'Incomplete flow. The harvester reports it as incomplete but not where.', 'aria-label': badgeLabel(0) }, icon('warn'), '!'));
    },
    dispose() { unwatch?.(); tabs.delete(self); if (!tabs.size) removeEventListener('keydown', onKey); },
  };
}
