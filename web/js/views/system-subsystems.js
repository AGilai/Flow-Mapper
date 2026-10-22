// The system map at subsystem level (0.28.1, frame 3): one box per subsystem, the calls between them rolled up into a line per direction and transport,
// and the abstract links drawn at this level. Click (or Tab and Enter) a box, a line or a link for its panel; a component name goes down to the component level.
// `level=subsystems` in the URL; the selection is in it too (`box=`, `line=`, `link=`) so a refine keeps its panel open.

import { h, fill } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { go, setQuery } from '../router.js';
import { pageHead } from '../components/page.js';
import { createPanel } from '../components/panel.js';
import { editing } from '../design/edit-target.js';
import { openLinkPanel } from '../design/link-panel.js';
import { openLinkForm } from '../design/forms/link-form.js';
import { pencils } from '../design/pencil.js';
import { layoutBoxes, gridFor, MANY } from '../graph/subsystem-layout.js';
import { drawSubsystems } from './subsystem-draw.js';
import { linePanel } from './subsystem-panel.js';
import { createPane } from '../pane/pane.js';
import { parseSel } from '../pane/pane-pure.js';
import { openList } from './subsystem-open.js';
import { levelControl, subsystemBar } from './system-toolbar.js';
import { href } from '../router.js';
import { subsystemLegend } from './system-legend.js';

export async function renderSubsystems({ main, query, subs, marks }) {
  const map = await api.subsystemMap(state.env), edit = editing();
  const opts = { rolled: query.get('lines') !== '0', abstract: query.get('abs') !== '0', all: query.get('all') === '1' };
  if (!map.boxes.some((b) => b.key && b.components.length)) { // nothing is assigned: a "Not set" box with every component would say nothing
    main.append(pageHead('System map', 'No subsystems in use', levelControl('subsystems', subs)),
      h('div.content', h('p.muted.ss-none', { 'data-qa': 'ss-empty' }, 'No component is assigned to a subsystem yet. Assign components in Inventory or with a plan; ', h('a', { href: href(`/envs/${encodeURIComponent(state.env)}/settings`) }, 'Subsystem settings'), '.')));
    return { dispose: () => {} };
  }
  const many = map.boxes.length > MANY; // a merged line per pair of boxes, shown for the box in focus
  let hoverKey = null, draw = null;
  const label = (k) => subs.labelOf(k) || 'Not set';
  const want = parseSel(query.get('sel')), wantBox = want?.kind === 'subsystem' ? want.key : query.get('box'); // `sel=grp:<key>` (0.33.0); `box=` still opens it
  let selected = query.get('link') ? `link:${query.get('link')}` : query.get('line') ?? (wantBox != null ? `box:${wantBox}` : null);

  const stage = h('div.ss-stage', { 'data-qa': 'ss-stage' }), under = h('div.ss-under');
  const content = h('div.content.flush', h('div.stage-wrap.ss-wrap', stage, under, subsystemLegend()));
  const panel = createPanel(content, { onClose: () => { selected = null; setQuery({ box: null, line: null, link: null, sel: null }); paint(); } });
  const pick = (sel, q) => { selected = sel; setQuery({ box: null, line: null, link: null, sel: null, ...q }); paint(); };
  const openLink = (v) => { pick(`link:${v.id}`, { link: v.id }); openLinkPanel(v, { panel, subs, marks, map, editing: edit }); };
  const openLine = (l) => { pick(l.id, { line: l.id }); panel.open(...linePanel(l, { map, label, onLink: openLink })); };
  const pen = pencils({ panel, flowsEl: null });
  // The info pane (0.33.0): a box opens it, `sel=grp:<key>`; a component row inside it swaps to that component.
  const pane = createPane(panel, { pen, ctx: () => ({ map, onLine: openLine, onLink: openLink }), onSelect: (sel, t) => { selected = t.kind === 'subsystem' ? `box:${t.key}` : null; setQuery({ box: null, line: null, link: null, sel }); paint(); } });
  const openBox = (key) => pane.show({ kind: 'subsystem', key });
  const goDown = (service) => go('/system', { sel: `svc:${service}` });

  const boxSel = () => (selected?.startsWith('box:') ? selected.slice(4) : null), lineSel = () => (selected && !selected.startsWith('box:') && !selected.startsWith('link:') ? selected : null);
  function paint() {
    const { cols, scale } = gridFor(stage.clientWidth || 900, map.boxes.length), L = layoutBoxes(map.boxes, { cols });
    const tf = Math.max(1, 10 / (10.5 * scale)); // the drawing shrinks to fit the width, its text does not (10px at least)
    draw = drawSubsystems({ L, map, marks, opts, selected, scale, tf, many, onBox: openBox, onLine: openLine, onLink: openLink, onGo: goDown, onHover: (k) => { hoverKey = k; draw.focus(k ?? boxSel(), lineSel(), opts.all); } });
    const { el } = draw;
    draw.focus(boxSel(), lineSel(), opts.all);
    fill(stage, map.boxes.length ? el : h('p.muted.ss-none', 'This environment has no subsystems yet. Give components a subsystem, or add one in Subsystem settings.'));
    fill(under, openList(map, { label, onLink: openLink, selected: selected?.startsWith('link:') ? selected.slice(5) : null }));
  }

  main.append(pageHead('System map', `${map.boxes.length} subsystems, ${map.lines.length} rolled-up ${map.lines.length === 1 ? 'line' : 'lines'}, ${map.abstract.length} abstract ${map.abstract.length === 1 ? 'link' : 'links'}`, levelControl('subsystems', subs)),
    subsystemBar({ opts, editing: edit, many, onToggle: () => { setQuery({ lines: opts.rolled ? null : '0', abs: opts.abstract ? null : '0', all: opts.all ? '1' : null }); paint(); }, onAddLink: () => openLinkForm({ panel, subs }) }), content);

  let lastCols = '';
  const ro = new ResizeObserver(() => { const g = gridFor(stage.clientWidth || 900, map.boxes.length), c = `${g.cols}|${Math.round(g.scale * 20)}`; if (c !== lastCols) { lastCols = c; paint(); } });
  ro.observe(stage);
  paint();
  // Reopen the panel of the selection the URL names (a refine, a reload, a link).
  if (selected?.startsWith('link:')) { const v = map.abstract.find((x) => x.id === selected.slice(5)); if (v) openLinkPanel(v, { panel, subs, marks, map, editing: edit }); }
  else if (selected?.startsWith('box:')) { if (map.boxes.some((x) => x.key === selected.slice(4))) pane.restore(new URLSearchParams({ sel: `grp:${selected.slice(4)}`, ...(query.get('expanded') ? { expanded: query.get('expanded') } : {}) })); }
  else if (selected) { const l = map.lines.find((x) => x.id === selected); if (l) panel.open(...linePanel(l, { map, label, onLink: openLink })); }
  else if (want?.kind === 'component') pane.restore(query);
  pen.resume();
  return { dispose: () => { ro.disconnect(); pane.dispose(); panel.dispose(); } };
}
