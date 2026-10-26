// The head of a flow page (0.20.0, reworked 0.45.0, #91, frame 25): the title row (name, key, the "Info · N related" pill, the toolbars) and, under it, the
// Info banner: an inline region that holds the flow's description (Markdown-lite, four lines, "Show all", A− / A+) and its related flows. Open or closed is
// the viewer's one saved choice (`flow-mapper.flowinfo`); the first time a flow with a description is opened, the banner opens once (flow-info-pure.js).
// The page works without storage.

import { h } from '../dom.js';
import { descBlock } from './flow-desc.js';
import { pillText, infoInitial, infoSave } from './flow-info-pure.js';
import { sizeControl } from './flow-textsize.js';

let seq = 0;

/**
 * descDetails(store, root, callee, { cls, summary, title, onGenerate, pen, relations, seenKey, canAdd }) -> { el, dispose, setRelated(n), open(on) }
 * summary: the nodes of the title row (the first one is the title). relations: createRelations(...) | null, drawn inside the banner; it calls setRelated(n).
 * seenKey: what the "first visit" is remembered by. canAdd: the viewer can add a description or a relation (a draft is open), so the pill shows without either.
 */
export function descDetails(store, root, callee, { cls, summary, title, quiet = false, onGenerate, pen = null, relations = null, seenKey = '', canAdd = false }) {
  const block = descBlock(store, root, callee, { title, wholeFlow: callee === null, onGenerate, wide: true, quiet });
  const id = `fin-banner-${++seq}`, size = sizeControl();
  let hasDesc = false, related = 0, isOpen = false, all = false, decided = false;
  const pillTxt = h('span.fin-t'), pill = h('button.fin-pill', { type: 'button', 'data-qa': 'info-pill', 'aria-expanded': 'false', 'aria-controls': id, on: { click: () => set(!isOpen, true) } },
    pillTxt, h('span.fin-ch', { 'aria-hidden': 'true' }, '▾'));
  const more = h('button.linkish.fin-all', { type: 'button', 'data-qa': 'info-show-all', hidden: true, 'aria-expanded': 'false', on: { click: () => { all = !all; paint(); fit(); } } }, 'Show all');
  const desc = h('div.fin-desc.clamped', h('h5', 'Description', h('span.grow'), size.el), block.el, more);
  const ban = h('section.fin-banner', { id, 'data-qa': 'info-banner', role: 'region', 'aria-label': 'Flow info', hidden: true }, desc, relations ? relations.el : null);
  const nodes = summary.filter(Boolean);
  const note = pen?.note('flow description', () => { set(true, false); block.edit(); }); // an annotation pencil: any environment (0.31.1)
  const row = h('div.fh-sum', ...nodes.slice(0, 2), pill, ...nodes.slice(2), note);
  const el = h(`div.${cls}`, { 'aria-label': title }, row, ban);

  function fit() { // "Show all" only when something is cut
    if (!isOpen || all) return;
    more.hidden = ![...desc.querySelectorAll('.dbox .md')].some((m) => m.scrollHeight > m.clientHeight + 2);
  }
  function paint() {
    const t = pillText(hasDesc, related, canAdd);
    pill.hidden = t === null; pillTxt.textContent = t ?? '';
    pill.setAttribute('aria-expanded', String(isOpen)); ban.hidden = !isOpen || t === null;
    desc.classList.toggle('clamped', !all); more.textContent = all ? 'Show less' : 'Show all'; more.setAttribute('aria-expanded', String(all));
    if (all) more.hidden = false;
  }
  function set(on, save) { isOpen = on; if (save) infoSave(on); paint(); requestAnimationFrame(fit); }
  const unwatch = store.watch(root, (d) => {
    if (!d) return;
    hasDesc = !!(d.flow?.human || d.flow?.ai);
    if (!decided) { decided = true; isOpen = infoInitial(seenKey, hasDesc).open; }
    paint(); requestAnimationFrame(fit);
  });
  desc.addEventListener('fm:md', fit);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null; ro?.observe(ban);
  paint();
  return { el, setRelated: (n) => { related = n; paint(); }, open: (on) => set(on, false), dispose: () => { unwatch(); block.dispose(); size.dispose(); ro?.disconnect(); relations?.dispose(); } };
}
