// The Endpoints row of the expanded page (0.33.0, frame 19h): a component's ingress and egress with direction, transport and name; a row expands to its handler,
// its request and response bodies (loaded when somebody looks) and who calls it / what it reaches.

import { h } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { chip } from '../format.js';

/** "POST /compile" for an HTTP ingress, else its bind key without the transport prefix. */
export const ingressLabel = (i) => (i.details?.method && i.details?.path ? `${i.details.method} ${i.details.path}` : String(i.bindKey ?? i.id).replace(/^[a-z-]+:/, ''));
export const egressLabel = (e) => e.operation ?? String(e.bindKey ?? e.id).replace(/^[a-z-]+:/, '');

const json = (v) => { try { const t = JSON.stringify(v, null, 2); return t.length > 1600 ? `${t.slice(0, 1600)}\n…` : t; } catch { return ''; } };

/** One expandable row: a button head and a detail built on first open. */
function disclosure(head, detail) {
  const bd = h('div.d', { hidden: true });
  let built = false;
  const btn = h('button.l', { type: 'button', 'aria-expanded': 'false', on: { click: async () => {
    const on = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(on)); bd.hidden = !on;
    if (on && !built) { built = true; bd.replaceChildren(h('p.pane-loading', 'Loading…')); try { bd.replaceChildren(...[await detail()].flat().filter(Boolean)); } catch { bd.replaceChildren(h('p.pane-none', 'Could not load this.')); } }
  } } }, icon('chev', 'chev'), ...head);
  return h('div.pane-ep', btn, bd);
}

const callers = (i) => (i.callers?.length ? h('span', 'Called by ', i.callers.map((c, n) => [n ? ', ' : '', h('b', c.service)])) : h('span.muted', i.orphan ? 'Nobody calls it.' : 'No known callers.'));

async function ingressDetail(service, i) {
  const info = await api.endpoint(state.env, service, i.id).catch(() => null);
  const slots = (info?.slots ?? []).filter((s) => s.dto?.content != null);
  return [
    info?.handler ? h('span', 'Handler ', h('code', info.handler.name ?? info.handler.id), info.handler.file ? h('span.muted', ` ${info.handler.file}${info.handler.line ? `:${info.handler.line}` : ''}`) : null) : null,
    ...slots.map((s) => h('div', h('b', s.label ?? s.role), h('pre', json(s.dto.content)))),
    !slots.length ? h('span.muted', 'No request or response body harvested.') : null,
    callers(i),
  ];
}

const egressDetail = (e) => [h('span', e.targets?.length ? ['Reaches ', e.targets.map((t, n) => [n ? ', ' : '', h('b', t.service)])] : 'Reaches nothing known.'), e.dangling ? h('span.pane-bad', 'No endpoint matches this call.') : null];

/** The rows of the Endpoints body for a service view (`GET /views/service/:name`). */
export function endpointRows(view, service) {
  const ing = view?.ingress ?? [], eg = view?.egress ?? [];
  if (!ing.length && !eg.length) return h('p.pane-none', 'No endpoints.');
  const row = (dir, label, transport, detail) => disclosure([h('span.pane-dir', dir), h('b', label), h('span.r', transport ? chip(transport) : null)], detail);
  return h('div.pane-eps', ing.map((i) => row('in', ingressLabel(i), i.transport, () => ingressDetail(service, i))), eg.map((e) => row('out', egressLabel(e), e.transport, () => egressDetail(e))));
}
