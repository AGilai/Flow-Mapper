// #113 round 2: the "Why incomplete" balloon. A popover under the amber hazard button of a pane (step or store pane), with a small arrow pointing at it.
// placeBalloon is pure (tests); openBalloon builds the dialog on <body> so no pane clips it, and closes it on the X, Esc, a click outside or the button again.

import { h } from '../dom.js';
import { icon } from '../icons.js';

export const BALLOON_W = 360, GAP = 10, MARGIN = 8;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * placeBalloon({ anchor: {left, top, right, bottom}, vw, vh, w, pill }) -> { left, width, side: 'below' | 'above', top?, bottom?, maxH, arrowX }.
 * Never leaves the window: shifted sideways, flipped above the anchor when there is more room there. `pill`: a rect to keep clear of (the "Exit full screen" pill).
 */
export function placeBalloon({ anchor, vw, vh, w = BALLOON_W, pill = null }) {
  const width = Math.min(w, vw - 2 * MARGIN), cx = (anchor.left + anchor.right) / 2, left = clamp(cx - width / 2, MARGIN, Math.max(MARGIN, vw - width - MARGIN));
  const below = vh - anchor.bottom - GAP - MARGIN, above = anchor.top - GAP - MARGIN, side = below >= Math.min(260, vh * 0.6) || below >= above ? 'below' : 'above';
  let top = anchor.bottom + GAP;
  if (side === 'below' && pill && left < pill.right && left + width > pill.left && top < pill.bottom + MARGIN) top = pill.bottom + MARGIN;
  const room = side === 'below' ? vh - top - MARGIN : above;
  return { left, width, side, ...(side === 'below' ? { top } : { bottom: vh - anchor.top + GAP }), maxH: Math.max(120, Math.min(vh * 0.6, room)), arrowX: clamp(cx - left, 18, width - 18) };
}

/** openBalloon({ content, titleId, anchor (the hazard button), onClose }) -> { el, close() }. `content`: the .inc-why section (its header gets the X). */
export function openBalloon({ content, anchor, onClose }) {
  const head = content.querySelector('.inc-h'), body = h('div.inc-bal-body');
  [...content.childNodes].filter((n) => n !== head).forEach((n) => body.append(n));
  content.append(body);
  const x = h('button.inc-x', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', on: { click: () => close() } }, icon('close'));
  head.append(x);
  const title = head.querySelector('h4'); title.id = 'why-balloon-h';
  const arrow = h('span.inc-arrow', { 'aria-hidden': 'true' });
  const el = h('div.inc-balloon', { id: 'why-balloon', role: 'dialog', 'aria-labelledby': 'why-balloon-h', 'data-qa': 'why-balloon' }, arrow, content);
  content.hidden = false; content.removeAttribute('id'); content.removeAttribute('aria-labelledby');
  const place = () => {
    const pillEl = document.querySelector('.max-exit'), p = placeBalloon({ anchor: anchor.getBoundingClientRect(), vw: document.documentElement.clientWidth, vh: window.innerHeight, pill: pillEl ? pillEl.getBoundingClientRect() : null });
    Object.assign(el.style, { left: `${p.left}px`, width: `${p.width}px`, maxHeight: `${p.maxH}px`, top: p.top != null ? `${p.top}px` : 'auto', bottom: p.bottom != null ? `${p.bottom}px` : 'auto' });
    el.dataset.side = p.side; arrow.style.left = `${p.arrowX}px`;
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(false); }; // the hazard button itself toggles (its own click closes)
  const watch = setInterval(() => { if (!anchor.isConnected || !anchor.getClientRects().length) close(false); }, 300);
  const gone = () => close(false);
  let done = false;
  function close(refocus = true) {
    if (done) return; done = true;
    clearInterval(watch); document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('hashchange', gone); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
    el.remove(); onClose?.(); if (refocus && anchor.isConnected) anchor.focus({ preventScroll: true });
  }
  document.body.append(el); place();
  document.addEventListener('keydown', onKey, true); document.addEventListener('pointerdown', onDown, true); window.addEventListener('hashchange', gone); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
  x.focus({ preventScroll: true });
  return { el, close };
}
