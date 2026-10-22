// Accordion rows of the expanded page (0.33.0, frame 19h). Open rows are remembered per browser (not per component); a row's body is built the
// first time it opens, so Endpoints can load its DTOs only when somebody looks.
//   const acc = createAccordion();
//   acc.row({ id, title, count?, small?, q?, right?, sub?, body: () => Node | Node[] | Promise<...>, children?: [rowDef] }) -> Element

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { parseOpen } from './pane-pure.js';

const KEY = 'flow-mapper.pane-open';
const load = () => { try { const raw = localStorage.getItem(KEY); return { open: parseOpen(raw), fresh: raw == null }; } catch { return { open: parseOpen(null), fresh: true }; } };
const save = (set) => { try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* storage unavailable */ } };

export function createAccordion({ onToggle = null } = {}) {
  const { open, fresh } = load(), rows = new Map(); // id -> { el, btn, bd, def, built }

  async function build(r) {
    if (r.built) return;
    r.built = true;
    r.bd.replaceChildren(h('p.pane-loading', 'Loading…'));
    try { const nodes = await r.def.body(); r.bd.replaceChildren(...[nodes].flat(Infinity).filter(Boolean)); } catch { r.bd.replaceChildren(h('p.pane-none', 'Could not load this.')); }
  }
  function paint(id) {
    const r = rows.get(id);
    if (!r) return;
    const on = open.has(id);
    r.btn.setAttribute('aria-expanded', String(on));
    r.bd.hidden = !on;
    r.el.classList.toggle('open', on);
    if (on) build(r);
  }
  function set(id, on) { if (on) open.add(id); else open.delete(id); paint(id); save(open); onToggle?.(id, on); }

  function row(def, parent = null) {
    if (fresh && def.sub && def.defaultOpen !== false) open.add(def.id); // the first time, the sections of the About are open with it (frame 19h)
    const bd = h('div.bd', { role: 'region', hidden: true });
    const btn = h('button', { type: 'button', 'aria-expanded': 'false', 'data-qa': `acc-${def.id}`, on: { click: () => set(def.id, !open.has(def.id)) } }, icon('chev', 'chev'), h('span', def.title),
      def.count != null && def.count !== '' ? h('small', String(def.count)) : null, def.small ? h('small', def.small) : null);
    const el = h('section.pane-acc', { id: `acc-${def.id}`, 'data-acc': def.id, class: `${def.q ? 'q' : ''} ${def.sub ? 'sub' : ''}`.trim() }, h('h4.hd', btn, def.right ? h('span.r', def.right) : null), bd);
    btn.setAttribute('aria-controls', bd.id = `accb-${def.id}`);
    rows.set(def.id, { el, btn, bd, def, built: false, parent });
    const kids = def.children?.map((c) => row({ ...c, sub: true }, def.id));
    if (kids?.length) { const inner = def.body; def.body = () => [inner ? inner() : null, h('div.pane-acc-kids', kids)]; }
    paint(def.id);
    return el;
  }
  return {
    row, set, isOpen: (id) => open.has(id), toggle: (id) => set(id, !open.has(id)), el: (id) => rows.get(id)?.el ?? null, btn: (id) => rows.get(id)?.btn ?? null,
    ids: () => [...rows.keys()],
    /** Expand all / Collapse all: every row, the About sections included. */
    all(on) { for (const id of rows.keys()) { if (on) open.add(id); else open.delete(id); paint(id); } save(open); onToggle?.(null, on); },
    /** Open a row (and the rows it sits in) and bring it into view. */
    reveal(id) {
      const chain = [];
      for (let k = id; k; k = rows.get(k)?.parent) chain.unshift(k);
      for (const k of chain) if (!open.has(k)) set(k, true);
      requestAnimationFrame(() => rows.get(id)?.el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    },
  };
}
