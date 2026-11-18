// #86 the store panel (docs/plans/store-panel.md, design/mockups/frames/frame-23.html): in the right-hand pane, what ONE flow touches in a Redis instance or a Mongo store.
// storePanelView(model, ctx) -> { nodes: [head, body], title, setCurrent(n), setCount(n) }. The data is core/store-panel.js; this file draws it.

import { h } from '../dom.js';
import { href } from '../router.js';
import { chip } from '../format.js';
import { summary, ttlLine } from '../../core/store-panel.js';
import { instancePath, storePath, envQuery } from './inventory-links.js';
import { opRow } from './store-panel-ops.js';
import { cardList } from './store-cards.js';
import { registryBlock } from './store-panel-reg.js';
import { whyHazard } from './incomplete-why.js';
import { api } from '../api.js';
import { schemaView } from '../components/schema-view.js';
import { schemaAnchor } from '../components/field-diff.js';

/** #123: the collection's schema as a DDL table, opened in the card (loaded on the first click). The store page has all of its sources. */
function schemaBox(p, c, ctx) {
  const key = `${p.group}/${c.title}`, body = h('div.sp-schema', { hidden: true, 'data-qa': 'sp-schema' }), btn = h('button.sp-sch', { type: 'button', 'aria-expanded': 'false', 'data-qa': 'sp-schema-btn' }, 'Schema ▾');
  let loaded = false;
  btn.addEventListener('click', async () => {
    const open = body.hidden;
    body.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.textContent = open ? 'Schema ▴' : 'Schema ▾';
    if (!open || loaded) return;
    loaded = true; body.replaceChildren(h('p.muted.xs', 'Loading the schema…'));
    try {
      const st = await api.store(ctx.env, key);
      body.replaceChildren(...(st.schemas.length ? st.schemas.map((s) => h('div', h('div.row', h('b.small', `Schema · from ${s.source}`)), schemaView(s.content, schemaAnchor(s.source, key)))) : [h('p.muted.xs', `No schema for ${c.title} yet.`)]));
    } catch { loaded = false; body.replaceChildren(h('p.muted.xs', 'The schema could not be loaded.')); }
  });
  return [btn, body];
}

function card(c, p, ctx) {
  const redis = p.kind === 'redis', ttl = ttlLine(c.ttl), sch = !redis && c.kind === 'collection' ? schemaBox(p, c, ctx) : [null, null];
  const meta = redis ? [c.dbs.length ? h('span', 'db ', h('b', c.dbs.join(', '))) : null, c.kind === 'unreported' && !c.ttl.values.length ? null : h('span', 'TTL ', h('b', ttl.text), ttl.note ? ` (${ttl.note})` : '')]
    : [h('span', 'collection of ', h('b', p.store)), sch[0]];
  const note = c.kind === 'unreported' ? h('div.sp-nk', 'The harvester ', c.reason ? ['could not read the key for these steps ', h('i', `(${c.reason})`), '. The operation, steps and code are still shown.'] : 'did not send the key for these steps. The operation, steps and code are still shown.') : null;
  const vars = redis && c.variants?.length ? h('div.sp-kv', { 'data-qa': 'key-variants' }, h('span.lb', c.variants.length === 1 ? 'Also spelled' : 'Also spelled as'), c.variants.map((v) => h('span.mono.v', v))) : null; // #108: the callers' spellings of this key
  return h('section.sp-k', h('div.h', h('div.t', { class: c.kind === 'unreported' ? 'none' : '' }, c.kind === 'unreported' ? 'Key not reported' : c.title), h('div.m', meta), vars),
    c.ops.map((o) => opRow(o, ctx)), note, sch[1], redis && c.template ? registryBlock(ctx.registry, c.template, c.dbs) : null);
}

export function storePanelView(p, ctx) { // ctx: { env, flowLabel, registry (promise), current(), onStep(n) }
  const redis = p.kind === 'redis', first = p.cards[0]?.title;
  const storeKey = redis ? null : p.folded ? `${p.group}/${first}` : `${p.group}/${p.cards[0].title}`;
  const small = h('small');
  const setCount = (n) => { small.textContent = redis ? `The store page lists every key, owner and TTL${n != null ? ` (${n} templates)` : ''}. This panel shows only what ${ctx.flowLabel} touches.` : 'The store page has the schema, indexes and every service that uses this collection.'; };
  setCount(null);
  if (redis) ctx.registry.then((r) => setCount(r?.templates ?? null)).catch(() => {});
  const title = h('h4.sp-title', { tabindex: '-1', id: 'store-panel-h' }, p.title);
  const why = ctx.trace ? whyHazard(ctx.trace) : null; // #113: the same hazard button as the step pane; the box follows the data, collapsed
  const head = h('div.ep-head', h('div.ep-title', chip(p.kind), title, why?.btn ?? null), h('div.ep-sub', h('span', p.sub)));
  const body = h('section.sp', { 'aria-label': `What this flow touches in ${p.title}`, 'data-qa': 'store-panel' },
    h('p.sp-sum', summary(p).map((x) => (typeof x === 'string' ? x : 'link' in x ? h('a.sp-coll', { href: '#', on: { click: (e) => { e.preventDefault(); ctx.onCollection?.(x.link); } } }, x.text) : h('b', x.b)))),
    p.cards.length > 1 ? cardList(p, ctx) : p.cards.map((c) => card(c, p, ctx)), // CR #136: several collections or keys are collapsible cards
    h('div.sp-ft', h('a.go', { href: href(redis ? instancePath(p.store) : storePath(storeKey), envQuery(ctx.env)) }, redis ? `Open ${p.store} · all keys ` : `Open ${p.store} `, h('span', { 'aria-hidden': 'true' }, '→')), small));
  return { nodes: [head, body], title, body,
    setCurrent: (n) => body.querySelectorAll('.sp-sc').forEach((b) => b.classList.toggle('cur', n != null && Number(b.dataset.n) === n)) };
}
