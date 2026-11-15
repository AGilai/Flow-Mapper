// What a document shows besides text (Unreleased, frame 28d-f), in read mode: reference chips that link into the app, Mermaid blocks, and callouts
// (Key step, Watch, Risk) tied to a step. The body is already sanitized (core/rich-text.js); these functions only dress it. The app has no Mermaid
// renderer, so a Mermaid block shows its source with a note.

import { h } from '../dom.js';
import { parseRef, CALLOUT_LABEL } from '../../core/callouts.js';

const enc = encodeURIComponent;
const SVG = {
  key: 'M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.200l-3.700 2.100.8-4.100L2 6.300l4.200-.500z',
  bang: 'M8 2.500l6 10.500H2zM8 6.500v3M8 11.200v.1',
};
export const calloutIcon = (kind) => h('span.nt-co-i', { html: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${kind === 'key' ? SVG.key : SVG.bang}"/></svg>` });

/** The hash a reference chip links to: a service page, or a flow tab (with `step=` for a step). */
export function refHref(ref, env) {
  if (ref.kind === 'svc') return `#/services/${enc(ref.service)}?env=${enc(env)}`;
  const k = `${ref.service}/${ref.ingress}`;
  return `#/flows?env=${enc(env)}&tabs=${enc(k)}&tab=${enc(k)}${ref.step ? `&step=${ref.step}` : ''}`;
}

/** `span[data-ref]` -> a link chip (service: a dot; flow; call / step). Anything that does not parse stays plain text. */
export function renderRefs(root, env) {
  root.querySelectorAll('span[data-ref]').forEach((s) => {
    const ref = parseRef(s.dataset.ref);
    if (!ref) { s.replaceWith(document.createTextNode(s.textContent)); return; }
    const kind = ref.kind === 'step' ? 'call' : ref.kind;
    s.replaceWith(h(`a.nt-ref.${kind}`, { href: refHref(ref, env), 'data-qa': 'nt-ref', title: ref.kind === 'svc' ? `Open ${ref.service}` : ref.kind === 'flow' ? `Open the flow ${ref.service} · ${ref.ingress}` : `Open step ${ref.step} of ${ref.service} · ${ref.ingress}` }, ref.kind === 'svc' ? h('i') : null, s.textContent));
  });
}

/** `pre[data-mermaid]` -> the source in a labelled box (no renderer in the app). */
export function renderMermaid(root) {
  root.querySelectorAll('pre[data-mermaid]').forEach((p) => {
    const src = [...p.childNodes].map((n) => (n.nodeName === 'BR' ? '\n' : n.textContent)).join('');
    p.replaceWith(h('figure.nt-mm', { 'data-qa': 'nt-mermaid' }, h('figcaption', h('b', 'Mermaid'), ' source, shown as text: this app does not draw Mermaid yet.'), h('pre', h('code', src))));
  });
}

/**
 * Callouts: `div[data-callout]` -> a coloured card with its label and step chip. `steps()` is the flow's number of steps (0: not known),
 * `onStep(n)` jumps to the step, `onHover(n | null)` is the pointer on a card (the diagram outlines the step). Returns [{ el, kind, step }] in reading order.
 */
export function renderCallouts(root, { steps = () => 0, onStep, onHover } = {}) {
  return [...root.querySelectorAll('div[data-callout]')].map((el) => {
    const kind = el.dataset.callout, n = Number(el.dataset.step) || null;
    const chip = n ? h('button.nt-co-s', { type: 'button', title: `Go to step ${n}`, 'data-qa': 'nt-co-step', on: { click: () => onStep?.(n) } }, String(n)) : null;
    const gone = () => !!n && steps() > 0 && n > steps();
    const head = h('div.nt-co-h', calloutIcon(kind), h('b', CALLOUT_LABEL[kind] ?? kind), chip, h('span.nt-co-g', { hidden: true }, 'step no longer in the flow'));
    el.classList.add('nt-co', 'co-js'); el.prepend(head);
    const paint = () => { head.querySelector('.nt-co-g').hidden = !gone(); chip?.classList.toggle('gone', gone()); };
    paint();
    el.addEventListener('pointerenter', () => onHover?.(gone() ? null : n, kind)); el.addEventListener('pointerleave', () => onHover?.(null));
    el.addEventListener('focusin', () => onHover?.(gone() ? null : n, kind)); el.addEventListener('focusout', () => onHover?.(null));
    return { el, kind, step: n, paint };
  });
}
