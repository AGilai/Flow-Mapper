// #86 the store panel (docs/plans/store-panel.md, design/mockups/frames/frame-23.html): in the right-hand pane, what ONE flow touches in a Redis instance or a Mongo store.
// storePanelView(model, ctx) -> { nodes: [head, body], title, setCurrent(n), setCount(n) }. The data is core/store-panel.js; this file draws it.

import { h, s } from '../dom.js';
import { href } from '../router.js';
import { chip } from '../format.js';
import { capSteps, summary, ttlLine } from '../../core/store-panel.js';
import { instancePath, storePath, envQuery } from './inventory-links.js';
import { fieldText } from '../components/step-fields.js';
import { registryBlock } from './store-panel-reg.js';

const ICON = { read: 'M5 1.5v7M2 5.8 5 8.8l3-3', write: 'M5 8.5v-7M2 4.2 5 1.2l3 3', delete: 'M2 2l6 6M8 2 2 8', rw: 'M5 1.5v7M2 5.8 5 8.8l3-3', unknown: 'M2 5h6' };
const WORD = { read: 'read', write: 'write', delete: 'delete', rw: 'read/write', unknown: 'access not reported' };
const CLS = { read: 'r', write: 'w', delete: 'd', rw: 'w', unknown: 'u' };
const accChip = (a) => h(`span.sp-acc.${CLS[a]}`, s('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, s('path', { d: ICON[a] })), WORD[a]);
const fileIcon = () => s('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, s('path', { d: 'M2 1h4l2 2v6H2zM6 1v2h2', fill: 'none' }));

function stepsRow(op, ctx) {
  let open = false;
  const box = h('div.sp-steps', { role: 'group', 'aria-label': 'Steps' });
  const draw = () => {
    const chips = op.chips ?? op.steps.map((n) => ({ n })), { shown, more } = capSteps(chips, open);
    box.replaceChildren(...[h('span.lb', 'Steps'),
      ...shown.map(({ n, sub }) => h('button.sp-sc', { type: 'button', 'data-n': n, 'aria-label': sub ? `Go to step ${n}, call ${sub} of the folded run` : `Go to step ${n}`, title: sub ? `Call ${sub} of the folded run at step ${n}` : null, class: ctx.current() === n ? 'cur' : '', on: { click: () => ctx.onStep(n) } }, sub ? `${n}.${sub}` : String(n))),
      more ? h('button.sp-more', { type: 'button', 'aria-expanded': 'false', 'aria-label': `Show ${more} more steps`, on: { click: () => { open = true; draw(); box.querySelector('.sp-more')?.focus(); } } }, `+${more} more`)
        : open && chips.length > 8 ? h('button.sp-more', { type: 'button', 'aria-expanded': 'true', on: { click: () => { open = false; draw(); box.querySelector('.sp-more')?.focus(); } } }, 'Show fewer') : null].filter(Boolean));
  };
  draw();
  return box;
}

function opRow(op, ctx) {
  const links = op.links.length ? h('ul.sp-code', { 'aria-label': 'Code' }, op.links.map((l) => h('li', fileIcon(),
    l.url ? h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', title: l.url }, l.key) : h('span.mono', l.key),
    h('span.s', l.steps.length === 1 ? `step ${l.steps[0]}` : `steps ${l.steps.join(', ')}`)))) : null;
  const flds = op.fields.length ? h('div.sp-flds', { 'aria-label': 'Fields' }, op.fields.map((g) => h('span.sp-fg', h('i', g.label), g.items.map((f) => h('span.sp-fp', { class: f.inDdl === false ? 'bad' : '', title: f.inDdl === false ? 'Not in the collection schema' : null }, f.inDdl === false ? '! ' : '', fieldText(f)))))) : null;
  return h('div.sp-op', h('div.sp-oph', accChip(op.access), h('span.sp-opn', op.op)), stepsRow(op, ctx), links, flds);
}

function card(c, p, ctx) {
  const redis = p.kind === 'redis', ttl = ttlLine(c.ttl);
  const meta = redis ? [c.dbs.length ? h('span', 'db ', h('b', c.dbs.join(', '))) : null, c.kind === 'unreported' && !c.ttl.values.length ? null : h('span', 'TTL ', h('b', ttl.text), ttl.note ? ` (${ttl.note})` : '')]
    : [h('span', 'collection of ', h('b', p.store))];
  const note = c.kind === 'unreported' ? h('div.sp-nk', 'The harvester ', c.reason ? ['could not read the key for these steps ', h('i', `(${c.reason})`), '. The operation, steps and code are still shown.'] : 'did not send the key for these steps. The operation, steps and code are still shown.') : null;
  return h('section.sp-k', h('div.h', h('div.t', { class: c.kind === 'unreported' ? 'none' : '' }, c.kind === 'unreported' ? 'Key not reported' : c.title), h('div.m', meta)),
    c.ops.map((o) => opRow(o, ctx)), note, redis && c.template ? registryBlock(ctx.registry, c.template, c.dbs) : null);
}

export function storePanelView(p, ctx) { // ctx: { env, flowLabel, registry (promise), current(), onStep(n) }
  const redis = p.kind === 'redis', first = p.cards[0]?.title;
  const storeKey = redis ? null : p.folded ? `${p.group}/${first}` : `${p.group}/${p.cards[0].title}`;
  const small = h('small');
  const setCount = (n) => { small.textContent = redis ? `The store page lists every key, owner and TTL${n != null ? ` (${n} templates)` : ''}. This panel shows only what ${ctx.flowLabel} touches.` : 'The store page has the schema, indexes and every service that uses this collection.'; };
  setCount(null);
  if (redis) ctx.registry.then((r) => setCount(r?.templates ?? null)).catch(() => {});
  const title = h('h4.sp-title', { tabindex: '-1', id: 'store-panel-h' }, p.title);
  const head = h('div.ep-head', h('div.ep-title', chip(p.kind), title), h('div.ep-sub', h('span', p.sub)));
  const body = h('section.sp', { 'aria-label': `What this flow touches in ${p.title}`, 'data-qa': 'store-panel' },
    h('p.sp-sum', summary(p).map((x) => (typeof x === 'string' ? x : h('b', x.b)))),
    p.cards.map((c) => card(c, p, ctx)),
    h('div.sp-ft', h('a.go', { href: href(redis ? instancePath(p.store) : storePath(storeKey), envQuery(ctx.env)) }, redis ? `Open ${p.store} · all keys ` : `Open ${p.store} `, h('span', { 'aria-hidden': 'true' }, '→')), small));
  return { nodes: [head, body], title, body,
    setCurrent: (n) => body.querySelectorAll('.sp-sc').forEach((b) => b.classList.toggle('cur', n != null && Number(b.dataset.n) === n)) };
}
