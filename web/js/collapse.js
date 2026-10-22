// Collapsible side panels (the main navigation and the Flows entry-point list). Pure state helpers: no DOM, so tests can import them.
// Each panel remembers its own state per browser in localStorage; storage that throws or is missing means "expanded".

export const KEYS = { rail: 'collapse:rail', list: 'collapse:flows-list' };
export const SLIDE_MS = 180;

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** true when the panel was left collapsed; a saved choice ('1' / '0') always wins, else `fallback`. `storage` is injectable for tests. */
export function readCollapsed(key, storage = store(), fallback = false) {
  try { const v = storage?.getItem(`fm:${key}`); return v === '1' ? true : v === '0' ? false : !!fallback; } catch { return !!fallback; }
}

/** The width under which the layout is a stacked one (layout.css); a panel with no saved choice starts collapsed there. */
export const NARROW_PX = 860;
export const isNarrow = (w = globalThis.innerWidth) => typeof w === 'number' && w > 0 && w < NARROW_PX;

/** Remember the state; returns it. A storage that cannot be written is ignored. */
export function writeCollapsed(key, collapsed, storage = store()) {
  try { storage?.setItem(`fm:${key}`, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  return !!collapsed;
}

/** The label a control announces: what a click will do. */
export const toggleLabel = (what, collapsed) => `${collapsed ? 'Expand' : 'Collapse'} ${what}`;

/** The text written vertically on the collapsed entry-point list: the service in view, else the plain title with its count, then the filters applied. */
export function stripLabel({ service = null, active = null, count = 0, summary = '' } = {}) {
  const s = service ?? (active ? String(active).replace(/^[^|/@~!:]+\|/, '').replace(/^(?:fn:|full:)/, '').split('/')[0] : null), base = s || (count ? `Entry points (${count})` : 'Entry points');
  return summary ? `${base} · ${summary}` : base; // the filters applied (flow-list-filter.js filterSummary), when any
}

/** The compact environment indicator of the collapsed rail: up to three characters. */
export const envShort = (env) => String(env ?? '').slice(0, 5) || '·';
