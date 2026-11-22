// The width and collapsed state of the design doc's index (outline) on the full page. Pure: the browser keeps the stored JSON per viewer.

export const IX_MIN = 140;
export const IX_MAX = 480;
export const IX_DEFAULT = 200;

export interface IndexState { w: number; collapsed: boolean | null } // collapsed null = never chosen: the window width decides

export function clampIndexWidth(px: unknown): number {
  const n = Number(px);
  if (!Number.isFinite(n)) return IX_DEFAULT;
  return Math.min(IX_MAX, Math.max(IX_MIN, Math.round(n)));
}

/** Read the stored JSON; anything unusable gives the defaults. */
export function parseIndexState(raw: string | null | undefined): IndexState {
  try {
    const o = JSON.parse(raw ?? '');
    return { w: clampIndexWidth(o?.w ?? IX_DEFAULT), collapsed: typeof o?.collapsed === 'boolean' ? o.collapsed : null };
  } catch { return { w: IX_DEFAULT, collapsed: null }; }
}

/** Collapsed unless chosen otherwise; a window under 1100px starts collapsed. */
export const indexCollapsed = (s: IndexState, viewport: number): boolean => s.collapsed ?? viewport < 1100;
