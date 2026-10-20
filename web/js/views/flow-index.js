// The async index under a diagram. One 40px row per consumer flow, grouped by the publish that starts it (and by
// alt branch). A chevron expands a row in place into a card: the flow the consumer starts, drawn exactly like an
// entry-point flow (ctx.makeFlow traces it from the consumer's ingress with the delivered event, lazily and once), with
// its own async list under it, nested as deep as the flow goes. "seen" rows never expand; they scroll to the row they repeat.

import { h } from '../dom.js';
import { indexStats, flowsLabel, idParts, plural } from './flow-async.js';
import { distinctRows } from './flow-tabs-state.js';
import { flowId } from './flow-sub.js';

const chev = (open) => h('button.chev', { 'aria-label': open ? 'Collapse flow' : 'Expand flow', 'aria-expanded': String(open) },
  h('span.chev-i', { class: open ? 'open' : '' }, '›'));
const tc = (t, label) => h('span.tc', { class: t, title: label }, label);
/** An identifier that may wrap after - . _ / : instead of being cut. */
const wrapId = (t) => idParts(t).flatMap((x, i) => (i ? [h('wbr'), x] : [x]));
let uids = 0; // element ids are unique per index: every tab keeps its own
const chType = (key) => key.split(':')[0].replace('amqp-queue', 'amqp');

/**
 * renderIndex(tree, ctx) -> { el, expandAll(budget), collapseAll, reveal(label) -> Promise, groupEl(pubIndex), rowNode(label), refresh(), relane() }
 * ctx: { ancestors (flow ids this list sits inside), makeFlow(row, ancestors) -> Promise<flow render: { laneBox, idxBox, relane, expandAll, index }>,
 *        open(row, full), openAll(rows), isOpen(row) (has a tab), jump(label) (a "seen" row whose target is not in this list) }
 */
