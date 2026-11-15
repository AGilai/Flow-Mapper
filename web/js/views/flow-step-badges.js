// The flow doc's badges on the diagram (Unreleased, frame 28f): a step that a callout names carries a star (Key step) or an exclamation mark (Watch, Risk),
// drawn beside its number. Hovering a callout in the doc outlines its step's band (dashed, with the kind at the right); pressing a badge goes to the callout.
// The badges come from the document (core/callouts.ts `badges`), so they stay when the flow doc pane is hidden. Drawn over one lane from the geometry
// drawStepTiles has: `pos(n)` -> { x, y } of the badge, `row(n)` -> { top, bottom } of the step's row.

import { s } from '../dom.js';
import { CALLOUT_LABEL } from '../../core/callouts.js';

const WORD = { star: 'Key step', bang: 'Watch' };

/** drawBadges(res, pos, row) -> { set(list, onClick(step)), hover(step | null, kind) }; list: core/callouts.ts StepBadge[] */
export function drawBadges(res, pos, row) {
  const layer = s('g', { class: 'docbadges' }), hov = s('g', { class: 'dochov', visibility: 'hidden', 'aria-hidden': 'true' }, s('rect', { rx: 4 }), s('text', {}));
  res.body.append(layer, hov);
  const mark = (b, p, click) => {
    const word = b.kind === 'key' ? 'Key step' : b.kind === 'watch' ? 'Watch' : 'Risk', n = b.callouts.length > 1 ? ` (${b.callouts.length} callouts)` : '';
    const g = s('g', { class: 'docbadge', 'data-step': b.step, 'data-kind': b.kind, role: 'button', tabindex: 0, 'aria-label': `${word} on step ${b.step}${n}: go to the callout`, transform: `translate(${p.x} ${p.y})` },
      b.badge === 'star' ? s('g', { class: 'bd-key' }, s('circle', { r: 8 }), s('text', { y: 4 }, '★')) : s('g', { class: `bd-bang ${b.kind}` }, s('path', { d: 'M0 -8.500 L8.500 6.500 H-8.500 Z', 'stroke-linejoin': 'round' }), s('text', { y: 4.500 }, '!')),
      s('title', {}, `${b.kinds.map((k) => CALLOUT_LABEL[k]).join(', ')} on step ${b.step}`));
    g.addEventListener('click', (ev) => { ev.stopPropagation(); click?.(b.step); });
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); click?.(b.step); } });
    return g;
  };
  return {
    set(list, click) { layer.replaceChildren(...list.map((b) => { const p = pos(b.step); return p ? mark(b, p, click) : null; }).filter(Boolean)); },
    hover(step, kind = 'watch') {
      const r = step ? row(step) : null;
      if (!r) { hov.setAttribute('visibility', 'hidden'); return; }
      const w = res.geometry.width;
      hov.setAttribute('class', `dochov ${kind}`);
      const rect = hov.firstChild, text = hov.lastChild;
      rect.setAttribute('x', 2); rect.setAttribute('y', r.top + 2); rect.setAttribute('width', Math.max(0, w - 4)); rect.setAttribute('height', Math.max(0, r.bottom - r.top - 4));
      text.setAttribute('x', w - 8); text.setAttribute('y', r.top + 15); text.textContent = CALLOUT_LABEL[kind] ?? WORD.bang;
      hov.setAttribute('visibility', 'visible');
    },
  };
}
