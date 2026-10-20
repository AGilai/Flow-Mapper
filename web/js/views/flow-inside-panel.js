// The drill-down: "Inside <service>" for one bar. A 380px column to the right of the diagram that squeezes it (it is a
// grid column of the flows view, not an overlay). Lists only what this call runs; Esc or the close button closes it.

import { h, fill } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { href } from '../router.js';
import { chip } from '../format.js';
import { idParts } from './flow-async.js';
import { insideBar } from './flow-inside.js';
import { servicePath } from './inventory-links.js';

const wrapId = (t) => idParts(t).flatMap((x, i) => (i ? [h('wbr'), x] : [x]));
const codeLoc = (c) => (c?.file ? `${c.file}${c.line ? ':' + c.line : ''}` : null);
const codeLink = (c) => (c?.url ? h('a.fi-code', { href: c.url, target: '_blank', rel: 'noopener noreferrer', title: c.url }, codeLoc(c) ?? 'code', ' ', icon('external')) : null);

/** createInside(host, { env, onClose, onOpen, onStep, isActive? }) -> { open(bar, trace), close, isOpen, el } */
export function createInside(host, { env, onClose, onOpen, onStep, isActive }) {
  const el = h('aside.fi', { 'aria-label': 'Inside the service', hidden: true });
  host.append(el);
  let current = null;

  const stepRow = (st) => {
    const m = st.m;
    const meta = m.kind === 'resource' ? [chip('res', 'store'), h('span.key', m.label), h('span.muted.xs', (m.store ?? '').replace(/^[^:]+:/, ''))]
      : st.type === 'call' ? [h('span.muted.xs', 'calls'), h('b.fn', m.calls ?? m.label)]
      : st.type === 'publish' ? [chip(m.transport ?? 'sns'), h('span.key', `publish ${m.event ?? ''}`.trim()), h('span.muted.xs', m.to.slice(3))]
      : st.type === 'unresolved' ? [chip(m.transport ?? 'http'), h('span.key', m.label.replace(/^\w+:/, '')), h('span.chip-bad', 'no match')]
      : st.type === 'frontier' ? [h('span.muted.xs', m.label)]
      : [chip(m.transport ?? 'http'), h('span.key', m.label.replace(/^\w+:/, ''))];
    return h('button.fi-step', { class: st.type, title: 'Mark this arrow in the diagram', on: { click: () => onStep?.(m) } }, h('span.fi-meta', meta), st.code ? codeLink(st.code) : null);
  };
  const block = (b) => b.branches
    ? h('div.fi-alt', h('div.fi-alt-h', h('span.alt-kw', 'alt'), h('b', b.alt.group.split(':').pop()), h('span.muted.xs', `${b.branches.length} of ${b.alt.of} branches shown`)),
      b.branches.map((br) => h('div.fi-branch', h('div.fi-cond', br.condition ? `[${br.condition}]` : `branch ${br.branch}`), br.steps.map(stepRow))))
    : stepRow(b);

  function open(bar, trace) {
    current = bar.id;
    const info = insideBar(bar, trace);
    const entry = info.entry;
    const from = trace.participants.find((p) => p.id === entry.from);
    const all = h('a.fi-all', { href: href(servicePath(bar.service)) }, `All functions of ${bar.service} ›`);
    fill(el,
      h('header.fi-head', h('div.grow', h('h2.fi-title', `Inside `, ...wrapId(bar.service)),
        h('div.muted.small', 'Entered by ', chip(entry.transport ?? 'http'), ' ', h('span.key', ...wrapId(entry.label.replace(/^\w+:/, ''))), from?.kind === 'service' ? ` from ${from.label}` : '')),
      h('button.btn.ghost', { 'aria-label': 'Close', title: 'Esc', on: { click: close } }, icon('close'))),
      h('div.fi-counts', h('span', h('b', info.counts.functions), ` ${info.counts.functions === 1 ? 'function runs' : 'functions run'}`), h('span', h('b', info.counts.internal), ' internal calls'),
        h('span', h('b', info.counts.outgoing), ' outgoing'), h('span', h('b', info.counts.stores), ` ${info.counts.stores === 1 ? 'store' : 'stores'}`), all),
      h('div.fi-body', h('h3', info.middleware ? 'Middleware, then the functions this call runs' : 'Functions this call runs'),
        info.functions.map((f) => h('section.fi-fn', { style: { marginLeft: `${Math.min(f.depth, 4) * 14}px` } },
          h('div.fi-fn-h', h('b.fn', f.fn), f.middleware ? h('span.chip-mw', `middleware ${f.middleware} of ${info.middleware}`) : null, f.isEntry ? h('span.chip-gap', f.ingress ? `entry · ${f.ingress}` : 'entry') : null), codeLink(f.code),
          f.items.length ? h('div.fi-steps', f.items.map(block)) : h('p.muted.xs', 'No steps recorded.'))),
        h('p.muted.xs', 'Execution order. Functions this call does not reach stay on the service page. Click a step to mark its arrow.')));
    el.hidden = false; onOpen?.();
    api.service(env, bar.service).then((v) => { if (current === bar.id && !el.hidden) all.textContent = `All ${v.functions.length} functions of ${bar.service} ›`; }).catch(() => {});
  }
  function close() { if (el.hidden) return; el.hidden = true; current = null; onClose?.(); }
  const onKey = (e) => { if (e.key === 'Escape' && !el.hidden && (!isActive || isActive())) { close(); } };
  addEventListener('keydown', onKey);
  return { open, close, isOpen: () => !el.hidden, el, dispose: () => removeEventListener('keydown', onKey) };
}
