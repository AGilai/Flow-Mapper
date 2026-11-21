// The lifeline head's actions and its hover card (#149). Pure: the sections come in already split (core/about-sections), so node tests need no loader.

import { isStoreHead } from './store-panel-pure.js';

/** What a click (or Enter) on a lifeline head does, in the order the drawing wires it: a service -> its info pane, a fan -> fold/unfold, a store head -> the store panel, else nothing. */
export const headAction = (c, { storeOn = false } = {}) => (c?.service ? 'info' : c?.fan ? 'fan' : storeOn && isStoreHead(c) ? 'store' : null);

/** Does the head get the ⋮ button (the participant menu)? The heads that have a menu: every component head. */
export const hasMore = (c) => !!c?.service && !c.fan;

/** Does the head show the hover card? A plain component head: client-app triggers and caller lists keep their own <title> tooltip. */
export const headCardable = (c) => !!c?.service && !c.fan && !c.trigger && !c.callers && c.kind !== 'resource';

/** The first About section with text: { heading, text } or null. `sections`: core/about-sections `aboutSections(md)`; `strip`: core/markdown-strip `stripMarkdown`. */
export function firstSection(sections, strip) {
  for (const s of sections ?? []) { const text = strip(s.body); if (text) return { heading: s.title || '', text }; }
  return null;
}

/** What the card shows: the name, the Type, the first About section, else the description, else "No description yet". */
export function headCardModel({ name, type, sections, description }, strip) {
  const first = firstSection(sections, strip), d = strip(description);
  return { name, type, heading: first?.heading ?? '', text: first?.text ?? d ?? '', empty: !first && !d, fallback: !first && d ? 'description' : first ? 'about' : 'none' };
}
