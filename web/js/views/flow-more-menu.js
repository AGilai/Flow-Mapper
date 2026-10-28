// A small "⋯" menu (0.46.0, #95): a button and a popup of menu items. Keyboard: Enter / Space / ArrowDown open it, ArrowUp / ArrowDown move, Esc closes and gives
// the focus back; a click outside closes it. Used by the "About this flow" header, and by the sub-flow and per-service descriptions for "Generate…".

import { h } from '../dom.js';

/** moreMenu({ label, items: [{ label, note?, onSelect }], cls? }) -> { el, close, button } */
export function moreMenu({ label = 'More actions', items, cls = '' }) {
  let isOpen = false;
  const pop = h('div.mm-pop', { role: 'menu', hidden: true, 'aria-label': label },
    items.map((it) => h('button.mm-item', { type: 'button', role: 'menuitem', tabindex: '-1', on: { click: () => { close(true); it.onSelect(); } } }, it.label, it.note ? h('small', it.note) : null)));
  const button = h('button.mm-btn', { type: 'button', 'aria-label': label, title: label, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-qa': 'about-more',
    on: { click: () => (isOpen ? close(true) : open()), keydown: (e) => { if (e.key === 'ArrowDown' && !isOpen) { e.preventDefault(); open(); } } } }, '⋯');
  const el = h('span.mm', { class: cls }, button, pop);
  const entries = () => [...pop.querySelectorAll('.mm-item')];
  const away = (e) => { if (!el.contains(e.target)) close(false); };
  const gone = (e) => { if (!pop.contains(e.target)) close(false); };
  const key = (e) => {
    const list = entries(), i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i <= 0 ? list.length : i) - 1].focus(); }
    else if (e.key === 'Tab') close(false);
  };
  function open() {
    isOpen = true; pop.hidden = false; button.setAttribute('aria-expanded', 'true');
    const r = button.getBoundingClientRect(); // fixed, so a scrolling head never clips it
    Object.assign(pop.style, { top: `${Math.round(r.bottom + 4)}px`, right: `${Math.max(8, Math.round(innerWidth - r.right))}px` });
    document.addEventListener('scroll', gone, true); document.addEventListener('mousedown', away, true); el.addEventListener('keydown', key);
    entries()[0]?.focus();
  }
  function close(refocus) {
    if (!isOpen) return;
    isOpen = false; pop.hidden = true; button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('scroll', gone, true); document.removeEventListener('mousedown', away, true); el.removeEventListener('keydown', key);
    if (refocus) button.focus();
  }
  return { el, close, button };
}
