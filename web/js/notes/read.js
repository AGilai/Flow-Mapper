// The Notes document in read mode (0.34.0, frame 20a): the sanitized body, @mention chips (frame 18), step chips that jump to the step, and the outline
// of the headings (shown by CSS at >= 1280 px, 1360 with the rail open). A step chip follows the step number; one that no longer exists reads "step 4 (gone)".

import { h } from '../dom.js';
import { sanitize } from '../../core/rich-text.js';
import { parseStepRef, stepRefText, clampRef } from '../../core/notes.js';
import { renderChips } from '../users/chips.js';

/** The label of a chip for a flow of `n` steps (0: not known yet): { text, gone, title }. */
export function chipLook(ref, n) {
  const c = clampRef(ref, n);
  if (!c) return { text: `${stepRefText(ref)} (gone)`, gone: true, title: 'The flow has changed: that step is no longer in it' };
  if (c.was) return { text: `${stepRefText(c)} (was ${ref.from}–${ref.to})`, gone: false, title: `Go to step ${c.from}` };
  return { text: stepRefText(c), gone: false, title: `Go to ${ref.to > ref.from ? `steps ${ref.from}–${ref.to}` : `step ${ref.from}`} in the walk` };
}

/**
 * docView(body, { steps() -> number of steps, onStep(ref) }) -> { el, outline, relabel(), dispose() }
 * outline: a <nav> of the headings (null when there are none); `relabel()` after the walk's steps changed.
 */
export function docView(body, { steps = () => 0, onStep }) {
  const el = renderChips(h('div.nt-doc.cm-body', { html: sanitize(body, { notes: true }) }));
  const chips = [...el.querySelectorAll('span[data-step]')].map((s) => {
    const ref = parseStepRef(s.dataset.step), b = h('button.nt-sc', { type: 'button', 'data-qa': 'nt-step', on: { click: () => { if (!b.classList.contains('gone')) onStep?.(clampRef(ref, steps()) ?? ref, ref); } } });
    s.replaceWith(b);
    return { b, ref };
  }).filter((c) => c.ref);
  const relabel = () => { for (const { b, ref } of chips) { const l = chipLook(ref, steps()); b.textContent = l.text; b.title = l.title; b.classList.toggle('gone', l.gone); b.setAttribute('aria-disabled', String(l.gone)); } };
  relabel();
  const heads = [...el.querySelectorAll('h2, h3')].filter((x) => x.textContent.trim());
  let outline = null, io = null;
  if (heads.length > 1) {
    const links = heads.map((x) => h('button.nt-ol-i', { type: 'button', class: x.tagName === 'H3' ? 's' : '', on: { click: () => { x.scrollIntoView({ block: 'start', behavior: matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } } }, x.textContent.trim()));
    outline = h('nav.nt-ol', { 'aria-label': 'On this page', 'data-qa': 'nt-outline' }, h('h5', 'On this page'), links);
    links[0].classList.add('on');
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((es) => { const seen = es.filter((e) => e.isIntersecting).map((e) => heads.indexOf(e.target)).sort((a, b) => a - b)[0]; if (seen != null) links.forEach((l, i) => l.classList.toggle('on', i === seen)); }, { rootMargin: '0px 0px -70% 0px' });
      heads.forEach((x) => io.observe(x));
    }
  }
  return { el, outline, relabel, dispose: () => io?.disconnect() };
}
