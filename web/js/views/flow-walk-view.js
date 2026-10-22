// The step walk of one tab (0.20.0): owns the current step, draws the tiles on each lane it is handed, drives the bar, and answers keys and clicks.
// The current step survives a redraw by its key (message content), never by its row. The URL gets `step=` only when the viewer moves it.

import { stepKeys } from '../../core/description.js';
import { stepsOf, stepAtRow } from './flow-steps.js';
import { drawStepTiles } from './flow-step-tiles.js';
import { createStepbar } from './flow-stepbar.js';
import { clampStep, moveStep, walkAction, scrollLeftFor } from './flow-walk.js';
import { colsOfEvent } from './flow-squeeze.js';
import { openStepEditor } from './flow-step-editor.js';
import { openMenu } from '../components/context-menu.js';

/** Bring a step into view: its row to the middle, and sideways both ends of its arrow when they fit (else the source end). */
function reveal(tiles, n, behavior, barEl = null, z = 1) {
  const row = tiles?.rowEl(n), sp = tiles?.span(n), box = row?.closest('.seq-scroll');
  if (!row || !box) return;
  const r = row.getBoundingClientRect(), b = box.getBoundingClientRect(), svg = row.ownerSVGElement?.getBoundingClientRect();
  const cover = Math.max(0, Math.min(b.height / 2, (barEl?.getBoundingClientRect().bottom ?? 0) - b.top)) + (box.classList.contains('zoom-loose') ? 0 : box.querySelector('.seq-sticky')?.offsetHeight ?? 0); // what sits over the top of the diagram: the bar when maximized (its real height) and the sticky heads
  const top = box.scrollTop + (r.top + r.height / 2) - (b.top + cover + Math.max(0, b.height - cover) / 2);
  const off = svg ? svg.left - b.left + box.scrollLeft : 0, left = sp && svg ? scrollLeftFor({ from: sp.x1 * z + off, to: sp.x2 * z + off, left: box.scrollLeft, view: box.clientWidth }) : box.scrollLeft;
  box.scrollTo({ top: Math.max(0, top), left, behavior });
}

const calm = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** createWalkView({ store, root, messages, initial, onStep(n), onRestep(cols) }) -> { el, decorate(res, built), endsOf(built), hit(event), onKey(ev), move(action), current(), dispose }
 *  onSteps(steps): the numbering of the lane just drawn (the partial-flow line reads it). onRestep(cols): the viewer moved to a step whose lifelines are the columns `cols` (Squeeze folds again for it). endsOf(built): the columns of the current step, before the lane is drawn. */
