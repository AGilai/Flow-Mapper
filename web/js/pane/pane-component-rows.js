// The accordion rows of a component on the expanded page (0.33.0, frame 19h): Overview, About (a row per `##` section), Open questions, Flows through it,
// Endpoints, Connections, Discussion. `componentRows(spec, d)` -> Promise of row definitions for pane-acc.js.

import { h } from '../dom.js';
import { api } from '../api.js';
import { href } from '../router.js';
import { state } from '../state.js';
import { chip } from '../format.js';
import { aboutRows } from './pane-about.js';
import { endpointRows } from './pane-endpoints.js';
import { endpointText } from './pane-parts.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The neighbours of the Connections row: a click swaps the page to that component (`onPick`), the rest is today's panel in a list. */
function connectionRows(list, onPick) {
  if (!list.length) return h('p.pane-none', 'No connections on the map.');
  return h('div.pane-list', list.map((n) => h('button.pane-row.btn-row', { type: 'button', disabled: !n.service, title: n.service ? `Open ${n.service}` : n.label, on: { click: () => n.service && onPick(n.service) } },
    h('b.mono', n.label), h('span.r', n.broken ? chip('broken', 'broken') : n.transports.map((t) => chip(t)), n.async ? chip('async', 'async') : null, h('span.xs', String(n.count))), h('small', n.dir === 'out' ? 'this calls it' : 'it calls this'))));
}

/** Comments and open action items over the flows that run through the component. */
async function discussion(flows) {
  const [c, a] = await Promise.all([api.commentCounts(state.env).catch(() => ({})), api.actionCounts(state.env).catch(() => ({}))]);
  const per = flows.map((e) => ({ e, c: c[`flow:${e.service}/${e.id}`] ?? 0, a: a[`flow:${e.service}/${e.id}`] ?? 0 }));
  return { comments: per.reduce((t, x) => t + x.c, 0), actions: per.reduce((t, x) => t + x.a, 0), per: per.filter((x) => x.c || x.a) };
}

export async function componentRows(spec, d) {
  const { about, questions } = aboutRows(d.about, { pen: d.aboutPen, design: d.design });
  const eps = endpointText(d.view?.ingress, d.view?.egress), disc = await discussion(d.flows), conn = d.connections(), name = spec.title;
  const pick = (service) => d.ctx.onComponent?.(service);
  return [
    { id: 'overview', title: 'Overview', body: () => d.overview() },
    about, questions,
    { id: 'flows', title: 'Flows through it', count: d.flows.length, right: h('a', { href: href('/flows', { service: name }) }, 'Trace flows'), body: d.flowsBody },
    { id: 'endpoints', title: 'Endpoints', small: eps.total ? `${eps.total} · ${eps.text}` : '', body: () => endpointRows(d.view, name) },
    { id: 'connections', title: 'Connections', count: conn.count, body: () => connectionRows(conn.nodes, pick) },
    { id: 'discussion', title: 'Discussion', small: `${plural(disc.comments, 'comment')} · ${plural(disc.actions, 'open action')}`,
      body: () => (disc.per.length ? h('div.pane-list', disc.per.map((x) => h('a.pane-row', { href: href('/flows', { tabs: `${x.e.service}/${x.e.id}` }) }, h('b', x.e.name || `${x.e.service} ${x.e.id}`), h('span.r', plural(x.c, 'comment'), ' · ', plural(x.a, 'action')), h('small', 'Open the flow to read and answer'))))
        : h('p.pane-none', 'No comments or action items on the flows through it yet.')) },
  ].filter(Boolean);
}
