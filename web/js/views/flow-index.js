// The async index under a diagram. One 40px row per consumer flow, grouped by the publish that starts it (and by
// alt branch). A chevron expands a row in place into a card: that flow drawn with the same lane rules, followed by
// the flows it starts (nested, indented, expandable too). "seen" rows never expand; they scroll to the row they repeat.

import { h } from '../dom.js';
import { indexStats, flowsLabel, idParts, plural } from './flow-async.js';
import { distinctRows } from './flow-tabs-state.js';
import { buildLane } from './flow-lane.js';
import { renderLane } from './flow-draw.js';

const chev = (open) => h('button.chev', { 'aria-label': open ? 'Collapse flow' : 'Expand flow', 'aria-expanded': String(open) },
  h('span.chev-i', { class: open ? 'open' : '' }, '›'));
const tc = (t, label) => h('span.tc', { class: t, title: label }, label);
/** An identifier that may wrap after - . _ / : instead of being cut. */
const wrapId = (t) => idParts(t).flatMap((x, i) => (i ? [h('wbr'), x] : [x]));
let uids = 0; // element ids are unique per index: every tab keeps its own
const chType = (key) => key.split(':')[0].replace('amqp-queue', 'amqp');

/**
 * renderIndex(tree, ctx) -> { el, expandAll, collapseAll, reveal(label), groupEl(pubIndex), rowNode(label), refresh() }
 * ctx: { trace, lane: { stores, scope, maxDepth }, handlers (for renderLane), open(row, full), openAll(rows), isOpen(row) (has a tab),
 *        jump(label) (a "seen" row whose target is not in this list) }
 */
