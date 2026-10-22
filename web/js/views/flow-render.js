// One flow drawn in full: its lane (lifelines, bars, middleware, pill, calls with returns, unresolved column, stubs,
// alt frames, publish chains that stop at their queues) and under it its own async list. A tab uses it for its flow; an expanded card
// uses it for the flow its consumer starts (traced from the consumer's ingress with the delivered event), so a sub-flow
// is the same picture as an entry-point flow. Everything a tab owns (drill-down, message panel, tooltip, selection) is
// shared through `sh`.

import { h } from '../dom.js';
import { renderLane } from './flow-draw.js';
import { buildLane } from './flow-lane.js';
import { renderIndex } from './flow-index.js';
import { asyncTree, deliveryNumbers, knownOutside } from './flow-async.js';
import { barMenu, participantMenu } from './flow-menu.js';
import { subRequest } from './flow-sub.js';
import { firstStepCols } from './flow-squeeze.js';
import { laneMarks, stepMarksOnly } from './flow-marks.js';
import { marksNow } from '../design/marks-store.js';
import { createRefs } from './flow-refs-draw.js';
import { state } from '../state.js';
import { groupLane } from './flow-group.js';
import { laneSlots } from '../design/lane-slots.js';

/**
 * createFlowRender({ trace, tree, key, ancestors, sticky }, sh) -> { laneBox, idxBox, drawLane(), relane(), expandAll(budget), index() }
 * ancestors: flow ids (service|ingress|event) of the flows this one sits inside: a row that loops back to one is not expanded.
 * sh: { host, opts, tip, walk (the step walk, top lane only), squeeze() (Squeeze on for this tab), squeezeOpen() (a fold was clicked), zoom() (the scale), afterLane() (the top lane was drawn), details(built) (step details on the arrows, top lane only; 0.30.0), editStep(key, n), select(bar), lookInside(bar, trace), openMessage(m, g, trace), flash(el), traceFor(request) }
 */
