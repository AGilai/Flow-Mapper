// The small pure rules of a flow's bottom pane (0.34.0, frame 20): which tab is active, the labels, and the splitter's height maths.
// No DOM here, so a node test can load it.

export const TABS = ['notes', 'comments', 'actions'];
export const TAB_NAMES = { notes: 'Notes', comments: 'Comments', actions: 'Action items' };
export const MIN_DIAGRAM = 120; // the diagram keeps at least this much while the border is dragged up

/** `pane=notes|comments|actions` of a flow URL (URLSearchParams), else null. */
export function paneParam(query) {
  const v = query?.get?.('pane');
  return TABS.includes(v) ? v : null;
}

/**
 * The tab a pane opens on: the URL (`pane=`; a `comment=` link means Comments), then the viewer's last choice, then Notes when the flow has notes, else Comments.
 * Only the tabs the pane has are possible.
 */
export function initialTab({ param = null, comment = false, remembered = null, hasNotes = false, available = TABS }) {
  const ok = (t) => (t && available.includes(t) ? t : null);
  return ok(param) ?? (comment ? ok('comments') : null) ?? ok(remembered) ?? (hasNotes ? ok('notes') : null) ?? ok('comments') ?? available[0];
}

/** The tab after `dir` (-1, 1) in the visible tabs; it wraps. */
export const stepTab = (tabs, cur, dir) => tabs[(tabs.indexOf(cur) + dir + tabs.length) % tabs.length];

/** The text after a tab's name: Comments "(6)", Action items "(3 open · 5)", compact under 680 px "3·5". Empty for nothing. */
export const countText = (id, { n = 0, open = 0, all = 0 } = {}, compact = false) => {
  if (id === 'comments') return n ? `(${n})` : '';
  if (id === 'actions') return all ? (compact ? `${open}·${all}` : `(${open} open · ${all})`) : '';
  return '';
};

/** The label of the primary button of the tab row. */
export const primaryLabel = (tab, compact = false) => (tab === 'notes' ? '✎ Edit' : compact ? '+ Add' : tab === 'actions' ? '+ Add action item' : '+ Add comment');

/** The pane's height for a drag: `start` + how far the pointer moved up; clamped to [min, max]. `collapsed` is true at (or within 8 px of) the minimum. */
export function dragHeight({ start, dy, min, max }) {
  const top = Math.max(min, max), h = Math.min(top, Math.max(min, Math.round(start - dy)));
  return { h, collapsed: h <= min + 8 };
}

/** The largest pane: what is left of the tab after everything but the diagram and the pane, minus the diagram's own minimum. */
export const maxPane = ({ tab, others, diagram = MIN_DIAGRAM }) => Math.max(0, tab - others - diagram);

/** A saved height read back: a whole number of px in a sane range, else null. */
export const heightOf = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 60 && n <= 5000 ? Math.round(n) : null; };
