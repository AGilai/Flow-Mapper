// The pure parts of the flow About region (0.46.0, #95; the Info banner of 0.45.0, #91) and the step panel: the related chip, the header controls, the open / closed rule with its first-visit exception, the shared
// text size, "Hide text" and the related-flow rows. Every storage access is wrapped in try/catch; without storage the defaults apply. `st` is a Storage-like
// ({getItem, setItem}); it defaults to localStorage and is injectable for tests.

export const SIZES = [12, 13, 15, 17, 19]; // px: 0..4; the default is 1 (13px)
export const SIZE_DEFAULT = 1;
export const REL_SHOW = 6;                  // related rows shown before "Show N more"
const PREFIX = 'flow-mapper.', SEEN_MAX = 500;

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
export const readKey = (k, st = store()) => { try { return st ? st.getItem(PREFIX + k) : null; } catch { return null; } };
export const writeKey = (k, v, st = store()) => { try { st?.setItem(PREFIX + k, v); } catch { /* storage unavailable */ } };

/** The "N related" chip of the About region header; null at 0 (no chip). */
export const chipText = (related) => { const n = Number(related) || 0; return n > 0 ? `${n} related` : null; };

/**
 * Which controls the About region header carries (0.46.0, #95). Collapsed: none. Open: Edit and the "..." menu always; Show all (only when the text is cut, or
 * already expanded) and A- / A+ only when there is a description.
 */
export function aboutControls({ open, hasText, clipped = false, expanded = false }) {
  if (!open) return { showAll: false, size: false, edit: false, menu: false };
  return { showAll: hasText && (clipped || expanded), size: hasText, edit: true, menu: true };
}

// ---- the About region: open or closed ----
export const infoChoice = (st) => { const v = readKey('flowinfo', st); return v === '1' ? true : v === '0' ? false : null; }; // null: the viewer never chose
export const infoSave = (open, st) => writeKey('flowinfo', open ? '1' : '0', st);
export function seenSet(st) {
  try { const a = JSON.parse(readKey('flowinfo-seen', st) ?? '[]'); return new Set(Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []); } catch { return new Set(); }
}
/**
 * Is the banner open when a flow's page first knows it has a description? The saved choice rules; with none yet, a flow the viewer has not opened before opens
 * once (and is remembered as seen, without saving a choice). -> { open, auto }.
 */
export function infoInitial(key, hasDesc, st) {
  const c = infoChoice(st);
  if (c !== null) return { open: c, auto: false };
  if (!hasDesc) return { open: false, auto: false };
  const seen = seenSet(st);
  if (seen.has(key)) return { open: false, auto: false };
  seen.add(key); writeKey('flowinfo-seen', JSON.stringify([...seen].slice(-SEEN_MAX)), st);
  return { open: true, auto: true };
}

// ---- the shared text size ----
export const clampSize = (n) => (Number.isFinite(n) ? Math.min(SIZES.length - 1, Math.max(0, Math.round(n))) : SIZE_DEFAULT);
export const sizeStored = (st) => { const v = readKey('textSize', st); return v === null ? SIZE_DEFAULT : clampSize(Number(v)); };
export const sizeSave = (n, st) => writeKey('textSize', String(clampSize(n)), st);
/** The next size for a click on A− (-1) or A+ (+1); the ends stay. */
export const stepSize = (n, d) => clampSize(n + d);
export const sizeLabel = (n) => `${SIZES[clampSize(n)]}px`;

// ---- Hide text (the step panel) ----
export const textHidden = (st) => readKey('stepText', st) === '0'; // stored value: '1' = shown (default), '0' = hidden
export const textHiddenSave = (hidden, st) => writeKey('stepText', hidden ? '0' : '1', st);

// ---- related rows ----
/** Which relations show: the first REL_SHOW, or all once `all`; `more` is the number left out. */
export const relSlice = (items, all) => ({ shown: all ? items : items.slice(0, REL_SHOW), more: all ? 0 : Math.max(0, items.length - REL_SHOW) });
/** A set with `id` toggled (a new Set: the rows whose note is expanded). */
export const toggled = (set, id) => { const s = new Set(set); if (!s.delete(id)) s.add(id); return s; };
