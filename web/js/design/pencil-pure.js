// Pencils (0.31.1), the pure part: which items carry one in which kind of environment, what a click does about the draft, and where an About
// section starts in the text. No DOM, no state (design/pencil.js does the drawing and the opening).

/** What a pencil stands for -> the environments that get it. 'annotation' items are the flow and step descriptions: allowed everywhere. */
const ITEMS = {
  header: 'design', docs: 'design', about: 'design', 'about-section': 'design', owners: 'design', endpoint: 'design', flow: 'design',
  inventory: 'design', subsystem: 'design', 'panel-component': 'design', 'panel-subsystem': 'design', 'panel-flow': 'design',
  'flow-description': 'annotation', 'step-description': 'annotation',
};

/** Does `item` get a pencil in an environment of this kind (`isDesign`: a design environment; anything else is harvested)? */
export function pencilAllowed(item, isDesign) {
  const rule = ITEMS[item];
  return rule === 'annotation' ? true : rule === 'design' ? !!isDesign : false;
}

/** The pencil kinds an environment shows, in a stable order (the tests and the hint read this). */
export const pencilItems = (isDesign) => Object.keys(ITEMS).filter((k) => pencilAllowed(k, isDesign));

/** The one muted line of a harvested page (prod): where the facts are edited instead. Null in a design environment. */
export const harvestedHint = (isDesign) => (isDesign ? null : 'Harvested — edit at the source');

/**
 * What a pencil click does when the page is not editing (pure). `drafts`: the open drafts of the environment ({slug, name, ...}).
 *  - exactly one: use it, no question;  - several: a popover picks;  - none: offer "Start draft 'my edits'".
 * `last`: the slug of the draft used last (put first in the list).
 */
export function draftChoice(drafts, last = null) {
  const list = Array.isArray(drafts) ? drafts : [];
  if (list.length === 0) return { kind: 'start', name: 'my edits' };
  if (list.length === 1) return { kind: 'use', draft: list[0] };
  return { kind: 'pick', drafts: [...list].sort((a, b) => Number(b.slug === last) - Number(a.slug === last)) };
}

/** The offset of the `## <title>` / `### <title>` line in an About text (where the editor should land), or -1. Case-insensitive. */
export function sectionOffset(text, title) {
  const want = String(title ?? '').trim().toLowerCase();
  let pos = 0;
  for (const line of String(text ?? '').split('\n')) {
    const m = /^#{2,3}\s+(.*?)\s*#*\s*$/.exec(line);
    if (m && m[1].toLowerCase() === want) return pos;
    pos += line.length + 1;
  }
  return -1;
}

/** The aria-label of a pencil: "Edit <thing>". */
export const pencilLabel = (thing) => `Edit ${thing}`;
