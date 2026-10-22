// Maximize a flow (0.29.1), the pure part: which key does what, and the URL state. No DOM reads except the event's own target.

const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;
const typing = (t) => !!t && (FIELD.test(t.tagName) || !!t.isContentEditable);

/** A keydown -> 'toggle' (F) | 'exit' (Esc while maximized) | null. Nothing while the caret is in a field or editor, a dialog is open,
 *  a modifier is held, or something already handled the key (an editor's or menu's own Esc). */
export function maxKeyAction(e, { maximized = false, dialogOpen = false } = {}) {
  if (dialogOpen || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return null;
  if (e.key === 'Escape') return maximized ? 'exit' : null;
  if ((e.key === 'f' || e.key === 'F') && !e.shiftKey) return 'toggle';
  return null;
}

/** `max=1` in the URL means maximized. */
export const maxFromQuery = (query) => query.get('max') === '1';
/** The setQuery patch for a state. */
export const maxPatch = (on) => ({ max: on ? '1' : null });
