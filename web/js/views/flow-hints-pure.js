// "Transport hints" (0.30.4, #70): whether an undecided transport on an arrow shows its full text label or only a small icon. `th=0|1` in the URL.
// Default: off in a design environment (the icon; the words are in its tooltip and the step bar), on elsewhere (the label as before). The URL has it only when it differs.

export const hintsDefault = (design) => !design;

/** `th=` -> on / off; absent or unreadable: the default. */
export function decodeHints(query, design) {
  const v = query.get('th');
  return v === '1' ? true : v === '0' ? false : hintsDefault(design);
}
/** The `th=` value: nothing at the default. */
export const encodeHints = (on, design) => (!!on === hintsDefault(design) ? null : on ? '1' : '0');
