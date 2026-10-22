// Building blocks of the info pane's sections (0.33.0, frame 19): a titled block, the facts list, doc links and the flows list (the About blocks are in pane-about.js).

import { h } from '../dom.js';
import { href } from '../router.js';
import { icon } from '../icons.js';
import { safeUrl } from '../components/ext-links.js';

/** A titled block: `<section id=pane-<id>>` with its heading, an optional count and a right-hand action. */
export const block = (id, title, { count = null, right = null, cls = '' } = {}, ...content) =>
  h('section.pane-sec', { id: `pane-${id}`, 'data-sec': id, class: cls }, h('h4', title, count != null ? h('small', String(count)) : null, right ? h('span.r', right) : null), ...content);

/** `rows`: [[label, node|text|null]]; a row with no value is left out. */
export const facts = (rows) => h('dl.pane-facts', rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => [h('dt', k), h('dd', v)]));

/** The Docs fact (#54): the main link first as a filled chip, then the sub links; a link whose scheme is not http(s) is not drawn as one. */
export function docLinks(links) {
  const one = (l, main) => (l && safeUrl(l.url) ? h('a.pane-link', { class: main ? 'main' : '', href: l.url, target: '_blank', rel: 'noopener noreferrer', title: `${l.label || l.url} (opens in a new tab)` }, icon('external'), l.label || l.url) : null);
  const chips = [one(links?.main, true), ...(links?.sub ?? []).map((l) => one(l, false))].filter(Boolean);
  return chips.length ? h('div.pane-lk', chips) : null;
}

/** The count of in and out endpoints, "4 · 3 in (http), 1 out (amqp)". */
export function endpointText(ingress = [], egress = []) {
  const by = (xs) => { const m = new Map(); for (const x of xs) m.set(x.transport, (m.get(x.transport) ?? 0) + 1); return [...m].map(([t, n]) => (m.size > 1 ? `${n} ${t}` : t)).join(', '); };
  const parts = [ingress.length ? `${ingress.length} in (${by(ingress)})` : '', egress.length ? `${egress.length} out (${by(egress)})` : ''].filter(Boolean);
  return { total: ingress.length + egress.length, text: parts.join(', ') };
}

export const flowName = (e) => e.name || `${e.service} ${e.id}`;
export const flowHref = (e) => href('/flows', { tabs: `${e.service}/${e.id}` });

/** The Flows list: a row per entry point (name, the new / changed mark, its endpoint); `mark(e)` gives the mark node; `hit(e)` tints a row (the flow the pane was opened from). */
export function flowsList(entries, { mark = () => null, hit = () => false, max = 8, onAll = null } = {}) {
  if (!entries.length) return h('p.pane-none', 'No flow runs through it.');
  const row = (e) => h('a.pane-row', { href: flowHref(e), class: hit(e) ? 'hit' : '', 'data-qa': 'pane-flow' }, h('b', flowName(e)), h('span.r', mark(e)), h('small', e.summary || `${e.service} · ${e.bindKey ?? e.id}`));
  const shown = entries.slice(0, max);
  return h('div.pane-list', shown.map(row), entries.length > max ? h('button.pane-all', { type: 'button', on: { click: (ev) => { ev.currentTarget.replaceWith(...entries.slice(max).map(row)); onAll?.(); } } }, `Show all ${entries.length}`) : null);
}

/** The first line of an about (a heading is skipped), for a row's summary; '' when there is none. */
export const firstLine = (md) => (typeof md === 'string' ? md.split('\n').map((l) => l.replace(/^\s*(#{1,6}|[-*]|\d+[.)])\s+/, '').trim()).find((l) => l && !/^```/.test(l)) ?? '' : '');

/** The steps of the flow the pane was opened from that touch `name` (frame 19c): [{ n, label, how: 'receives' | 'sends', other }]. */
export function stepsOfComponent(steps, name) {
  return (steps ?? []).filter((s) => s.from === name || s.to === name).map((s) => (s.to === name ? { n: s.n, label: s.label, how: 'receives', other: s.from } : { n: s.n, label: s.label, how: 'sends', other: s.to }));
}

/** "In this flow": the steps (the arrows) the component takes part in, in the order of the flow. */
export function inFlowBlock(flow, name) {
  const rows = stepsOfComponent(flow?.steps, name);
  if (!flow || !rows.length) return null;
  return block('inflow', 'In this flow', { count: flow.name || `${flow.service} ${flow.ingress}`, cls: 'inflow' }, h('div.pane-list', rows.map((r) => h('div.pane-row.hit', { 'data-qa': 'pane-step' }, h('b.mono', r.label), h('span.r', `step ${r.n} · ${r.how}`), h('small', `${r.how === 'receives' ? 'from' : 'to'} ${r.other}`)))));
}

