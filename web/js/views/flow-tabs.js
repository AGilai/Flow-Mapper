// The tab strip: an ARIA tablist (arrows, Home/End, Delete), ‹ › scrolling with fading edges, and the overflow list
// ("▾ N": every tab with a filter, Close others, Close all). It draws what it is given; the state lives in flows.js.

import { h, fill } from '../dom.js';

const ENTER = 'M2 8h8 M7 5l3 3-3 3 M12 3v10', FULL = 'M8 2v9 M4 8l4 4 4-4 M3 14h10', X = 'M4 4l8 8 M12 4l-8 8';
const svg = (d) => h('svg', { viewBox: '0 0 16 16', html: `<path d="${d}"/>`, 'aria-hidden': 'true' });

/**
 * createTabStrip({ describe(key), onActivate(key), onClose(key), onCloseOthers(key), onCloseAll() })
 *   -> { el, render(state), tabEl(key), focusActive() }
 */
export function createTabStrip(cb) {
  let state = { keys: [], active: null };
  const scroll = h('div.tabscroll', { role: 'tablist', 'aria-label': 'Open flows' });
  const prev = h('button.tabnav', { type: 'button', 'aria-label': 'Scroll tabs left', on: { click: () => scroll.scrollBy({ left: -240, behavior: 'smooth' }) } }, '‹');
  const next = h('button.tabnav', { type: 'button', 'aria-label': 'Scroll tabs right', on: { click: () => scroll.scrollBy({ left: 240, behavior: 'smooth' }) } }, '›');
  const menuBtn = h('button.tabmenu', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'All open flows', on: { click: () => toggleMenu() } });
  const el = h('div.ftabs', prev, scroll, next, menuBtn);
  let pop = null, drawPop = null;

  const withColor = (el, c) => { el.style.setProperty('--tc', c); return el; };
  const label = (d) => [h('b', d.title), d.sub ? [' ', h('i', `· ${d.sub}`)] : null];
  const tabFor = (key) => {
    const d = cb.describe(key), on = key === state.active;
    const t = h('div.tab', { role: 'tab', tabIndex: on ? 0 : -1, 'aria-selected': String(on), title: d.tip, class: `${on ? 'on' : ''} ${d.kind}`, 'data-key': key,
      on: { click: (e) => { if (!e.target.closest('.x')) cb.onActivate(key); }, auxclick: (e) => { if (e.button === 1) { e.preventDefault(); cb.onClose(key); } }, mousedown: (e) => { if (e.button === 1) e.preventDefault(); } } },
      d.tn ? h('span.tn', d.tn) : svg(d.kind === 'full' ? FULL : ENTER),
      h('span.tl', label(d)),
      h('button.x', { type: 'button', tabIndex: -1, 'aria-label': `Close ${d.title}`, title: 'Close (Alt+W)', on: { click: (e) => { e.stopPropagation(); cb.onClose(key); } } }, svg(X)));
    t.style.setProperty('--tc', d.color);
    return t;
  };
  scroll.addEventListener('keydown', (e) => {
    const i = state.keys.indexOf(e.target.closest?.('.tab')?.dataset.key ?? state.active);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: state.keys.length - 1 }[e.key];
    if (to != null) { e.preventDefault(); const k = state.keys[(to + state.keys.length) % state.keys.length]; cb.onActivate(k); queueMicrotask(() => tabEl(k)?.focus()); }
    else if (e.key === 'Delete' && i >= 0) { e.preventDefault(); cb.onClose(state.keys[i]); }
  });

  const tabEl = (key) => [...scroll.children].find((c) => c.dataset.key === key) ?? null;
  const edges = () => {
    const max = scroll.scrollWidth - scroll.clientWidth;
    scroll.classList.toggle('fadeL', scroll.scrollLeft > 2);
    scroll.classList.toggle('fadeR', scroll.scrollLeft < max - 2);
    prev.hidden = next.hidden = max <= 2;
  };
  scroll.addEventListener('scroll', edges, { passive: true });
  const reveal = () => { // keep the active tab in view
    const t = tabEl(state.active);
    if (!t) return;
    const l = t.offsetLeft - scroll.offsetLeft, r = l + t.offsetWidth;
    if (l < scroll.scrollLeft + 36) scroll.scrollLeft = Math.max(0, l - 36);
    else if (r > scroll.scrollLeft + scroll.clientWidth - 36) scroll.scrollLeft = r - scroll.clientWidth + 36;
  };

  function closeMenu() { pop?.remove(); pop = null; drawPop = null; menuBtn.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); removeEventListener('pointerdown', outside, true); removeEventListener('keydown', onKey, true); }
  const outside = (e) => { if (pop && !pop.contains(e.target) && !menuBtn.contains(e.target)) closeMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); menuBtn.focus(); } };
  function toggleMenu() {
    if (pop) return closeMenu();
    const list = h('div.tabpop-list', { role: 'listbox', 'aria-label': 'Open flows' });
    const filter = h('input.input', { type: 'search', placeholder: 'Filter open flows', 'aria-label': 'Filter open flows' });
    const draw = () => {
      const q = filter.value.trim().toLowerCase();
      fill(list, state.keys.map((k) => ({ k, d: cb.describe(k) })).filter(({ d }) => !q || `${d.tn ?? ''} ${d.title} ${d.sub}`.toLowerCase().includes(q)).map(({ k, d }) =>
        withColor(h('div.ctx-item.tabrow', { role: 'option', 'aria-selected': String(k === state.active), class: k === state.active ? 'on' : '' },
          h('button.tabrow-b', { type: 'button', on: { click: () => { closeMenu(); cb.onActivate(k); } } }, d.tn ? h('span.tn', d.tn) : svg(d.kind === 'full' ? FULL : ENTER), h('span.tl', label(d))),
          h('button.x', { type: 'button', 'aria-label': `Close ${d.title}`, on: { click: () => { cb.onClose(k); if (!state.keys.length) closeMenu(); } } }, svg(X))), d.color)));
      if (!list.children.length) list.append(h('p.xs.muted', { style: { padding: '6px 10px' } }, 'No open flow matches.'));

    };
    filter.addEventListener('input', draw);
    pop = h('div.tabpop', { role: 'dialog', 'aria-label': 'Open flows' }, h('div.tabpop-s', filter), list,
      h('div.tabpop-f', h('button.btn.sm', { type: 'button', on: { click: () => { closeMenu(); cb.onCloseOthers(state.active); } } }, 'Close others'),
        h('button.btn.sm', { type: 'button', on: { click: () => { closeMenu(); cb.onCloseAll(); } } }, 'Close all')));
    draw(); drawPop = draw;
    el.append(pop);
    menuBtn.classList.add('open'); menuBtn.setAttribute('aria-expanded', 'true');
    setTimeout(() => { addEventListener('pointerdown', outside, true); addEventListener('keydown', onKey, true); });
    filter.focus({ preventScroll: true });
  }

  function render(s) {
    state = s;
    const had = document.activeElement?.closest?.('.tab') ? document.activeElement.closest('.tab').dataset.key : null;
    fill(scroll, s.keys.map(tabFor));
    fill(menuBtn, '▾ ', h('b', String(s.keys.length)));
    el.hidden = false;
    menuBtn.hidden = !s.keys.length;
    if (had && tabEl(had)) tabEl(had).focus();
    reveal(); edges();
    requestAnimationFrame(() => { reveal(); edges(); });
    if (pop && !s.keys.length) closeMenu(); else drawPop?.();
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(edges).observe(scroll);
  return { el, render, tabEl, focusActive: () => tabEl(state.active)?.focus(), closeMenu };
}
