// Minimized flow header (Unreleased, #106) and the pinned heads (#107), the pure part: the H key, the stored state, the strip's step text and when a head stops being sticky.

const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;
const typing = (t) => !!t && (FIELD.test(t.tagName) || !!t.isContentEditable);

export const HEADMIN_KEY = 'flow-mapper.headMin';
const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** The stored choice: '1' = minimized. Anything else, or storage that throws, is "not minimized". `st` for tests. */
export function loadHeadMin(st = store()) { try { return st?.getItem(HEADMIN_KEY) === '1'; } catch { return false; } }
export function saveHeadMin(on, st = store()) { try { st?.setItem(HEADMIN_KEY, on ? '1' : '0'); } catch { /* private window: the choice lasts until reload */ } }

/** A keydown -> 'toggle' (H) | null. Nothing while the caret is in a field or editor, a dialog is open, a modifier is held, or the key was already handled (same guards as F). */
export function headKeyAction(e, { dialogOpen = false } = {}) {
  if (dialogOpen || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || typing(e.target)) return null;
  return e.key === 'h' || e.key === 'H' ? 'toggle' : null;
}

/** The strip's compact step nav: "2/44" (before the first step: "–/44"). */
export const stepShort = (n, total) => `${n >= 1 ? n : '–'}/${total}`;
export const stepWords = (n, total) => (n >= 1 ? `Step ${n} of ${total}` : `${total} steps, none chosen`);

/** The pinned component heads scroll away with the diagram only for a genuinely huge zoomed head: zoomed in (factor > 1) and taller than 60% of the scroller.
 *  At normal zoom they always stay pinned, however short the scroller is (a tall header above it used to push every head past the old 35% line). */
export const LOOSE_SHARE = 0.6;
export const looseHead = ({ headH, viewH, zoom = 1 }) => zoom > 1 && headH > viewH * LOOSE_SHARE;