export function createFlowRender({ trace, tree, key, ancestors = [], sticky = true, depth = 0 }, sh) {
  const { host, opts } = sh, mwOpen = new Set(), fanOpen = new Set(); // fanOpen: topics whose queues are all drawn
  const marks = () => host.marks ?? marksNow(); // the marks of the flow's own environment (a tab of another env has its own, 0.36.0)
  const laneBox = h('div.flow-lane'), idxBox = h('div.flow-idx');
  let lane = null, index = null;
  const maxDepth = () => (opts.depth === 'all' ? Infinity : Number(opts.depth));
  const laneOpts = () => ({ mwOpen, stores: opts.stores, scope: 'full', maxDepth: maxDepth() });

  const handlers = {
    onBarTip: sh.tip ? (bar, el) => (bar ? sh.tip.show(bar, el) : sh.tip.hide()) : undefined,
    onMw: (bar, sel) => { const k = bar?.mw?.key; if (!k) return; if (!mwOpen.delete(k)) mwOpen.add(k); drawLane(); laneBox.querySelector(`${sel ?? '.mwlab'}[data-mwfold="${bar.id}"]`)?.focus(); },
    onBar: (bar, mode) => { if (mode === 'select') sh.select(bar); else { sh.select(bar); sh.lookInside(bar, trace); } },
    onBarMenu: (bar, x, y) => barMenu(bar, x, y, { trace, openEntry: host.openEntry, inside: () => { sh.select(bar); sh.lookInside(bar, trace); }, toIndex: index ? () => index.el.scrollIntoView({ behavior: 'smooth' }) : null }),
    onParticipant: (p, x, y, type) => (type === 'click' && sh.editHead?.(p.service)) || (type === 'click' && p.kind === 'service' && host.openPane?.({ kind: 'component', name: p.service })) || participantMenu(p, x, y, { trace, openEntry: host.openEntry, openPane: host.openPane }), // Edit with a draft: a click on a head opens its form; otherwise the info pane (0.33.0), the menu stays on right-click
    onBand: host.openPane ? (key) => host.openPane({ kind: 'subsystem', key }) : undefined,
    onNum: (label) => { if (index) index.reveal(label); }, // a number tile at a queue: open that row of the list below (a card opens in place)
    onNumHover: (labels, on) => labels.forEach((l) => index?.rowNode(l)?.classList.toggle('hl', on)),
    onFan: (topic) => { if (!fanOpen.delete(topic)) fanOpen.add(topic); drawLane(); },
    onMessage: (m, g, e, trunk) => { if (!depth && e) sh.walk?.hit(e); if (m.kind === 'frontier') host.setFrontier(); else if (trunk && e?.publish) sh.openPublish(e.publish, g, trace); else sh.openMessage(m, g, trace); },
  };

  function drawLane() {
    const lo = laneOpts();
    const msgs = trace.messages.filter((m) => m.depth <= lo.maxDepth);
    const built = buildLane(msgs, { mwOpen, fanOpen, numbers: deliveryNumbers(tree), stores: lo.stores, scope: 'full', participants: trace.participants, trigger: depth ? null : sh.trigger?.() ?? null });
    groupLane(built, host.subs, opts.bands, marks(), (cols) => laneSlots(cols, undefined, host.env), host.env); // 0.28.1: the components of one subsystem together and the bands over them; a colour per flow (before Squeeze, the walk and the drawing see the columns)
    const sq = sh.squeeze?.() ? { keep: (!depth && sh.walk?.endsOf(built)) || firstStepCols(built) } : null; // Squeeze: the current step's lifelines (a card: its first step's)
    lane = renderLane(built, { ...handlers, marks: laneMarks(marks()) ?? stepMarksOnly, edit: sh.addCall ? { onAddCall: sh.addCall, onAddInBand: sh.addInBand } : null, refs: createRefs(trace, { editing: !host.readOnly && state.mode === 'edit' && !!state.draft, onImport: sh.importRef }), sticky, squeeze: sq, onSqueeze: sh.squeezeOpen, details: depth ? null : sh.details?.(built) ?? null, onEditStep: sh.editStep, zoom: sh.zoom?.() ?? 1, hints: opts.th ?? true, fit: Math.max(0, (sh.fit?.() ?? 0) - (depth ? 40 + depth * 28 : 0)) });
    if (!depth) sh.walk?.decorate(lane, built); // numbered steps are the top lane's only (0.20.0)
    laneBox.replaceChildren(lane.el);
    if (!depth) sh.afterLane?.(laneBox); // Fit measures the new lane (flow-tab-view.js); the comment brackets go back in front of it
  }
  /** The walk moved to a step with these columns: redraw only when that folds the lane differently. Focus stays on the same arrow. */
  function restep(cols) {
    if (!lane || !sh.squeeze?.() || lane.geometry.plan(cols).key === lane.geometry.sig) return;
    const at = laneBox.contains(document.activeElement) ? document.activeElement.closest('[data-e],[data-bar],[data-sqfold]') : null, sel = at && `[${at.hasAttribute('data-e') ? 'data-e' : at.hasAttribute('data-bar') ? 'data-bar' : 'data-sqfold'}="${at.getAttribute('data-e') ?? at.getAttribute('data-bar') ?? at.getAttribute('data-sqfold')}"]`;
    drawLane();
    if (sel) laneBox.querySelector(sel)?.focus({ preventScroll: true });
  }
  const makeFlow = async (row, childAncestors) => {
    const t = await sh.traceFor(subRequest(row, opts));
    return createFlowRender({ trace: t, tree: asyncTree(t.messages, row.label, knownOutside(tree.known, row.label)), key, ancestors: childAncestors, sticky: false, depth: depth + 1 }, sh);
  };
  function drawIndex() {
    index = tree.groups.length ? renderIndex(tree, { trace, handlers, depth, key, ancestors, makeFlow,
      open: (row, full) => (full ? host.openFull(row, key) : host.openSub(row, key)),
      openAll: (rows) => host.openMany(rows, key), freeSlots: host.freeSlots, isOpen: (row) => host.isOpen(row, key), jump: (label) => host.jumpToLabel(label),
      hover: (labels, on) => lane?.mark(labels, on) }) : null;
    idxBox.replaceChildren(...(index ? [index.el] : []));
  }
  drawLane(); drawIndex();
  return {
    laneBox, idxBox, drawLane, restep, ancestors,
    /** Depth, stores and other lane options changed: redraw this lane and the lanes of the cards already open below it (their expansion stays). */
    relane() { drawLane(); index?.relane(); },
    expandAll: (budget) => index?.expandAll(budget),
    index: () => index,
  };
}
