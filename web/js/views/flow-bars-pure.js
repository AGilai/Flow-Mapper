// The pinned component heads (#107) and the View popover's place, the pure part (frame 28). No DOM.

/** The pinned component heads scroll away with the diagram only for a genuinely huge zoomed head: zoomed in (factor > 1) and so tall that less than 80px of diagram would be left under it.
 *  At normal zoom they always stay pinned, however short the scroller is (a tall header above it used to push every head past the old 35% line). */
export const LOOSE_ROOM = 80;
export const looseHead = ({ headH, viewH, zoom = 1 }) => zoom > 1 && viewH - headH < LOOSE_ROOM;

/** Where a popover goes: under its button, right edges level, at most `max` px wide, always inside the window (8px margin). */
export function popPlace({ rect, vw, vh, max = 560, gap = 4, margin = 8 }) {
  const width = Math.min(max, vw - 2 * margin), top = Math.round(rect.bottom + gap);
  const right = Math.max(margin, Math.min(vw - width - margin, Math.round(vw - rect.right)));
  return { top, right, width, maxHeight: Math.max(120, vh - top - margin) };
}
