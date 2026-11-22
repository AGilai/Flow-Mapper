// Live Mermaid preview in the document editor (Unreleased). Under each Mermaid block a box draws the diagram with the reader's own loader (diagram.js).
// The boxes live in an overlay layer OUTSIDE the editable area, so they are never part of the document: not in getHtml(), the draft, the dirty check
// or undo, and the caret cannot enter them. To leave room, the block gets a bottom margin (an inline style that the sanitizer drops on save) equal to
// its box's height. Typing in a block redraws after 500 ms; a block that does not parse keeps its last good drawing, dimmed, with Mermaid's message
// (it names the line) in an error box above it. Each box has a Hide / Show preview toggle (kept in memory per block).

import { h } from '../dom.js';
import { drawDiagram, mermaidSource, trackTheme } from './diagram.js';

const DEBOUNCE = 500;

/** attachPreviews(ed, wrap) -> { update(), dispose() }: `wrap` is the positioned box around the editor; call update() on every change. */
export function attachPreviews(ed, wrap) {
  const area = ed.el, layer = h('div.nt-pv-layer', { 'aria-hidden': 'false' });
  wrap.append(layer);
  const states = new Map(); // pre -> state
  let raf = 0;

  const place = () => {
    raf = 0;
    const wr = wrap.getBoundingClientRect(), zoom = parseFloat(getComputedStyle(area).zoom) || 1;
    for (const [pre, s] of states) {
      if (!pre.isConnected) continue;
      const r = pre.getBoundingClientRect(), boxH = s.box.offsetHeight;
      s.box.style.top = `${r.bottom - wr.top - wrap.clientTop + 4}px`;
      s.box.style.left = `${r.left - wr.left - wrap.clientLeft}px`;
      s.box.style.width = `${r.width}px`;
      const want = `${Math.round((boxH + 12) / zoom)}px`;
      if (pre.style.marginBottom !== want) pre.style.marginBottom = want;
    }
  };
  const later = () => { if (!raf) raf = requestAnimationFrame(place); };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null;
  ro?.observe(area);
  window.addEventListener('resize', later);

  function paint(s) {
    const mine = ++s.ver;
    if (!s.src) { s.view.replaceChildren(); s.err.hidden = true; s.view.classList.remove('stale'); later(); return; }
    drawDiagram(s.src).then((svg) => {
      if (mine !== s.ver) return;
      s.view.innerHTML = svg; s.view.classList.remove('stale'); s.err.hidden = true; later();
    }, (e) => {
      if (mine !== s.ver) return;
      if (!s.view.querySelector('svg')) s.view.replaceChildren(); // never drawn: no "Drawing…" left behind
      s.view.classList.add('stale'); // the last good drawing stays, dimmed
      s.err.textContent = String(e?.message ?? e).split('\n').filter((l) => l.trim()).slice(0, 6).join('\n');
      s.err.hidden = false; later();
    });
  }

  function create(pre, src) {
    const keep = (e) => e.preventDefault(); // a click must not take the caret out of the document
    const view = h('div.nt-dg-view.nt-pv-view', { 'data-qa': 'nt-preview-view' }, h('span.nt-dg-wait', 'Drawing the diagram…'));
    const err = h('pre.nt-dg-err.nt-pv-err', { role: 'alert', hidden: true, 'data-qa': 'nt-preview-error' });
    const body = h('div.nt-pv-body', err, view);
    const toggle = h('button.btn.sm', { type: 'button', 'data-qa': 'nt-preview-toggle', on: { mousedown: keep, click: () => { s.off = !s.off; sync(); } } }, 'Hide preview');
    const box = h('figure.nt-dg.nt-pv', { 'data-qa': 'nt-preview' }, h('div.nt-dg-bar', h('b', 'Preview'), toggle), body);
    const s = { pre, box, view, err, src, ver: 0, timer: 0, off: false };
    const sync = () => { body.hidden = s.off; toggle.textContent = s.off ? 'Show preview' : 'Hide preview'; later(); };
    ro?.observe(box);
    trackTheme({ get isConnected() { return box.isConnected && pre.isConnected; }, paint: () => paint(s) });
    layer.append(box); states.set(pre, s);
    paint(s);
  }

  function drop(pre, s) { clearTimeout(s.timer); s.ver++; ro?.unobserve(s.box); s.box.remove(); states.delete(pre); if (pre.isConnected) pre.style.marginBottom = ''; }

  function update() {
    const seen = new Set();
    area.querySelectorAll('pre').forEach((pre) => {
      const src = mermaidSource(pre);
      if (src == null) { const s = states.get(pre); if (s) drop(pre, s); return; }
      seen.add(pre);
      const s = states.get(pre);
      if (!s) { create(pre, src); return; }
      if (src !== s.src) { s.src = src; clearTimeout(s.timer); s.timer = setTimeout(() => paint(s), DEBOUNCE); }
    });
    for (const [pre, s] of [...states]) if (!seen.has(pre)) drop(pre, s);
    later();
  }

  return { update, dispose() { for (const [pre, s] of [...states]) drop(pre, s); ro?.disconnect(); window.removeEventListener('resize', later); cancelAnimationFrame(raf); layer.remove(); } };
}
