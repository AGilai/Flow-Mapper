// The info pane's frame (0.33.0, frame 19): the header (tile, name, sub line, tools, marks), the jump bar and the scrolling body of sections.
// `paneFrame(spec)` -> { root, scroller, setCount(id, n), scrollTo(id), beginEdit(editor), endEdit(), section(id) }. No data here: the builders hand it nodes.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { JUMPS, currentJump } from './pane-pure.js';

const tool = (label, ic, on, extra = {}) => h('button.pane-ib', { type: 'button', 'aria-label': label, title: label, on: { click: on }, ...extra }, ic);

/**
 * spec: { tile(): Node, title, mono?, sub: [text], marks?(goQuestions): [Node], kind: 'component' | 'subsystem', sections: { id: Node } (null = no section, ids as JUMPS),
 *         counts?: { id: n }, tools: { edit?: Node|null, expand?: fn|null, pinned: bool, onPin(on), onClose() } }
 */
export function paneFrame(spec) {
  const { tools } = spec;
  const pin = tool('Pin: keep the pane open when you click elsewhere', icon('pin'), () => { const on = pin.getAttribute('aria-pressed') !== 'true'; pin.setAttribute('aria-pressed', String(on)); tools.onPin?.(on); }, { 'aria-pressed': String(!!tools.pinned), 'data-qa': 'pane-pin' });
  const expand = tools.expand ? tool('Expand (full screen), key E', icon('maximize'), tools.expand, { 'data-qa': 'pane-expand' }) : null;
  const close = tool('Close details', icon('close'), tools.onClose, { 'data-qa': 'pane-close' });
  const marks = h('div.pane-marks');
  const sub = h('div.pane-sub', (spec.sub ?? []).filter(Boolean).map((t, i) => [i ? h('span', '·') : null, h('span', t)]));
  const head = h('header.pane-hd', spec.tile(), h('div.pane-title', h('h3', { class: spec.mono ? 'mono' : '' }, spec.title), sub),
    h('div.pane-tools', tools.back ? tool('Back to the previous item', icon('back'), tools.back, { 'data-qa': 'pane-back' }) : null, tools.edit ?? null, expand, pin, close), marks);

  const ids = (JUMPS[spec.kind] ?? JUMPS.component).filter((j) => spec.sections[j.id]);
  const counts = { ...(spec.counts ?? {}) };
  const jumps = new Map();
  const bar = h('nav.pane-jump', { 'aria-label': 'Sections' }, ids.map((j) => {
    const b = h('button', { type: 'button', 'data-jump': j.id, on: { click: () => scrollTo(j.id) } }, j.label, h('small'));
    jumps.set(j.id, b);
    return b;
  }));
  const setCount = (id, n) => { counts[id] = n; const s = jumps.get(id)?.querySelector('small'); if (s) s.textContent = n ? String(n) : ''; };
  for (const j of ids) setCount(j.id, counts[j.id]);

  const secs = new Map(ids.map((j) => [j.id, spec.sections[j.id]]));
  const scroller = h('div.pane-scroll', { tabindex: -1 }, h('div.pane-body', [...(spec.lead ?? []), ...secs.values()]));
  const edHost = h('div.pane-edit', { hidden: true });
  const root = h('div.pane-root', { 'data-qa': 'pane', 'data-kind': spec.kind ?? '' }, head, bar, scroller, edHost);

  function mark() {
    const top = scroller.getBoundingClientRect().top;
    const tops = ids.map((j) => (secs.get(j.id).isConnected ? secs.get(j.id).getBoundingClientRect().top - top : null));
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2 && scroller.scrollTop > 0;
    const cur = atEnd ? ids.length - 1 : currentJump(tops, 24);
    ids.forEach((j, i) => { const on = i === cur; jumps.get(j.id).classList.toggle('on', on); if (on) jumps.get(j.id).setAttribute('aria-current', 'true'); else jumps.get(j.id).removeAttribute('aria-current'); });
  }
  let raf = 0;
  scroller.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(mark); }, { passive: true });
  function scrollTo(id, { smooth = true } = {}) { scrollToEl(secs.get(id), smooth); }
  function scrollToEl(el, smooth = true) {
    if (!el) return;
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 4;
    scroller.scrollTo({ top, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
    setTimeout(mark, 60);
  }
  marks.replaceChildren(...(spec.marks?.(() => scrollToEl(scroller.querySelector('.pane-ab.q') ?? secs.get('about'))) ?? []).filter(Boolean));
  queueMicrotask(mark);
  let shown = [];
  /** The About editor in place of the sections (pane-edit.js): its draft band, body and footer, and the "in draft / editing About" marks. */
  function beginEdit(ed) {
    bar.hidden = scroller.hidden = true; edHost.hidden = false; root.classList.add('editing');
    edHost.replaceChildren(ed.band, h('div.pane-edscroll', ed.node), ed.footer);
    shown = [...marks.children]; marks.append(...ed.chips());
  }
  function endEdit() {
    bar.hidden = scroller.hidden = false; edHost.hidden = true; root.classList.remove('editing'); edHost.replaceChildren();
    marks.replaceChildren(...shown); requestAnimationFrame(mark);
  }
  return { root, scroller, beginEdit, endEdit, setCount, scrollTo, scrollToEl, section: (id) => secs.get(id) ?? null, mark };
}
