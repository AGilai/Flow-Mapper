// The head of a flow page (0.20.0, reworked 0.45.0 #91, again 0.46.0 #95, frame 26): the title row (name, key, doc link, the toolbars) and, under it, the
// "About this flow" region: ONE full-width region whose header row is the toggle (chevron, title, a one-line preview and an "N related" chip). Open, the same header
// carries Show all / Show less, A− / A+, Edit and a "⋯" menu (Generate AI description…); under it the description (four lines, full width) and the related flows.
// Open or closed is the viewer's one saved choice (`flow-mapper.flowinfo`); the first time a flow with a description is opened, the region opens once (flow-info-pure.js).
// The page works without storage.

import { h } from '../dom.js';
import { stripMarkdown } from '../../core/markdown-strip.js';
import { aboutText } from './flow-about-text.js';
import { moreMenu } from './flow-more-menu.js';
import { chipText, aboutControls, infoInitial, infoSave } from './flow-info-pure.js';
import { sizeControl } from './flow-textsize.js';

let seq = 0;

/**
 * descDetails(store, root, callee, { cls, summary, title, onGenerate, pen, relations, seenKey }) -> { el, dispose, setRelated(n), open(on) }
 * summary: the nodes of the title row (the first one is the title). relations: createRelations(...) | null, drawn inside the region; it calls setRelated(n).
 * seenKey: what the "first visit" is remembered by.
 */
export function descDetails(store, root, callee, { cls, summary, title, onGenerate, pen = null, relations = null, seenKey = '' }) {
  const id = `about-body-${++seq}`, size = sizeControl();
  let related = 0, isOpen = false, all = false, decided = false, clipped = false;
  const about = aboutText(store, root, { title, onChange: () => { paint(); requestAnimationFrame(fit); } });

  const pv = h('span.pv'), cnt = h('span.fab-cnt', { 'data-qa': 'about-related', hidden: true });
  const tg = h('button.fab-tg', { type: 'button', 'data-qa': 'about-toggle', 'aria-expanded': 'false', 'aria-controls': id, on: { click: () => set(!isOpen, true) } },
    h('span.ch', { 'aria-hidden': 'true' }, '›'), h('span.ttl', 'About this flow'), pv, cnt);
  const showAll = h('button.fab-tb', { type: 'button', 'data-qa': 'about-show-all', hidden: true, 'aria-expanded': 'false', on: { click: () => { all = !all; about.setClamp(!all); paint(); requestAnimationFrame(fit); } } }, 'Show all');
  const editBtn = h('button.fab-tb.pri', { type: 'button', 'data-qa': 'about-edit', on: { click: () => { set(true, false); about.edit(); } } }, 'Edit');
  const menu = moreMenu({ label: 'More actions', items: [{ label: 'Generate AI description…', note: 'Copies a prompt for your AI tool; its usage is billed to you', onSelect: () => onGenerate() }] });
  const ctl = h('div.fab-ctl', { 'data-qa': 'about-controls' }, showAll, size.el, editBtn, menu.el);
  const hd = h('div.fab-hd', tg, ctl);
  const bd = h('div.fab-bd', { id, hidden: true }, about.el, relations ? relations.el : null);
  const sec = h('section.fab', { 'data-qa': 'about-region', role: 'region', 'aria-label': 'About this flow' }, hd, bd);

  const note = pen?.note('flow description', () => { set(true, false); about.edit(); }); // an annotation pencil: any environment (0.31.1)
  const row = h('div.fh-sum', ...summary.filter(Boolean), note);
  const el = h(`div.${cls}`, { 'aria-label': title }, row, sec);

  function fit() { // "Show all" only when something is cut
    if (!isOpen) return;
    const c = !all && about.clipped();
    if (c !== clipped) { clipped = c; paint(); }
  }
  function paint() {
    const text = about.hasText(), c = aboutControls({ open: isOpen, hasText: text, clipped, expanded: all });
    const chip = chipText(related);
    tg.setAttribute('aria-expanded', String(isOpen)); sec.classList.toggle('open', isOpen); bd.hidden = !isOpen;
    const prev = stripMarkdown(about.preview());
    pv.hidden = isOpen; pv.textContent = prev || (about.loaded() ? 'No description yet' : ''); pv.classList.toggle('none', !prev); // nothing until loaded: no flash
    cnt.hidden = !chip; cnt.textContent = chip ?? '';
    ctl.hidden = !isOpen; showAll.hidden = !c.showAll; size.el.hidden = !c.size; editBtn.hidden = !c.edit || about.editing(); menu.el.hidden = !c.menu;
    showAll.textContent = all ? 'Show less' : 'Show all'; showAll.setAttribute('aria-expanded', String(all));
    if (!isOpen) menu.close(false);
  }
  function set(on, save) { isOpen = on; if (save) infoSave(on); paint(); requestAnimationFrame(fit); }
  const unwatch = store.watch(root, (d) => {
    if (!d) return;
    if (!decided) { decided = true; isOpen = infoInitial(seenKey, !!(d.flow?.human || d.flow?.ai)).open; }
    paint(); requestAnimationFrame(fit);
  });
  size.el.addEventListener('click', () => requestAnimationFrame(fit));
  sec.addEventListener('fm:md', fit);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { el.style.setProperty('--fh-sum-h', `${row.offsetHeight}px`); fit(); }) : null; ro?.observe(row); ro?.observe(bd);
  paint();
  return { el, setRelated: (n) => { related = n; paint(); }, open: (on) => set(on, false), dispose: () => { unwatch(); about.dispose(); size.dispose(); menu.close(false); ro?.disconnect(); relations?.dispose(); } };
}
