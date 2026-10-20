// Collapsible side panels (the main navigation and the Flows entry-point list). Pure state helpers: no DOM, so tests can import them.
// Each panel remembers its own state per browser in localStorage; storage that throws or is missing means "expanded".

export const KEYS = { rail: 'collapse:rail', list: 'collapse:flows-list' };
export const SLIDE_MS = 180;

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** true when the panel was left collapsed. `storage` is injectable for tests. */
export function readCollapsed(key, storage = store()) {
  try { return storage?.getItem(`fm:${key}`) === '1'; } catch { return false; }
}

/** Remember the state; returns it. A storage that cannot be written is ignored. */
export function writeCollapsed(key, collapsed, storage = store()) {
  try { storage?.setItem(`fm:${key}`, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  return !!collapsed;
}

/** The label a control announces: what a click will do. */
export const toggleLabel = (what, collapsed) => `${collapsed ? 'Expand' : 'Collapse'} ${what}`;

/** The text written vertically on the collapsed entry-point list: the service in view, else the plain title with its count. */
export function stripLabel({ service = null, active = null, count = 0 } = {}) {
  const s = service ?? (active ? String(active).replace(/^(?:fn:|full:)/, '').split('/')[0] : null);
  return s || (count ? `Entry points (${count})` : 'Entry points');
}

/** The compact environment indicator of the collapsed rail: up to three characters. */
export const envShort = (env) => String(env ?? '').slice(0, 5) || '·';
