// #86 the store panel of one tab: opens from a Redis or Mongo head, marks the pressed head, dims the other arrows, jumps to a step from a chip, keeps `store=` in the URL.
// The pane itself is the flow's single right-hand panel (host.panel), as the step panel and "Why incomplete" are: one pane, one close.

import { s } from '../dom.js';
import { storePanel, targetOf, targetKey, storeParts } from '../../core/store-panel.js';
import { storePanelView } from './store-panel.js';
import { loadRegistry } from './store-panel-reg.js';
import { stepByKey } from './flow-steps.js';
import { pressed, press, targetOfHead, scrollPlan, flashMs } from './store-panel-pure.js';

const calm = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** createStorePanel({ body (the tab's flow-body), host, trace(), walk, label(), inside, onKey(key|null) }) -> { press(col, ev), restore(key), refresh(), clear(), paint(), active() } */
export function createStorePanel({ body, host, trace, walk, label, inside, isActive, onKey }) {
  let active = null, view = null, cur = null, band = null, timer = 0, want = null;
  const refocus_ = () => want && heads().find((x) => x.dataset.store === want.group && x.dataset.coll === want.coll)?.focus({ preventScroll: true });
  const lane = () => body.querySelector('.flow-lane svg.seq-body');
  const stepNo = (m) => { const all = walk.steps(); return (all.find((x) => x.event.msg === m) ?? (m.key ? stepByKey(all, m.key) : null))?.n ?? null; };
  const model = (t) => storePanel(trace(), t, { stepNo, total: walk.steps().length });
  const heads = () => [...body.querySelectorAll('svg.seq-head g.store-hd')];
  const colOf = (g) => ({ kind: 'resource', group: g.dataset.store, collection: g.dataset.coll || null, stack: g.dataset.stack === '1', storeKind: g.dataset.kind });

  function unflash() { clearTimeout(timer); band?.remove(); band = null; }
  function paint() {
    const svg = lane(), on = !!active, hot = new Set();
    heads().forEach((g) => { const p = pressed(colOf(g), active); g.setAttribute('aria-pressed', String(p)); if (p) hot.add(g.dataset.p); });
    body.querySelectorAll('.sp-dim, .sp-hit, .sp-sel').forEach((e) => e.classList.remove('sp-dim', 'sp-hit', 'sp-sel'));
    svg?.classList.toggle('sp-on', on);
    refocus_();
    if (!svg || !on) return;
    svg.querySelectorAll('line.lifeline[data-p]').forEach((l) => l.classList.toggle('sp-sel', hot.has(l.dataset.p)));
    const mine = new Set(view?.steps ?? []);
    for (const st of walk.steps()) {
      svg.querySelector(`[data-e="${st.row}"]`)?.classList.toggle('sp-dim', !mine.has(st.n));
      svg.querySelector(`.steptile[data-step="${st.n}"]`)?.classList.toggle('sp-hit', mine.has(st.n));
    }
  }
  function show(t, { keyboard = false, quiet = false } = {}) {
    const m = model(t);
    if (!m) return false;
    const services = trace().messages.filter((x) => x.kind === 'resource' && storeParts(x).group === t.group).map((x) => x.service).filter(Boolean);
    const v = storePanelView(m, { env: host.env, flowLabel: label(), current: () => cur, onStep: jump, registry: m.kind === 'redis' ? loadRegistry(host.env, m.store, services) : Promise.resolve(null) });
    v.steps = m.cards.flatMap((c) => c.steps);
    active = t; view = v;
    if (!quiet) {
      body.querySelectorAll('.msg.active').forEach((e) => e.classList.remove('active'));
      inside.close();
    }
    host.flowsEl.classList.add('mp-open');
    host.panel.open(...v.nodes);
    paint();
    if (!quiet) onKey(targetKey(t));
    if (keyboard) v.title.focus({ preventScroll: true });
    return true;
  }
  /** The panel is gone (closed, or another panel took the pane): un-press the head, undim, drop `store=`. `focus`: the pane or the page had focus, so it goes back to the head. */
  function clear(refocus = false) {
    if (!active) return;
    const back = host.panel.el.contains(document.activeElement) || document.activeElement === document.body;
    const g = heads().find((x) => x.getAttribute('aria-pressed') === 'true');
    active = null; view = null; cur = null; unflash(); paint(); onKey(null);
    if (refocus && back && g) { // closing widens the diagram, which draws the heads again: focus the new head too
      want = { group: g.dataset.store, coll: g.dataset.coll };
      requestAnimationFrame(refocus_); setTimeout(() => { refocus_(); want = null; }, 450);
    }
  }
  function jump(n) {
    const st = walk.steps()[n - 1], svg = lane(), el = st && svg?.querySelector(`[data-e="${st.row}"]`);
    if (!el) return;
    unflash(); cur = n; view?.setCurrent(n);
    const sc = body.querySelector('.seq-scroll'), plan = scrollPlan(el.getBoundingClientRect(), sc?.getBoundingClientRect());
    el.scrollIntoView({ block: plan, inline: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
    const sp = walk.rowSpan(n);
    if (!sp) return;
    band = s('rect', { class: 'sp-flash', x: 0, y: sp.top, width: svg.viewBox.baseVal.width || svg.getAttribute('width'), height: sp.bottom - sp.top, 'pointer-events': 'none', 'aria-hidden': 'true' });
    (svg.querySelector(':scope > defs') ?? svg.firstChild)?.after(band);
    const ms = flashMs(calm());
    if (ms) timer = setTimeout(unflash, ms);
  }
  return {
    active: () => active,
    paint, clear,
    press(col, ev) {
      const t = targetOfHead(col), r = press(active, t);
      if (r.close) host.panel.close(); else show(r.open, { keyboard: ev.type === 'keydown' });
    },
    /** `store=` of a link: the panel again; a store this flow does not touch is ignored. */
    restore(key) { const t = targetOf(trace(), key); if (t && isActive()) show(t, { quiet: true }); else if (key) onKey(null); },
    /** The trace changed (an arm, the detail): the panel is built again from it, or goes when the flow no longer touches the store. */
    refresh() { if (!active) return; if (!model(active)) host.panel.close(); else show(active, { quiet: true }); },
  };
}
