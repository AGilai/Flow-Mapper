// The step walk of one tab (0.20.0): owns the current step, draws the tiles on each lane it is handed, drives the bar, and answers keys and clicks.
// The current step survives a redraw by its key (message content), never by its row. The URL gets `step=` only when the viewer moves it.

import { stepKeys } from '../../core/description.js';
import { stepsOf, stepAtRow } from './flow-steps.js';
import { drawStepTiles } from './flow-step-tiles.js';
import { createStepbar } from './flow-stepbar.js';
import { clampStep, moveStep, walkAction } from './flow-walk.js';
import { colsOfEvent } from './flow-squeeze.js';

const calm = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** createWalkView({ store, root, messages, initial, onStep(n), onRestep(cols) }) -> { el, decorate(res, built), endsOf(built), hit(event), onKey(ev), move(action), current(), dispose }
 *  onRestep(cols): the viewer moved to a step whose lifelines are the columns `cols` (Squeeze folds again for it). endsOf(built): the columns of the current step, before the lane is drawn. */
export function createWalkView({ store, root, messages = () => null, initial = null, onStep, onRestep }) {
  let steps = [], built = null, tiles = null, cur = initial ?? 1, curKey = null, jumpOnDraw = initial != null;
  const bar = createStepbar({ store, root, onMove: (a) => move(a) });

  function go(n, { scroll = true, user = true } = {}) {
    cur = clampStep(n, steps.length);
    const st = steps[cur - 1] ?? null;
    curKey = st?.key ?? null;
    tiles?.setCurrent(cur);
    bar.show(st, cur, steps.length);
    if (user && st) { onStep?.(cur); if (built) onRestep?.(colsOfEvent(built, st.event)); } // before the scroll: a fold redraws the lane and its tiles
    if (scroll && st) tiles?.rowEl(cur)?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
  }
  function move(action) { go(moveStep(cur, steps.length, action)); }

  /** A lane was drawn (first time, or again): number its arrows and put the highlight back on the same step. */
  function decorate(res, lane) {
    built = lane;
    steps = stepsOf(built, stepKeys, messages());
    tiles = steps.length ? drawStepTiles(res, built, steps, (n) => go(n)) : null;
    const keep = steps.find((s) => s.key === curKey);
    go(keep ? keep.n : cur, { scroll: false, user: false });
    if (jumpOnDraw) requestAnimationFrame(() => requestAnimationFrame(() => tiles?.rowEl(cur)?.scrollIntoView({ block: 'center', inline: 'nearest' }))); // a link opened on a step: the lane is not attached yet
    jumpOnDraw = false;
  }
  function endsOf(lane) { // the step Squeeze keeps on screen: the current one (by key), else the first
    const all = stepsOf(lane, stepKeys, messages()), st = all.find((x) => x.key === curKey) ?? all[clampStep(cur, all.length) - 1];
    return st ? colsOfEvent(lane, st.event) : [];
  }
  return {
    el: bar.el, decorate, endsOf, move, current: () => cur,
    hit(event) { const st = stepAtRow(steps, event.row); if (st) go(st.n, { scroll: false }); }, // a click on an arrow: the walk jumps to it
    onKey(ev) { const a = walkAction(ev); if (a && steps.length) { ev.preventDefault(); move(a); } },
    dispose: () => bar.dispose(),
  };
}
