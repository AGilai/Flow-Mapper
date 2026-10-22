// The info pane's rules with no DOM (0.33.0, docs/plans/info-pane.md): width, sheet snaps, the `sel=` / `expanded=` URL values, the jump bar, and when a
// click on empty space closes the pane.

export const WIDTH = { def: 420, min: 340, max: 640 };
export const SHEET_AT = 760; // at or below this viewport width the drawer is a bottom sheet
export const SNAPS = ['peek', 'half', 'full'];
const SNAP_VH = { peek: 0.2, half: 0.55, full: 0.92 };

/** The drawer width in px: clamped to 340..640 and never more than 60% of the viewport (the page keeps room to be read). */
export const clampWidth = (px, vw = 1440) => {
  const n = Number(px);
  return Math.round(Math.min(Math.max(WIDTH.min, Math.min(WIDTH.max, Math.floor(vw * 0.6))), Math.max(WIDTH.min, Number.isFinite(n) ? n : WIDTH.def)));
};

export const isSheet = (vw) => vw <= SHEET_AT;

/** The sheet's height in px for a snap. */
export const sheetHeight = (snap, vh) => Math.round(vh * (SNAP_VH[snap] ?? SNAP_VH.half));

/** The snap a drag ends on: the nearest of the three to the dragged height. */
export function nearestSnap(heightPx, vh) {
  let best = 'half', d = Infinity;
  for (const s of SNAPS) { const x = Math.abs(sheetHeight(s, vh) - heightPx); if (x < d) { d = x; best = s; } }
  return best;
}

/** The next snap up (+1) or down (-1) from `snap`, staying inside the three. */
export const stepSnap = (snap, dir) => SNAPS[Math.min(SNAPS.length - 1, Math.max(0, SNAPS.indexOf(snap) + dir))];

/** `sel=` values: `svc:<name>` is a component, `grp:<key>` a subsystem (the key may be empty: "Not set"). Anything else is no selection. */
export function parseSel(v) {
  if (typeof v !== 'string') return null;
  if (v.startsWith('svc:') && v.length > 4) return { kind: 'component', name: v.slice(4) };
  if (v.startsWith('grp:')) return { kind: 'subsystem', key: v.slice(4) };
  return null;
}
export const selOf = (kind, id) => (kind === 'subsystem' ? `grp:${id}` : `svc:${id}`);

/** The jump bar of a kind of pane (frame 19a / 19b): id and label of each section it scrolls to. A subsystem lists its components and links on their own. */
export const JUMPS = {
  component: [{ id: 'overview', label: 'Overview' }, { id: 'about', label: 'About' }, { id: 'flows', label: 'Flows' }, { id: 'connections', label: 'Connections' }],
  subsystem: [{ id: 'overview', label: 'Overview' }, { id: 'about', label: 'About' }, { id: 'components', label: 'Components' }, { id: 'links', label: 'Links' }, { id: 'flows', label: 'Flows' }],
};

/** Does a click on the page close the pane? Only on empty space (not on an item that opens a pane, not inside the pane) and not while pinned. */
export const closesOnClick = ({ pinned, onItem, insidePane }) => !pinned && !onItem && !insidePane;

/** The section the jump bar marks as current: the last one whose top is at or above `line` (offsets of the section tops, in order). */
export function currentJump(tops, line) {
  let cur = 0;
  tops.forEach((t, i) => { if (t != null && t <= line) cur = i; });
  return cur;
}

/** The header's open-question text: "2 open questions", "1 open question", or '' for none. */
export const questionsText = (n) => (n ? `${n} open question${n === 1 ? '' : 's'}` : '');

// ---- the expanded page (0.33.0, frame 19h): accordion rows ----
/** Rows open the first time (Overview, About, Open questions, Endpoints); the rest start closed, their counts show in the row header. */
export const OPEN_DEFAULT = ['overview', 'about', 'q', 'endpoints'];

/** The set of open row ids from what was stored (a JSON array), else the defaults. Anything that is not an array of strings is ignored. */
export function parseOpen(raw) {
  try { const a = JSON.parse(raw); if (Array.isArray(a) && a.every((x) => typeof x === 'string')) return new Set(a); } catch { /* not stored yet */ }
  return new Set(OPEN_DEFAULT);
}

/** `[` / `]`: the row id before or after `current` in `ids` (the ends stay); no current row gives the first. */
export function siblingRow(ids, current, dir) {
  const i = ids.indexOf(current);
  return i < 0 ? ids[0] ?? null : ids[Math.min(ids.length - 1, Math.max(0, i + dir))] ?? null;
}

/** The outline ("On this page") entries of rows: [{ id, title, count, depth, q }], children one level deeper. */
export const outlineOf = (rows) => rows.flatMap((r) => [{ id: r.id, title: r.title, count: r.count ?? null, depth: 0, q: !!r.q }, ...(r.children ?? []).map((c) => ({ id: c.id, title: c.title, count: c.count ?? null, depth: 1, q: !!c.q }))]);

/** The outline column shows from 1280 px; below 1100 px the page is one column (frame 19h). */
export const showOutline = (vw) => vw >= 1280;

/** The URL value of the expanded page: `expanded=1`, or absent. */
export const expandedParam = (on) => (on ? '1' : null);
