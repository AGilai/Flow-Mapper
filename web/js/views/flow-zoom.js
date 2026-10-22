// Zoom of the flow diagram (0.30.3, #69), the DOM part. The diagram is vector: every lane SVG (the head and the body) carries a viewBox of its own size
// and its width / height are that size times the scale, so text stays crisp at any zoom and nothing is laid out again. The pure rules are flow-zoom-pure.js.

import { h } from '../dom.js';
import { ZMIN, ZMAX, parseTyped, stepZoom, wheelFactor } from './flow-zoom-pure.js';

/** Give a lane SVG its own coordinate box and its size at `scale`. */
export function sizeSvg(svg, w, hh, scale = 1) {
  svg.setAttribute('viewBox', `0 0 ${w} ${hh}`);
  svg.dataset.zw = w; svg.dataset.zh = hh;
  svg.setAttribute('width', w * scale); svg.setAttribute('height', hh * scale);
}
/** Rescale every lane SVG under `root` (the top lane and the cards below it). */
export function applyScale(root, scale) {
  root.querySelectorAll('svg[data-zw]').forEach((v) => { v.setAttribute('width', v.dataset.zw * scale); v.setAttribute('height', v.dataset.zh * scale); });
}
/** The top lane at 100%: { w, h } with its sticky head, or null when there is none. */
export function naturalSize(laneBox) {
  const body = laneBox?.querySelector('svg.seq-body[data-zw]'), head = body?.parentElement?.querySelector('svg.seq-head[data-zw]');
  return body ? { w: Number(body.dataset.zw), h: Number(body.dataset.zh) + Number(head?.dataset.zh ?? 0) } : null;
}

/**
 * createZoomControl({ onZoom(value) }) -> { el, show(percent, fit, enabled) }
 * "- [100%] + Fit Reset". onZoom gets a percent, 'fit' or 100. The % box takes a number (Enter applies, clamped to 25..400; Esc and a bad entry put the current value back).
 */
export function createZoomControl({ onZoom }) {
  let pct = 100;
  const btn = (cls, label, text, fn) => h(`button.btn.sm.zoom-${cls}`, { type: 'button', 'aria-label': label, title: label, 'data-qa': `zoom-${cls}`, on: { click: fn } }, text);
  const input = h('input.zoom-pct', { type: 'text', inputmode: 'numeric', size: 4, 'aria-label': `Zoom percent (${ZMIN} to ${ZMAX})`, title: `Zoom percent, ${ZMIN} to ${ZMAX}. Enter applies.`, 'data-qa': 'zoom-pct', autocomplete: 'off',
    on: { focus: () => input.select(), blur: () => { input.value = `${pct}%`; },
      keydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const v = parseTyped(input.value); if (v == null) input.value = `${pct}%`; else { onZoom(v); input.blur(); } }
        else if (e.key === 'Escape') { e.stopPropagation(); input.value = `${pct}%`; input.blur(); }
        else e.stopPropagation(); // typing digits is not a flow shortcut (F, E, arrows)
      } } });
  const fit = btn('fit', 'Fit the diagram to the window', 'Fit', () => onZoom('fit')), reset = btn('reset', 'Back to 100%', 'Reset', () => onZoom(100));
  const out = btn('out', 'Zoom out', '−', () => onZoom(stepZoom(pct, -1))), inn = btn('in', 'Zoom in', '+', () => onZoom(stepZoom(pct, 1)));
  const el = h('span.zoomc', { role: 'group', 'aria-label': 'Zoom' }, out, input, inn, fit, reset);
  return { el, show(p, isFit, enabled = true) {
    pct = p; if (document.activeElement !== input) input.value = `${p}%`;
    fit.setAttribute('aria-pressed', String(!!isFit));
    [out, inn, fit, reset, input].forEach((x) => { x.disabled = !enabled; });
    out.disabled ||= p <= ZMIN; inn.disabled ||= p >= ZMAX;
  } };
}

/** Ctrl / Cmd + wheel (and a trackpad pinch, which arrives as a ctrl wheel) zooms around the pointer. get() -> the scale; to(scale, { x, y }) applies it. */
export function wireWheel(el, { get, to }) {
  const on = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    to(get() * wheelFactor(e.deltaY, e.deltaMode), { x: e.clientX, y: e.clientY });
  };
  el.addEventListener('wheel', on, { passive: false });
  return () => el.removeEventListener('wheel', on);
}
