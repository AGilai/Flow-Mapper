// #128: Fit and zoom act on the ACTIVE diagram: the tab's own, or the async card the viewer last pressed in or expanded.
// A card has a scale of its own (flow-render.js setScale), starting at 100%; this holds which one is active, each card's zoom
// value ('fit' or a percent) and the card-sized Fit and anchored zoom. The tab's own zoom stays in flow-tab-view.js.

import { clampRange, fitScale, scaleOf, anchorDelta, activeAfter, cardRoom } from './flow-zoom-pure.js';
import { naturalSize } from './flow-zoom.js';

/**
 * createCardZoom({ scroller, index() (the tab's async index or null), paint() (the zoom box and the card edge), edge() }) ->
 *   { active(), mark(), activate(flow|null), closed(flow), hit(target, prev) -> flow|null, valueOf(flow), scaleOf(flow), refit(), anyFit(), set(flow, v, at) }
 */
export function createCardZoom({ scroller, index, paint, edge }) {
  let active = null; const zooms = new WeakMap(); // flow -> 'fit' | percent
  const flows = () => index()?.flows() ?? [];
  const valueOf = (f) => zooms.get(f) ?? 100;
  const fitCard = (f) => { // a card's Fit: its box's width (and the window's height for a short one), like the tab's
    const nat = naturalSize(f.laneBox), vw = cardRoom(f.laneBox.parentElement?.clientWidth);
    return nat && vw ? fitScale({ ...nat, vw, vh: scroller.clientHeight }) : null;
  };
  const apply = (f) => { const z = valueOf(f); f.setScale(scaleOf(z, z === 'fit' ? fitCard(f) : null)); };
  const activate = (f) => { if (f !== active) { active = f; paint(); } };
  return {
    mark: () => { const idx = index(); idx?.flows().forEach((x) => idx.cardOf(x)?.classList.toggle('active-card', x === active)); }, // the active card wears an edge
    active: () => active, activate, valueOf, scaleOf: (f) => f.scale(),
    closed: (f) => { if (f === active) activate(null); }, // the active card was collapsed: the tab's own diagram is active again
    /** A press (or wheel) on `target`: the card it sits in, 'list' (the async list's header or gaps: no change) or the tab's own diagram. */
    hit(target) { const idx = index(); const hit = !idx || !target?.closest ? 'top' : idx.flowOf(target) ?? (target.closest('.cards') ? 'list' : 'top'); activate(activeAfter(active, hit)); return active; },
    refit: () => flows().forEach(apply), // after a new width or lane: cards on Fit take their box again
    anyFit: () => flows().some((f) => zooms.get(f) === 'fit'),
    set(f, v, at) { // zoom one card; a point under the pointer stays under it
      const lane = f.laneBox.parentElement, svg = f.laneBox.querySelector('svg.seq-body'), r0 = svg?.getBoundingClientRect(), before = f.scale();
      zooms.set(f, v === 'fit' ? 'fit' : clampRange(v)); apply(f); paint();
      if (valueOf(f) === 'fit') { lane.scrollLeft = 0; edge(); return; }
      if (!r0 || !svg) return;
      const x = at?.x ?? lane.getBoundingClientRect().left + lane.clientWidth / 2;
      lane.scrollLeft += anchorDelta({ origin0: r0.left, origin1: svg.getBoundingClientRect().left, at: x, from: before, to: f.scale() });
      edge();
    },
  };
}
