// External services (#87): the "external" tag (real text, read as "<name>, external") and the one-line service page note.
import { h } from '../dom.js';

export const EXTERNAL_NOTE = 'External service — a third-party host. Its internals are not mapped.';

/** The text tag that follows a name in lists and panels. */
export const externalTag = (x) => (x?.external ? h('span.ext-tag', { title: 'A third-party host: its internals are not mapped' }, 'external') : null);

/** The note on an external service's page. */
export const externalNote = () => h('p.ext-note', { 'data-qa': 'external-note' }, EXTERNAL_NOTE);
