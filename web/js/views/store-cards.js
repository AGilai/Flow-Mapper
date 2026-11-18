// CR #136 (design/mockups/frames/frame-30.html): the store panel's collapsible cards, one per collection (Mongo) or key template (Redis), for a store the flow touches
// in several. Collapsed by default, one open at a time; an open card pins its header and its tabs (Calls | Schema, or Calls | Key). The data is core/store-cards.ts.

import { h, s } from '../dom.js';
import { api } from '../api.js';
import { rwOf, sortOps, cardCounts, plural, schemaTree, touchedPaths, keyFacts } from '../../core/store-cards.js';
import { opRow } from './store-panel-ops.js';
import { registryBlock } from './store-panel-reg.js';
import { schemaView } from '../components/schema-view.js';
import { schemaTreeView } from './store-schema-tree.js';

const chevron = () => s('svg', { class: 'chv', viewBox: '0 0 14 14', 'aria-hidden': 'true' }, s('path', { d: 'M5 3l4 4-4 4' }));
const rwMarks = (c) => { const { r, w } = rwOf(c); return h('span.cc-rw', { title: [r && 'read', w && 'write'].filter(Boolean).join(', ') || 'access not reported' }, h(`i.r${r ? '.on' : '.off'}`, 'R'), h(`i.w${w ? '.on' : '.off'}`, 'W')); };

/** The Key tab of a Redis card: template (placeholders coloured), type, TTL and where it is set, db, other spellings, then the registry line. */
function keyPage(c, ctx) {
  const k = keyFacts(c), row = (dt, dd) => [h('dt', dt), h('dd', dd)];
  return h('div', h('dl.cc-kv', row('Template', k.parts.map((x) => (x.ph ? h('span.cc-ph', x.text) : x.text))), k.type ? row('Type', k.type) : null,
    k.ttl ? row('TTL', [k.ttl.text, k.ttl.note || k.setBy ? h('small', [k.ttl.note, k.setBy ? `set in ${k.setBy}` : null].filter(Boolean).join(' · ')) : null]) : null,
    k.dbs.length ? row('db', k.dbs.join(', ')) : null, k.variants.length ? row(k.variants.length === 1 ? 'Also spelled' : 'Also spelled as', k.variants.join(', ')) : null),
  c.template ? registryBlock(ctx.registry, c.template, c.dbs) : null);
}

/** The Schema tab: loaded on the first click, from the schema source the panel already used (api.store). */
function schemaPage(p, c, ctx) {
  const body = h('div.sp-schbody', { 'data-qa': 'sp-schema' }), key = `${p.group}/${c.title}`, touched = touchedPaths(c);
  let loaded = false;
  const load = async () => {
    if (loaded) return;
    loaded = true; body.replaceChildren(h('p.muted.xs', 'Loading the schema…'));
    try {
      const st = await api.store(ctx.env, key);
      body.replaceChildren(...(st.schemas.length ? st.schemas.map((x) => { const tree = schemaTree(x.content, touched); return h('div', st.schemas.length > 1 ? h('div.cc-sh', `from ${x.source}`) : null, tree.length ? schemaTreeView(tree, st.schemas.length > 1 ? `from ${x.source}` : null) : schemaView(x.content)); }) : [h('p.muted.xs.none', `No schema for ${c.title} yet.`)]));
    } catch { loaded = false; body.replaceChildren(h('p.muted.xs', 'The schema could not be loaded.')); }
  };
  return { el: h('div.cc-pg', { 'data-pg': 'schema' }, body), load };
}

function oneCard(c, p, ctx, onOpen) {
  const redis = p.kind === 'redis', unreported = c.kind === 'unreported', n = cardCounts(c), name = unreported ? 'Key not reported' : c.title;
  const pages = { calls: h('div.cc-pg.on', { 'data-pg': 'calls' }, sortOps(c.ops).map((o) => opRow(o, ctx)),
    unreported ? h('div.sp-nk', 'The harvester ', c.reason ? ['could not read the key for these steps ', h('i', `(${c.reason})`), '.'] : 'did not send the key for these steps.') : null) };
  let more = null;
  if (redis && !unreported) pages.key = h('div.cc-pg', { 'data-pg': 'key' }, keyPage(c, ctx));
  if (!redis) { more = schemaPage(p, c, ctx); pages.schema = more.el; }
  const tabs = Object.keys(pages).map((id) => h('button.cc-tab', { type: 'button', role: 'tab', 'data-p': id, 'aria-selected': String(id === 'calls'),
    on: { click: () => pick(id) } }, id === 'calls' ? 'Calls ' : id === 'key' ? 'Key' : 'Schema', id === 'calls' ? h('small', String(n.calls)) : null));
  const sub = (Object.keys(pages).length > 1) ? h('div.cc-tabs', { role: 'tablist' }, tabs) : null;
  function pick(id) {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.p === id)));
    Object.entries(pages).forEach(([k, el]) => el.classList.toggle('on', k === id));
    if (id === 'schema') more.load();
  }
  const btn = h('button.cch', { type: 'button', 'aria-expanded': 'false', 'data-qa': 'sp-card-head', on: { click: () => onOpen(el) } }, chevron(), h('span.cn', name),
    h('span.cnt', h('b', String(n.calls)), ` ${n.calls === 1 ? 'call' : 'calls'}`), rwMarks(c));
  const meta = h('div.cmeta', h('span', redis ? 'key in ' : 'collection of ', h('b', p.store)), h('span', `${plural(n.steps, 'step')} in this flow`));
  const el = h('section.cc', { 'data-qa': 'sp-card' }, h('div.cchw', btn, meta, sub), h('div.cbody', Object.values(pages)));
  el.btn = btn;
  return el;
}

/** cardList(p, ctx) -> the element holding the cards of a panel model `p` (ctx as store-panel.js: env, registry, current(), onStep(n)). */
export function cardList(p, ctx) {
  const root = h('div.sp-cards');
  const toggle = (el) => {
    const was = el.classList.contains('open');
    root.querySelectorAll('.cc.open').forEach((x) => { x.classList.remove('open'); x.btn.setAttribute('aria-expanded', 'false'); });
    if (was) return;
    el.classList.add('open'); el.btn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
  };
  root.append(...p.cards.map((c) => oneCard(c, p, ctx, toggle)));
  return root;
}
