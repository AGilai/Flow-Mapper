// The draft bar: name, who is in it, the delta (+added -removed ~changed), and Review changes · Discard · Apply to <env>.
// Apply is disabled with nothing to apply; when items changed in the environment since the draft touched them, a --warn callout says Apply overwrites them.

import { h } from '../dom.js';
import { state } from '../state.js';
import { names, deltaText } from './who.js';

/** "by seed", "by seed and 2 others" (pure). */
export function byText(authors) {
  if (!authors.length) return 'no changes yet';
  return authors.length === 1 ? `by ${authors[0]}` : `by ${authors[0]} and ${authors.length - 1} other${authors.length === 2 ? '' : 's'}`;
}

/** The delta's tooltip (pure): "+6 added (2 imported from prod), 0 removed, 1 changed"; imports are unchanged against their source and are not in the counts. */
export const deltaTitle = (c, imported) => `${c.added} added${imported?.n ? ` (${imported.n} imported from ${imported.from ?? 'another environment'}, not counted)` : ''}, ${c.removed} removed, ${c.changed} changed`;

/** draftBar({ draft, changes, review, onReview, onApply, onDiscard, onPick }) -> element. review: 'review' | 'confirm' | null. */
export function draftBar({ draft, changes, review, onReview, onApply, onDiscard, onPick, busy = false, imported = null }) {
  const c = changes?.counts ?? draft.counts, total = c.added + c.removed + c.changed;
  const stale = (changes?.items ?? []).filter((i) => i.stale && !i.under);
  const who = changes?.authors?.length ? changes.authors : draft.authors;
  return h('div.dz-bar', { 'data-qa': 'draft-bar', role: 'region', 'aria-label': `Draft ${draft.name}` },
    h('div.dz-bar-main',
      h('button.dz-draftname', { type: 'button', 'data-qa': 'draft-name', title: 'Switch draft', 'aria-label': `Draft ${draft.name}. Switch draft`, on: { click: (e) => onPick(e.currentTarget) } }, h('b', draft.name), h('span.dz-caret', '▾')),
      h('span.dz-by.muted.xs', { title: names(who) }, byText(who)),
      h('span.dz-delta', { 'data-qa': 'draft-delta', title: deltaTitle(c, imported) },
        h('span.a', `+${c.added}`), h('span.r', `−${c.removed}`), h('span.c', `~${c.changed}`)),
      h('span.spacer'),
      h('div.dz-actions',
        h('button.btn', { type: 'button', 'data-qa': 'review', 'aria-pressed': String(review === 'review'), disabled: busy, on: { click: onReview } }, 'Review changes'),
        h('button.btn', { type: 'button', 'data-qa': 'discard', disabled: busy, on: { click: onDiscard } }, 'Discard'),
        h('button.btn.primary', { type: 'button', 'data-qa': 'apply', disabled: busy || !total, title: total ? `Apply ${deltaText(c)} to ${state.env}` : 'No changes yet', on: { click: onApply } },
          busy ? 'Applying…' : total ? `Apply to ${state.env}` : 'No changes yet'))),
    stale.length && review !== 'confirm' ? h('div.dz-callout', { role: 'note', 'data-qa': 'stale' }, `${stale.length} item${stale.length === 1 ? '' : 's'} changed in ${state.env} since this draft touched ${stale.length === 1 ? 'it' : 'them'}; Apply overwrites ${stale.length === 1 ? 'it' : 'them'}. `,
      h('button.btn.sm.ghost', { type: 'button', on: { click: onReview } }, 'Show')) : null);
}
