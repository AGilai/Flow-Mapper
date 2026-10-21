// Drawing of references on a lane (0.26.0): the lock on a lifeline head (every message into it is a reference, D6), and at the end of an arrow into a
// reference the lock, "behaviour in <source>" and the way on: "Import into design" (Edit with a draft opens the preview) or "Open in <source>" (View).
// Neutral (`--ink-2`), never a warning. Pure data in flow-refs.js.

import { s } from '../dom.js';
import { href } from '../router.js';
import { lockSvg } from '../components/lock.js';
import { lockedServices, refOf, ingressOf } from './flow-refs.js';

/** createRefs(trace, { editing, onImport(anchor, msg) }) -> the adapter renderLane draws with, or null when the trace has no reference. */
export function createRefs(trace, { editing = false, onImport = null } = {}) {
  const locked = lockedServices(trace);
  if (!locked.size && !(trace?.messages ?? []).some((m) => m.reference)) return null;
  return {
    editing, onImport,
    locked: (c) => c?.kind === 'service' && locked.has(c.service),
    source: (c) => locked.get(c?.service) ?? null,
    at: (m) => refOf(m),
  };
}

/** The lock at the top-right of a locked head (the status spark keeps the corner). */
export const headRefSvg = (refs, c, w) => (refs?.locked(c) ? lockSvg(w - 22, 5, 12) : null);

/** The sub line of a locked head: "reference from prod". */
export const headRefSub = (refs, c, sub) => (refs?.locked(c) ? [`reference from ${refs.source(c)}`] : sub);

/** At the end of an arrow into a reference: the lock, "behaviour in prod" and the chip or link. `x`: right edge of the bar, `y0`: the arrow's y. */
export function refNoteSvg(refs, e, x, y0) {
  const r = refs?.at(e.msg);
  if (!r) return null;
  const to = ingressOf(r.anchor), W = 126, note = `behaviour in ${r.source}`;
  const label = refs.editing ? 'Import into design' : `Open in ${r.source}`;
  const chip = s('g', { class: 'ref-chip', 'data-qa': refs.editing ? 'import-ref' : 'open-ref', tabindex: 0, role: refs.editing ? 'button' : 'link', 'aria-label': `${label}: ${to?.service} ${to?.ingress}` },
    s('rect', { x: x + 14, y: y0 + 10, width: W, height: 18, rx: 9 }), s('text', { x: x + 24, y: y0 + 23 }, label));
  const go = (ev) => { ev.stopPropagation(); ev.preventDefault(); refs.onImport?.(r.anchor, e.msg); };
  if (refs.editing) {
    chip.addEventListener('click', go);
    chip.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') go(ev); });
  } else if (to) {
    chip.addEventListener('click', (ev) => { ev.stopPropagation(); location.hash = href('/flows', { env: r.source, tabs: `${to.service}/${to.ingress}` }).slice(1); });
    chip.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.stopPropagation(); ev.preventDefault(); location.hash = href('/flows', { env: r.source, tabs: `${to.service}/${to.ingress}` }).slice(1); } });
  }
  return s('g', { class: 'ref-note' }, lockSvg(x + 14, y0 - 1, 12), s('text', { x: x + 30, y: y0 + 8.5 }, note), chip, s('title', {}, `${to?.service} ${to?.ingress}: its behaviour lives in ${r.source}, not in this design`));
}