export function createWalkView({ store, root, messages = () => null, initial = null, sb = () => 'tad', hl = () => true, zoom = () => 1, onStep, onRestep, onSteps, onPick, readOnly = false }) {
  let steps = [], built = null, tiles = null, cur = initial ?? 1, curKey = null, jumpOnDraw = initial != null, rng = null; // rng: the range band (0.34.0), kept across a redraw
  let picked = initial != null; // a step the viewer chose (a click, a key, a link with step=): the comments' "Attach to step N" only offers one then
  const watchers = new Set(); // the comments section reads the steps and the current one (0.27.0)
  const bar = createStepbar({ store, root, sb, readOnly, onMove: (a) => move(a), onEdit: (anchor) => edit(steps[cur - 1], anchor) });
  /** The step editor (0.30.0) for a step, hanging under `anchor` (the bar, or the step's row). */
  function edit(st, anchor = bar.bar) { if (root && st && !readOnly) openStepEditor({ store, root, key: st.key, n: st.n, label: st.label, anchor }); }

  function go(n, { scroll = true, user = true } = {}) {
    cur = clampStep(n, steps.length);
    if (user) picked = true;
    const st = steps[cur - 1] ?? null;
    curKey = st?.key ?? null;
    tiles?.setCurrent(cur);
    bar.show(st, cur, steps.length);
    watchers.forEach((f) => f(cur, st));
    if (user && st) { onStep?.(cur); if (built) onRestep?.(colsOfEvent(built, st.event)); } // before the scroll: a fold redraws the lane and its tiles
    if (scroll && st) reveal(tiles, cur, calm() ? 'auto' : 'smooth', bar.el, zoom());
  }
  function move(action) { go(moveStep(cur, steps.length, action)); }

  /** A lane was drawn (first time, or again): number its arrows and put the highlight back on the same step. */
  function decorate(res, lane) {
    built = lane;
    steps = stepsOf(built, stepKeys, messages());
    onSteps?.(steps);
    tiles = steps.length ? drawStepTiles(res, built, steps, (n, ev) => { if (!onPick?.(n, ev)) go(n); }, root && !readOnly ? (n) => { go(n, { scroll: false }); edit(steps[n - 1], tiles?.rowEl(n)); } : null, hl) : null;
    if (root && !readOnly && steps.length) res.body.addEventListener('contextmenu', (ev) => { // right-click an arrow: Edit step description…
      const g = ev.target.closest?.('.msg[data-e]'), st = g && !ev.defaultPrevented ? stepAtRow(steps, Number(g.getAttribute('data-e'))) : null;
      if (!st) return;
      ev.preventDefault(); go(st.n, { scroll: false });
      openMenu(ev.clientX, ev.clientY, `Step ${st.n}`, [{ label: 'Edit step description…', icon: 'edit', hint: 'Title and description of this step (E)', onSelect: () => edit(st, g) }]);
    });
    tiles?.setRange(rng?.[0] ?? null, rng?.[1] ?? null);
    const keep = steps.find((s) => s.key === curKey);
    go(keep ? keep.n : cur, { scroll: false, user: false });
    if (jumpOnDraw) requestAnimationFrame(() => requestAnimationFrame(() => reveal(tiles, cur, 'auto', null, zoom()))); // a link opened on a step: the lane is not attached yet
    jumpOnDraw = false;
  }
  function endsOf(lane) { // the step Squeeze keeps on screen: the current one (by key), else the first
    const all = stepsOf(lane, stepKeys, messages()), st = all.find((x) => x.key === curKey) ?? all[clampStep(cur, all.length) - 1];
    return st ? colsOfEvent(lane, st.event) : [];
  }
  return {
    el: bar.el, decorate, endsOf, refreshBar: () => bar.refresh(), refreshHl: () => tiles?.setCurrent(cur),
    /** A double-click on a step's text on its arrow, by key. */
    editKey(key) { const st = steps.find((x) => x.key === key); if (st) { go(st.n, { scroll: false }); edit(st, tiles?.rowEl(st.n)); } },
    steps: () => steps, picked: () => picked, rowSpan: (n) => tiles?.rowSpan(n) ?? null,
    /** The band over a range of steps (a hovered or chosen bracket); hlRange(null) takes it away. */
    hlRange: (from, to) => { rng = from == null ? null : [from, to]; tiles?.setRange(from, to); }, go: (n) => go(n), watch: (f) => { watchers.add(f); return () => watchers.delete(f); },
    /** Scroll the current step into view and (focus) put focus on its arrow: a fold the viewer had focused was just redrawn away. */
    reveal(focus = false) { reveal(tiles, cur, 'auto', bar.el, zoom()); if (focus) (tiles?.rowEl(cur) ?? null)?.focus({ preventScroll: true }); }, move, current: () => cur,
    hit(event) { const st = stepAtRow(steps, event.row); if (st) go(st.n, { scroll: false }); }, // a click on an arrow: the walk jumps to it
    onKey(ev) {
      if ((ev.key === 'e' || ev.key === 'E') && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.defaultPrevented && root && steps.length && !/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target?.tagName) && !ev.target?.isContentEditable && !ev.target?.closest?.('.fi, .cm-sec')) { ev.preventDefault(); edit(steps[cur - 1], tiles?.rowEl(cur)); return; } // E: edit the current step
      const a = walkAction(ev); if (a && steps.length) { ev.preventDefault(); move(a); } },
    dispose: () => bar.dispose(),
  };
}
