// The View menu of the Flows toolbar (frame 28): one button, "View ▾" with a count of the options that differ from their defaults, and a popover with
// every display option of the page: Descriptions (the caption bar, the Read / Write legend), Diagram (group by subsystem, data stores, frontier, one arrow per target,
// squeeze, transport hints), Detail (depth, step details, text size, hide text). The state and what a change does stay in flows.js; this draws the switches.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { sizeControl, textSize, setTextSize } from './flow-textsize.js';
import { SIZE_DEFAULT } from './flow-info-pure.js';
import { popPlace } from './flow-bars-pure.js';
import { caps, setCap, onCaps } from './flow-caption-state.js';
import { flowDoc, setFlowDoc } from '../notes/flow-doc-state.js';
import { nonDefault } from './flow-view-pure.js';
import { hintsDefault } from './flow-hints-pure.js';
import { arrowsDefault } from './step-details-pure.js';

const DEPTHS = ['all', '1', '2', '3', '4', '6', '8'];

/**
 * createViewMenu({ ctx() -> { opts, assigned (the env has subsystems), detail, squeezeOn, design }, act: { stores, bands, frontier, merge, squeeze, hints, depth, reset(), step? }, stepMenu }) -> { el, paint(), close() }
 * Every act.* takes the new value and does what the old toolbar control did (flows.js).
 */
