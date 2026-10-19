// Small context menu at the pointer. items: [{label, hint?, icon?, onSelect?, disabled?} | 'divider'].
// Closes on choice, outside click, scroll or Escape; arrow keys move between items.

import { h } from '../dom.js';
import { icon } from '../icons.js';

let current = null;

export function openMenu(x, y, title, items) {
  closeMenu();
  const buttons = [];
  const el = h('div.ctx-menu', { role: 'menu', 'aria-label': title },
    title ? h('div.ctx-title', title) : null,
    items.map((it) => {
      if (it === 'divider') return h('div.ctx-divider');
      const b = h('button.ctx-item', { role: 'menuitem', type: 'button', disabled: !!it.disabled,
        on: { click: () => { closeMenu(); it.onSelect?.(); } } },
        it.icon ? icon(it.icon) : h('span.ctx-gap'), h('span.ctx-text', h('span', it.label), it.hint ? h('span.ctx-hint', it.hint) : null));
      if (!it.disabled) buttons.push(b);
      return b;
    }));
  document.body.append(el);
  // keep inside the viewport
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  buttons[0]?.focus();

  const onKey = (e) => {
    if (e.key === 'Escape') return closeMenu();
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
  };
  const onDown = (e) => { if (!el.contains(e.target)) closeMenu(); };
  setTimeout(() => { addEventListener('pointerdown', onDown, true); addEventListener('keydown', onKey, true); addEventListener('scroll', closeMenu, true); });
  current = { el, off: () => { removeEventListener('pointerdown', onDown, true); removeEventListener('keydown', onKey, true); removeEventListener('scroll', closeMenu, true); } };
}

export function closeMenu() {
  if (!current) return;
  current.off();
  current.el.remove();
  current = null;
}