export function renderIndex(tree, ctx) {
  const uid = `ix${++uids}`;
  const cards = new Map(); // label -> { setOpen, el, parent, paint }
  const groupEls = new Map(), rowNodes = new Map();
  const stats = indexStats(tree);
  const laneFor = (row) => {
    const msgs = row.msgs.filter((m, i) => i === 0 || m.depth <= ctx.lane.maxDepth);
    return renderLane(buildLane(msgs, { mwOpen: ctx.lane.mwOpen, stores: ctx.lane.stores, scope: 'full', participants: ctx.trace.participants }), { ...ctx.handlers, sticky: false });
  };

  const rowHead = (row, open) => {
    const nested = row.groups.reduce((n, g) => n + g.rows.length, 0);
    return [row.noHandler || row.seenIn ? h('span.chev-pad') : chev(open),
      h('span.layer', row.label, ctx.isOpen?.(row) ? h('i.tabdot', { title: 'Open in a tab', 'aria-label': 'open in a tab' }) : null),
      h('span.lane', groupOfRow(row).topic !== row.queue ? [tc(chType(groupOfRow(row).topic), groupOfRow(row).topic), h('i.arr', '›')] : null, tc(chType(row.queue), row.queue), h('i.arr', '›'),
        h('span.svc', h('b', wrapId(row.service)), h('span.mono', [' · ', ...wrapId(row.handler)]))),
      nested ? h('span.nest-chip', `+ ${nested} nested ${nested === 1 ? 'flow' : 'flows'} (${row.groups[0]?.rows[0]?.label ?? ''})`) : null,
      row.suspect ? h('span.chip-warn', { title: 'Same consumer reached twice by one publish. Possible harvester or config bug.' }, 'suspect') : null,
      row.noHandler ? h('span.chip-bad', 'no handler') : null];
  };
  const parents = new Map();
  const groupOfRow = (row) => parents.get(row);

  function rowEl(row, group, depth) {
    parents.set(row, group);
    if (row.seenIn) {
      const el = h('div.crow.seen', { id: `${uid}-row-${row.label}` }, h('span.seenic', '↩'), h('span.layer', row.label),
        h('span.lane', h('span.svc', h('b', row.service), h('span.mono', ` · ${row.handler}`))),
        h('span.sum', `↩ seen in ${row.seenIn}`), h('button.btn.sm.ghost', { on: { click: () => reveal(row.seenIn) } }, `Jump to ${row.seenIn}`));
      rowNodes.set(row.label, el);
      return el;
    }
    const expandable = !row.noHandler && row.msgs.length >= 1 && row.ingress;
    const card = h('section.card', { id: `${uid}-row-${row.label}`, class: depth ? 'nested' : '' });
    rowNodes.set(row.label, card);
    const head = h('header.card-h', { class: expandable ? 'click' : '' });
    const body = h('div.card-b', { hidden: true });
    let open = false, built = false;
    const actions = row.ingress && !row.noHandler ? [
      h('button.btn.sm', { title: `${row.service} · ${row.ingress}, in its own tab`, on: { click: (e) => { e.stopPropagation(); ctx.open(row, false); } } }, 'Open in tab'),
      h('button.btn.sm.ghost', { title: 'Start a full flow from here: every call this consumer makes, in a new tab', on: { click: (e) => { e.stopPropagation(); ctx.open(row, true); } } }, 'Full flow ▸')] : [];
    const paint = () => { const refocus = head.contains(document.activeElement) && document.activeElement.classList.contains('chev'); head.replaceChildren(...rowHead(row, open).filter(Boolean), h('span.sum', row.summary ? h('b', row.summary.split(' · ')[0]) : '', row.summary.includes(' · ') ? ` · ${row.summary.split(' · ').slice(1).join(' · ')}` : ''), ...actions); const c = head.querySelector('.chev'); c?.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); }); if (refocus) c?.focus(); };
    function setOpen(v) {
      if (!expandable || v === open) return;
      open = v; card.classList.toggle('open', open); body.hidden = !open;
      if (open && !built) {
        built = true;
        const lane = laneFor(row);
        body.append(h('div.card-lane', lane.el));
        if (row.groups.length) body.append(h('div.card-nest', row.groups.map((g) => groupEl(g, depth + 1))));
      }
      paint();
    }
    if (expandable) head.addEventListener('click', (e) => { if (!e.target.closest('button,a')) setOpen(!open); });
    paint();
    card.append(head, body);
    cards.set(row.label, { setOpen, paint, el: card, parent: row.label.includes('.') ? row.label.replace(/\.\d+$/, '') : null });
    return card;
  }

  function groupEl(g, depth = 0) {
    const seen = g.rows.filter((r) => r.seenIn).length, fresh = g.rows.length - seen;
    const el = h('div.grp', { id: `${uid}-pub-${g.pub}` },
      h('div.grp-h', tc(g.transport, g.transport), h('span.mono', `${g.topic.replace(/^[^:]+:/, '')} · ${g.event}`),
        g.branch ? h('span.from', `branch ${g.branch.n}${g.branch.condition ? ` · ${g.branch.condition}` : ''}`) : null,
        h('span.sum', g.rows.length ? (fresh ? `${flowsLabel(g.rows.length)}${seen ? ` · ${fresh} new, ${seen} seen before` : ''}` : `${flowsLabel(g.rows.length)} · all seen before`) : 'no consumers')),
      h('div.grp-rows', g.rows.map((r) => rowEl(r, g, depth))));
    groupEls.set(g.pub, el);
    return el;
  }

  function reveal(label) {
    const parts = String(label).split('.');
    for (let k = 1; k < parts.length; k++) cards.get(parts.slice(0, k).join('.'))?.setOpen(true); // ancestors first: opening builds the nested rows
    const c = cards.get(label);
    if (!c) { ctx.jump?.(label); return; }
    c.setOpen(true);
    c.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    c.el.classList.add('flash'); setTimeout(() => c.el.classList.remove('flash'), 1600);
  }
  const all = (v) => { const walk = (rows) => rows.forEach((r) => { cards.get(r.label)?.setOpen(v); r.groups.forEach((g) => walk(g.rows)); }); tree.groups.forEach((g) => walk(g.rows)); };
  const distinct = distinctRows(stats.openable);
  const openAll = () => ctx.openAll(distinct);

  const header = h('div.cards-h', h('h2', 'Async flows'),
    h('span.hint', `${stats.deliveries} ${stats.deliveries === 1 ? 'delivery' : 'deliveries'} · ${plural(stats.distinct, 'distinct consumer')} · ${stats.publishes} ${stats.publishes === 1 ? 'publish' : 'publishes'}. Expand a row to see its flow here.`),
    h('span.grow'), h('span.cards-btns', distinct.length > 1 ? h('button.btn.sm', { title: 'One tab per distinct consumer', on: { click: openAll } }, `Open all distinct (${distinct.length})`) : null,
      h('button.btn.sm', { on: { click: () => all(true) } }, 'Expand all'), h('button.btn.sm', { on: { click: () => all(false) } }, 'Collapse all')));
  const el = h('div.cards', header, tree.groups.map((g) => groupEl(g)));
  return { el, expandAll: () => all(true), collapseAll: () => all(false), reveal, groupEl: (i) => groupEls.get(i), rowNode: (label) => rowNodes.get(label) ?? null, refresh: () => cards.forEach((c) => c.paint()) };
}