export function createViewMenu({ ctx, act, stepMenu }) {
  let pop = null, size = null, offCaps = null;
  const count = h('span.vm-n', { hidden: true, 'aria-hidden': 'true' }), label = h('span.vm-l', 'View');
  const btn = h('button.vm-btn', { type: 'button', 'data-qa': 'view-menu', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'View options: what the diagram and the caption show', on: { click: () => (pop ? close() : open()) } },
    icon('sliders'), label, count, h('span.vm-c', '▾'));
  const el = h('span.vm', btn);

  const diffs = () => { const { opts, assigned, design } = ctx(), c = caps(); return nonDefault({ bands: assigned ? opts.bands : null, stores: opts.stores, frontier: opts.frontier, merge: opts.merge, squeeze: opts.squeeze, hints: opts.th, hintsDefault: hintsDefault(design), depth: opts.depth, sb: opts.sb, sd: opts.sd, sdDefault: arrowsDefault(design), size: textSize(), hideText: c.hideText, caption: c.caption, legend: c.legend }); };
  function paintBtn() {
    const n = diffs().length;
    count.hidden = n === 0; count.textContent = String(n);
    btn.title = n ? `View options: ${n} ${n === 1 ? 'differs' : 'differ'} from the default` : 'View options: what the diagram and the caption show';
    btn.setAttribute('aria-label', n ? `View options, ${n} changed` : 'View options');
    const foot = pop?.querySelector('.vm-foot'), rst = pop?.querySelector('.vm-reset');
    if (foot) foot.replaceChildren(h('span.vm-n', String(n)), `${n === 1 ? 'option differs' : 'options differ'} from the default`); if (foot) foot.hidden = !n;
    if (rst) rst.disabled = !n;
  }
  function paint() { paintBtn(); if (pop) draw(); }
  const sw = (text, { on, off = false, note = null, qa, tip = null, change }) => h('label.vm-row', { class: off ? 'off' : '', title: tip },
    h('span.vm-t', text, note ? h('small', note) : null), h('input.vm-sw', { type: 'checkbox', role: 'switch', checked: !!on, disabled: off, 'data-qa': qa, on: { change: (e) => { change(e.target.checked); paint(); } } }));
  const head = (t) => h('div.vm-h', t);
  function draw() {
    const { opts, assigned, detail, squeezeOn } = ctx(), c = caps(), n = diffs().length;
    const top = pop.scrollTop;
    size?.dispose(); size = sizeControl(); size.el.addEventListener('click', paintBtn);
    const depth = h('select.select', { 'aria-label': 'Depth', 'data-qa': 'depth', on: { change: (e) => { act.depth(e.target.value); paint(); } } }, DEPTHS.map((d) => h('option', { value: d, selected: d === opts.depth }, d === 'all' ? 'All depths' : `Depth ${d}`)));
    pop.replaceChildren(...[
      h('div.vm-top', h('b', 'View options'), h('button.vm-reset', { type: 'button', disabled: !n, on: { click: () => { reset(); paint(); } } }, 'Reset to defaults')),
      head('Descriptions'),
      sw('Call notes', { on: c.caption, qa: 'caption-switch', note: 'The caption bar under the diagram', change: (v) => setCap('caption', v) }),
      sw('Flow doc', { on: flowDoc().enabled, qa: 'flowdoc-switch', note: 'The pane under the diagram and the note icon on the tab; step badges stay', change: (v) => setFlowDoc('enabled', v) }),
      sw('Legend', { on: c.legend, qa: 'legend-switch', note: 'Read / Write line key', change: (v) => setCap('legend', v) }),
      head('Diagram'),
      assigned ? sw('Group by subsystem', { on: opts.bands, qa: 'group-by-subsystem', tip: 'Put the components of one subsystem next to each other and show a band with its name over them', change: act.bands }) : null,
      sw('Data stores', { on: opts.stores, qa: 'data-stores', change: act.stores }),
      sw('Frontier', { on: opts.frontier, off: detail !== 'full', qa: 'frontier', note: detail !== 'full' ? 'Frontier steps show in Full' : null, tip: 'Frontier steps: call trees the harvester marked as reaching no sink. Folded into one marker per function by default.', change: act.frontier }),
      sw('One arrow per target', { on: opts.merge, off: detail !== 'simple', qa: 'merge-check', note: detail !== 'simple' ? 'Simple only' : null, tip: 'Simple: all calls of one service to one target inside one activation are one arrow, whatever lies between them. Off: only calls to one store that follow each other.', change: act.merge }),
      sw('Squeeze', { on: squeezeOn, qa: 'squeeze', tip: 'When the diagram is wider than the window, fold the lifelines the current step does not need. Click a fold to open it.', change: act.squeeze }),
      sw('Transport hints', { on: opts.th, qa: 'transport-hints', tip: 'Show the words "transport not decided" on arrows. Off: a small icon (the words are in its tooltip and in the caption).', change: act.hints }),
      head('Detail'),
      h('div.vm-row', h('span.vm-t', 'Depth'), depth),
      h('div.vm-sd', h('span.vm-t', 'Step details'), stepMenu.el),
      h('div.vm-row', h('span.vm-t', 'Text size'), size.el),
      sw('Hide text', { on: c.hideText, qa: 'hide-text', note: 'The step description in the caption', change: (v) => setCap('hideText', v) }),
      h('p.vm-tip', icon('info'), 'Double-click a bar, or right-click it, to look inside.'),
      h('div.vm-foot', { hidden: !n }, h('span.vm-n', String(n)), `${n === 1 ? 'option differs' : 'options differ'} from the default`)].filter(Boolean));
    pop.scrollTop = top;
  }
  const away = (e) => { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); };
  const key = (e) => { if (e.key === 'Escape' && pop) { e.stopPropagation(); close(); btn.focus(); } };
  const place = () => {
    if (!pop) return;
    const p = popPlace({ rect: btn.getBoundingClientRect(), vw: innerWidth, vh: innerHeight, max: 340, gap: 6 });
    Object.assign(pop.style, { top: `${p.top}px`, right: `${p.right}px`, width: `${p.width}px`, maxHeight: `${p.maxHeight}px` });
  };
  function open() {
    pop = h('div.vm-pop', { role: 'dialog', 'aria-label': 'View options', 'data-qa': 'view-pop' });
    draw(); document.body.append(pop); place();
    btn.setAttribute('aria-expanded', 'true');
    offCaps = onCaps(() => paint());
    setTimeout(() => { addEventListener('pointerdown', away, true); addEventListener('keydown', key, true); addEventListener('resize', place); });
    pop.querySelector('input, select, button')?.focus({ preventScroll: true });
  }
  function close() {
    if (!pop) return;
    pop.remove(); pop = null; size?.dispose(); size = null; offCaps?.(); offCaps = null; btn.setAttribute('aria-expanded', 'false');
    removeEventListener('pointerdown', away, true); removeEventListener('keydown', key, true); removeEventListener('resize', place);
  }
  function reset() { setCap('caption', true); setCap('legend', true); setCap('hideText', false); setTextSize(SIZE_DEFAULT); stepMenu.reset(); act.reset(); } // the diagram options and the depth: flows.js
  paint();
  return { el, paint, close };
}
