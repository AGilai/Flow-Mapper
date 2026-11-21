// The hover card on a lifeline head (#149): name, Type and the first About section, after 400 ms of hover or on keyboard focus.
// It never takes the pointer (so it cannot cover the head's click or its ⋮), and goes away on leave, click or Esc. Replaces the head's <title> tooltip.

import { h } from '../dom.js';
import { api } from '../api.js';
import { headCardModel } from './head-card-pure.js';
import { typeOf } from '../pane/pane-type.js';

/** createHeadCard(env) -> { show(service, label, anchor), hide(), dispose() } */
export function createHeadCard(getEnv) {
  let el = null, timer = 0, current = null;
  const cache = new Map();
  const hide = () => { clearTimeout(timer); current = null; el?.remove(); el = null; removeEventListener('keydown', onKey, true); };
  const onKey = (ev) => { if (ev.key === 'Escape') hide(); };
  async function load(name) {
    const env = getEnv(), k = `${env}\n${name}`;
    if (!cache.has(k)) {
      const [S, M, view] = await Promise.all([import('../../core/about-sections.js'), import('../../core/markdown-strip.js'), api.service(env, name).catch(() => null)]);
      const svc = view?.service ?? {};
      cache.set(k, headCardModel({ name, type: typeOf(svc, svc.kind ?? 'service'), sections: S.aboutSections(svc.about), description: svc.description }, M.stripMarkdown));
    }
    return cache.get(k);
  }
  function place(anchor) {
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth, ht = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    const below = r.bottom + 8;
    el.style.top = `${below + ht > innerHeight - 8 ? Math.max(8, r.top - ht - 8) : below}px`;
  }
  async function paint(name, anchor) {
    const m = await load(name);
    if (current !== name) return;
    el = h('div.desctip.headcard', { role: 'tooltip', 'data-qa': 'head-card' }, h('div.tip-t', m.name), h('div.tip-f.hc-type', `Type: ${m.type}`),
      m.empty ? h('p.muted', 'No description yet') : h('p', m.heading ? [h('b', `${m.heading}. `), m.text] : m.text));
    document.body.append(el);
    place(anchor);
    addEventListener('keydown', onKey, true);
  }
  return { show(name, anchor) { hide(); current = name; timer = setTimeout(() => paint(name, anchor), 400); }, hide, dispose: hide };
}
