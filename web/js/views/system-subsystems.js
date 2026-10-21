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
import { layoutBoxes, gridFor } from '../graph/subsystem-layout.js';
import { drawSubsystems } from './subsystem-draw.js';
import { linePanel, boxPanel } from './subsystem-panel.js';
import { openList } from './subsystem-open.js';
import { levelControl, subsystemBar } from './system-toolbar.js';
import { subsystemLegend } from './system-legend.js';

export async function renderSubsystems({ main, query, subs, marks }) {
  const map = await api.subsystemMap(state.env), edit = editing();
  const opts = { rolled: query.get('lines') !== '0', abstract: query.get('abs') !== '0' };
  const label = (k) => subs.labelOf(k) || 'Not set';
  let selected = query.get('link') ? `link:${query.get('link')}` : query.get('line') ?? (query.get('box') != null ? `box:${query.get('box')}` : null);

  const stage = h('div.ss-stage', { 'data-qa': 'ss-stage' }), under = h('div.ss-under');
  const content = h('div.content.flush', h('div.stage-wrap.ss-wrap', stage, under, subsystemLegend()));
  const panel = createPanel(content, { onClose: () => { selected = null; setQuery({ box: null, line: null, link: null }); paint(); } });
  const pick = (sel, q) => { selected = sel; setQuery({ box: null, line: null, link: null, ...q }); paint(); };
  const openLink = (v) => { pick(`link:${v.id}`, { link: v.id }); openLinkPanel(v, { panel, subs, marks, map, editing: edit }); };
  const openLine = (l) => { pick(l.id, { line: l.id }); panel.open(...linePanel(l, { map, label, onLink: openLink })); };
  const openBox = (key) => { pick(`box:${key}`, { box: key }); panel.open(...boxPanel(map.boxes.find((b) => b.key === key), { map, marks, label, onGo: goDown, onLink: openLink })); };
  const goDown = (service) => go('/system', { sel: `svc:${service}` });

  function paint() {
    const { cols, scale } = gridFor(stage.clientWidth || 900, map.boxes.length), L = layoutBoxes(map.boxes, { cols });
    const { el } = drawSubsystems({ L, map, marks, opts, selected, scale, onBox: openBox, onLine: openLine, onLink: openLink, onGo: goDown });
    fill(stage, map.boxes.length ? el : h('p.muted.ss-none', 'This environment has no subsystems yet. Give components a subsystem, or add one in Subsystem settings.'));
    fill(under, openList(map, { label, onLink: openLink, selected: selected?.startsWith('link:') ? selected.slice(5) : null }));
  }

  main.append(pageHead('System map', `${map.boxes.length} subsystems, ${map.lines.length} rolled-up ${map.lines.length === 1 ? 'line' : 'lines'}, ${map.abstract.length} abstract ${map.abstract.length === 1 ? 'link' : 'links'}`, levelControl('subsystems', subs)),
    subsystemBar({ opts, editing: edit, onToggle: () => { setQuery({ lines: opts.rolled ? null : '0', abs: opts.abstract ? null : '0' }); paint(); }, onAddLink: () => openLinkForm({ panel, subs }) }), content);

  let lastCols = '';
  const ro = new ResizeObserver(() => { const g = gridFor(stage.clientWidth || 900, map.boxes.length), c = `${g.cols}|${Math.round(g.scale * 20)}`; if (c !== lastCols) { lastCols = c; paint(); } });
  ro.observe(stage);
  paint();
  // Reopen the panel of the selection the URL names (a refine, a reload, a link).
  if (selected?.startsWith('link:')) { const v = map.abstract.find((x) => x.id === selected.slice(5)); if (v) openLinkPanel(v, { panel, subs, marks, map, editing: edit }); }
  else if (selected?.startsWith('box:')) { const b = map.boxes.find((x) => x.key === selected.slice(4)); if (b) panel.open(...boxPanel(b, { map, marks, label, onGo: goDown, onLink: openLink })); }
  else if (selected) { const l = map.lines.find((x) => x.id === selected); if (l) panel.open(...linePanel(l, { map, label, onLink: openLink })); }
  return { dispose: () => { ro.disconnect(); panel.dispose(); } };
}