export function renderIndex(tree, ctx) {
  const uid = `ix${++uids}`;
  const cards = new Map(); // label -> { setOpen(v) -> Promise, el, paint, flow }
  const groupEls = new Map(), rowNodes = new Map();
  const stats = indexStats(tree);
  const loops = (row) => (ctx.ancestors ?? []).includes(flowId(row));

  const rowHead = (row, open) => {
    const nested = row.groups.reduce((n, g) => n + g.rows.length, 0);
    return [row.noHandler || row.seenIn || loops(row) ? h('span.chev-pad') : chev(open),
      h('span.layer', row.label, ctx.isOpen?.(row) ? h('i.tabdot', { title: 'Open in a tab', 'aria-label': 'open in a tab' }) : null),
      h('span.lane', groupOfRow(row).topic !== row.queue ? [tc(chType(groupOfRow(row).topic), groupOfRow(row).topic), h('i.arr', '›')] : null, tc(chType(row.queue), row.queue), h('i.arr', '›'),
        h('span.svc', h('b', wrapId(row.service)), h('span.mono', [' · ', ...wrapId(row.handler)]))),
      nested ? h('span.nest-chip', { title: `${nested} nested ${nested === 1 ? 'flow' : 'flows'} (${row.groups[0]?.rows[0]?.label ?? ''} ...)` }, `+${nested} nested`) : null,
      row.suspect ? h('span.chip-warn', { title: 'Same consumer reached twice by one publish. Possible harvester or config bug.' }, 'suspect') : null,
      loops(row) ? h('span.chip-warn', { title: 'This consumer is already running above: its flow comes back here. Not expanded again.' }, '↻ loops back') : null,
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
    const expandable = !row.noHandler && row.ingress && !loops(row);
    const card = h('section.card', { id: `${uid}-row-${row.label}`, class: depth ? 'nested' : '' }), entry = { flow: null };
    cards.set(row.label, entry);
    rowNodes.set(row.label, card);
    const head = h('header.card-h', { class: expandable ? 'click' : '' });
    const body = h('div.card-b', { hidden: true });
    let open = false, built = null, flow = null;
    const actions = row.ingress && !row.noHandler ? [
      h('button.btn.sm', { title: `${row.service} · ${row.ingress}, in its own tab`, on: { click: (e) => { e.stopPropagation(); ctx.open(row, false); } } }, 'Open in tab'),
      h('button.btn.sm.ghost', { title: 'Start a full flow from here: every call this consumer makes, in a new tab', on: { click: (e) => { e.stopPropagation(); ctx.open(row, true); } } }, 'Full flow ▸')] : [];
    const paint = () => { const refocus = head.contains(document.activeElement) && document.activeElement.classList.contains('chev'); const sp = row.summary.split(' · ').filter((x) => !x.startsWith('publishes')); head.replaceChildren(...rowHead(row, open).filter(Boolean), h('span.sum', { title: row.summary }, sp[0] ? h('b', sp[0]) : '', sp.length > 1 ? ` · ${sp.slice(1).join(' · ')}` : ''), ...actions); const c = head.querySelector('.chev'); c?.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); }); if (refocus) c?.focus(); };
    function setOpen(v, budget) { // resolves when the flow is drawn (a card traces its consumer the first time it opens)
      if (!expandable) return Promise.resolve();
      if (v !== open) { open = v; card.classList.toggle('open', open); body.hidden = !open; paint(); }
      if (open && !built) {
        body.append(h('div.card-loading', 'Tracing…'));
        built = ctx.makeFlow(row, [...(ctx.ancestors ?? []), flowId(row)]).then((f) => {
          flow = f; entry.flow = f;
          body.replaceChildren(h('div.card-lane', f.laneBox), h('div.card-nest', f.idxBox));
          return f;
        }, (err) => { built = null; body.replaceChildren(h('div.error-box', err.message)); });
      }
      return open && built ? built.then((f) => { if (f && budget) f.expandAll(budget); }) : Promise.resolve();
    }
    if (expandable) head.addEventListener('click', (e) => { if (!e.target.closest('button,a')) setOpen(!open); });
    paint();
    card.append(head, body);
    entry.setOpen = setOpen; entry.paint = paint; entry.el = card;
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

  async function reveal(label) { // opens the cards on the way (each draws its own list), then flashes the row
    const c = cards.get(label);
    if (c) {
      await c.setOpen(true);
      c.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      c.el.classList.add('flash'); setTimeout(() => c.el.classList.remove('flash'), 1600);
      return true;
    }
    const parts = String(label).split('.');
    for (let k = parts.length - 1; k >= 1; k--) { // the nearest card above it that is in this list
      const up = cards.get(parts.slice(0, k).join('.'));
      if (!up) continue;
      await up.setOpen(true);
      if (await up.flow?.index()?.reveal(label)) return true;
      break;
    }
    ctx.jump?.(label);
    return false;
  }
  // Expand all: this list's rows, then the rows of each flow that draws, within a budget of cards (a big fan-out stays small).
  const all = (v, budget = { n: 30 }) => {
    if (!v) { cards.forEach((c) => { c.setOpen(false); c.flow?.index()?.collapseAll(); }); return; }
    cards.forEach((c) => { if (c.el.classList.contains('open')) c.flow?.expandAll(budget); else if (budget.n > 0) { budget.n--; c.setOpen(true, budget); } });
  };
  const distinct = distinctRows(stats.openable);
  const openAll = () => ctx.openAll(distinct);

  const sub = (ctx.depth ?? 0) > 0, tools = !sub || stats.deliveries > 2; // a nested list is a small line; its buttons only when it has many rows
  const header = sub ? h('div.cards-h.small', h('h3', `Async flows · ${stats.deliveries}`), h('span.grow'), tools ? h('span.cards-btns', h('button.btn.sm', { on: { click: () => all(true) } }, 'Expand all'), h('button.btn.sm', { on: { click: () => all(false) } }, 'Collapse all')) : null) : h('div.cards-h', h('h2', 'Async flows'),
    h('span.hint', `${stats.deliveries} ${stats.deliveries === 1 ? 'delivery' : 'deliveries'} · ${plural(stats.distinct, 'distinct consumer')} · ${stats.publishes} ${stats.publishes === 1 ? 'publish' : 'publishes'}. Expand a row to see its flow here.`),
    h('span.grow'), h('span.cards-btns', distinct.length > 1 ? h('button.btn.sm', { title: 'One tab per distinct consumer', on: { click: openAll } }, `Open all distinct (${distinct.length})`) : null,
      h('button.btn.sm', { on: { click: () => all(true) } }, 'Expand all'), h('button.btn.sm', { on: { click: () => all(false) } }, 'Collapse all')));
  const el = h('div.cards', header, tree.groups.map((g) => groupEl(g)));
  return { el, expandAll: (budget) => all(true, budget), collapseAll: () => all(false), reveal, groupEl: (i) => groupEls.get(i), rowNode: (label) => rowNodes.get(label) ?? null,
    refresh: () => cards.forEach((c) => { c.paint?.(); c.flow?.index()?.refresh(); }), relane: () => cards.forEach((c) => c.flow?.relane()) };
}
