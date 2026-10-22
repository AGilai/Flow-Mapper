// Step details (0.30.0), the pure part: which of a step's Title / API / Description show on the step bar (`sb=`) and on the arrows (`sd=`),
// the URL form, the button label, and what one step shows on its arrow. Letters t, a, d; always in that order. No DOM.

export const BAR_DEFAULT = 'tad', ARROWS_DEFAULT = 'a', MAX_TITLE = 80;
const NAMES = { t: 'Title', a: 'API', d: 'Description' };

/** The letters of `v` that are fields, in the order t, a, d, once each. */
export const canon = (v) => [...'tad'].filter((c) => String(v ?? '').includes(c)).join('');

/** `sb=` of a query: absent = null (use the remembered one), `-` = nothing in the bar but the stepper, else the letters (none valid: all three). */
export function decodeBar(query) {
  const v = query.get('sb');
  if (v == null) return null;
  return v === '-' ? '' : canon(v) || BAR_DEFAULT;
}
/** `sd=` of a query: the letters, at least one (none valid: API only); null when the param is absent. */
export function decodeArrows(query) {
  const v = query.get('sd');
  return v == null ? null : canon(v) || ARROWS_DEFAULT;
}
/** URL values: null at the default. */
export const encodeBar = (set) => (set === BAR_DEFAULT ? null : set === '' ? '-' : set);
export const encodeArrows = (set) => (set === ARROWS_DEFAULT ? null : set);

const words = (set) => (set === 'tad' ? '3' : [...set].map((c) => NAMES[c]).join(' + '));
/** The toolbar button text: "Step details: bar 3 · arrows API". */
export const summary = (bar, arrows) => `Step details: bar ${bar === '' ? 'stepper only' : words(bar)} · arrows ${words(arrows)}`;

/** Toggle one letter of a set; `min` 1 keeps at least one (the arrows), the bar may be empty. */
export function toggle(set, letter, min = 0) {
  const next = set.includes(letter) ? set.replace(letter, '') : canon(set + letter);
  return next.length < min ? set : next;
}

export const PRESETS = [
  { id: 'api', label: 'API only (as before)', bar: 'tad', arrows: 'a' },
  { id: 'all', label: 'Everything, bar and arrows', bar: 'tad', arrows: 'tad' },
  { id: 'ta', label: 'Title and API on the arrows', bar: 'tad', arrows: 'ta' },
];

/** What one step shows on its arrow. `set`: the arrow letters; `has`: { title, desc } of the step. Fields the step lacks drop out; nothing left: its API line.
 *  -> { api, title, desc, extraUp, extraDown } (px reserved above and below the arrow's own line). */
export function arrowParts(set, has) {
  const t = set.includes('t') && !!has.title, d = set.includes('d') && !!has.desc;
  const a = set.includes('a') || (!t && !d);
  return { api: a, title: t, desc: d, extraUp: a && t ? 17 : 0, extraDown: a ? (d ? 15 : 0) : t && d ? 15 : 0 };
}
/** The height the layout adds to a step's row (0 for the API line alone). */
export const extraHeight = (p) => (p ? p.extraUp + p.extraDown : 0);
