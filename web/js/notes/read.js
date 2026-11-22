// The Notes document in read mode (0.34.0, frame 20a): the sanitized body, @mention chips (frame 18), step chips that jump to the step, and the outline
// of the headings (shown by CSS at >= 1280 px, 1360 with the rail open). A step chip follows the step number; one that no longer exists reads "step 4 (gone)".

import { h } from '../dom.js';
import { sanitize } from '../../core/rich-text.js';
import { parseStepRef, stepRefText, clampRef } from '../../core/notes.js';
import { renderChips } from '../users/chips.js';
import { stepOfKey } from '../views/flow-scenario-pure.js';
import { renderRefs, renderMermaid, renderCallouts } from './blocks.js';
import { applyColWidths } from './col-width.js';

/** The label of a chip for a flow of `n` steps (0: not known yet): { text, gone, title }. */
export function chipLook(ref, n) {
  const c = clampRef(ref, n);
  if (!c) return { text: `${stepRefText(ref)} (gone)`, gone: true, title: 'The flow has changed: that step is no longer in it' };
  if (c.was) return { text: `${stepRefText(c)} (was ${ref.from}–${ref.to})`, gone: false, title: `Go to step ${c.from}` };
  return { text: stepRefText(c), gone: false, title: `Go to ${ref.to > ref.from ? `steps ${ref.from}–${ref.to}` : `step ${ref.from}`} in the walk` };
}

/**
 * docView(body, { steps() -> number of steps, onStep(ref), env, onHover(step | null) }) -> { el, outline, relabel(), focusCallout(step), dispose() }
 * outline: a <nav> of the headings (null when there are none); `relabel()` after the walk's steps changed. `env` is where reference chips link; `onHover` is the pointer on a callout card.
 */
export function docView(body, { steps = () => 0, onStep, list = () => [], hidden = () => null, env = null, onHover }) { // list(): the walk's steps; hidden(key): a step the scenario does not show ({ text, show() }) or null (0.38.0)
  const el = renderChips(h('div.nt-doc.cm-body', { html: sanitize(body, { notes: true }) }));
  applyColWidths(el);
  if (env) renderRefs(el, env);
  renderMermaid(el);
  const cards = renderCallouts(el, { steps, onStep: (n) => onStep?.({ from: n, to: n }), onHover });
  const chips = [...el.querySelectorAll('span[data-step]')].map((s) => {
    const ref = parseStepRef(s.dataset.step), key = s.dataset.key || null, keyTo = s.dataset.keyTo || null, b = h('button.nt-sc', { type: 'button', 'data-qa': 'nt-step', on: { click: () => { const hid = key && !stepOfKey(list(), key) ? hidden(key) : null; if (hid) hid.show(); else if (!b.classList.contains('gone')) onStep?.(look(ref, key, keyTo).ref ?? clampRef(ref, steps()) ?? ref, ref); } } });
    s.replaceWith(b);
    return { b, ref, key, keyTo };
  }).filter((c) => c.ref);
  /** A chip with a key follows its step: its number in the walk now; "not in this scenario" when an arm hides it (a click shows it); else the number-only look. */
  const look = (ref, key, keyTo) => {
    if (!key) return { ...chipLook(ref, steps()), ref: null };
    const a = stepOfKey(list(), key), z = keyTo ? stepOfKey(list(), keyTo) : null;
    if (a) { const r = { from: a.n, to: z && z.n >= a.n ? z.n : a.n }; return { text: stepRefText(r), gone: false, title: `Go to ${stepRefText(r)} in the walk`, ref: r }; }
    const hid = hidden(key);
    if (hid) return { text: `${stepRefText(ref)} · ${hid.text}`, gone: false, hid: true, title: hid.locked ? 'A fixed decision keeps this step out' : 'Click to show it: the decision switches to the arm that holds this step', ref: null };
    return { ...chipLook(ref, steps()), ref: null };
  };
  const relabel = () => { cards.forEach((c) => c.paint()); for (const { b, ref, key, keyTo } of chips) { const l = look(ref, key, keyTo); b.textContent = l.text; b.title = l.title; b.classList.toggle('gone', l.gone); b.classList.toggle('hid', !!l.hid); b.setAttribute('aria-disabled', String(l.gone)); } };
  relabel();
  const heads = [...el.querySelectorAll('h1, h2, h3')].filter((x) => x.textContent.trim() && !(x.tagName === 'H1' && x === el.firstElementChild)); // the title of a page is not in its own outline
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
  const focusCallout = (step) => { const c = cards.find((x) => x.step === step); if (!c) return false; c.el.scrollIntoView({ block: 'nearest', behavior: matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); c.el.classList.add('flash'); setTimeout(() => c.el.classList.remove('flash'), 1600); return true; };
  return { el, outline, relabel, focusCallout, dispose: () => io?.disconnect() };
}
