// Zoom of the flow diagram (0.30.3, #69), the pure part: the range, the URL form, Fit, the pointer-anchored scroll and the wheel step. No DOM.
// A tab's zoom is a percent (25..400) or 'fit' (recomputed whenever the diagram or the window changes). `zoom=` in the URL; 100 is left out.

export const ZMIN = 25, ZMAX = 400;

/** Clamp a percent to 25..400, whole numbers; anything that is not a number reads as 100. */
export const clampZoom = (p) => (Number.isFinite(Number(p)) ? Math.min(ZMAX, Math.max(ZMIN, Math.round(Number(p)))) : 100);

/** `zoom=` -> 'fit' | percent | null (absent or unreadable: the default). */
export function decodeZoom(query) {
  const v = (query.get('zoom') ?? '').trim().toLowerCase();
  if (v === 'fit') return 'fit';
  return /^\d{1,4}$/.test(v) ? clampZoom(v) : null;
}
/** The `zoom=` value of a tab's zoom: 100 (and nothing) is left out. */
export const encodeZoom = (z) => (z === 'fit' ? 'fit' : z == null || clampZoom(z) === 100 ? null : String(clampZoom(z)));

/** What the viewer typed in the % box: "150", "150%", " 80 %" -> a clamped percent; anything else -> null (the box goes back to the current zoom). */
export function parseTyped(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(String(text ?? ''));
  return m ? clampZoom(m[1]) : null;
}

/** The scale (1 = 100%) that Fit gives: the diagram's width to the viewport; a short diagram (no taller than the viewport at 100%) is fitted whole, so the smaller of the width, height and 100% scales.
 *  { w, h }: the diagram at 100% (head included), { vw, vh }: the room. Clamped to the zoom range; null while there is no size. */
export function fitScale({ w, h, vw, vh }) {
  if (!(w > 0) || !(h > 0) || !(vw > 0)) return null;
  const zw = vw / w, zh = vh > 0 ? vh / h : Infinity, z = h <= vh ? Math.min(zw, zh, 1) : zw; // a short diagram is never blown up past 100% (QA, 0.30.4)
  return Math.min(ZMAX, Math.max(ZMIN, z * 100)) / 100;
}

/** The scale of a zoom value, given the Fit scale (null while the diagram has no width). */
export const scaleOf = (z, fit = null) => (z === 'fit' ? fit ?? 1 : clampZoom(z) / 100);

/** The percent shown for a scale. */
export const percentOf = (scale) => Math.round(scale * 100);

/** The next percent for the - and + buttons: steps of 25 from 100 up, of 10 below; always moves, never leaves the range. */
export function stepZoom(pct, dir) {
  const p = Math.round(pct), up = dir > 0, st = (up ? p >= 100 : p > 100) ? 25 : 10;
  return clampZoom(up ? (Math.floor(p / st) + 1) * st : (Math.ceil(p / st) - 1) * st);
}

/** Keep a range (no rounding: a wheel zooms in small steps). */
export const clampRange = (p) => Math.min(ZMAX, Math.max(ZMIN, Number(p)));

/** Zoom around a point: how far to scroll on one axis so the content point under the pointer stays under it.
 *  { origin0, origin1 (where the diagram's edge was on screen before and after the new size), at (the pointer), from, to (the scales) } -> the scroll delta. */
export const anchorDelta = ({ origin0, origin1, at, from, to }) => origin1 + ((at - origin0) / from) * to - at;

/** Ctrl/Cmd + wheel and pinch (a ctrl wheel on a trackpad): the factor for one event, so a notch of a mouse wheel and a stream of small pinch deltas both feel even. */
export function wheelFactor(deltaY, deltaMode = 0) {
  const d = Math.max(-60, Math.min(60, deltaMode === 1 ? deltaY * 16 : deltaY));
  return Math.exp(-d * 0.004);
}
