// One entry point in the Flows list: the flow's name (bold) over its entry key (mono) and summary (frame 7); the lock after the name when the flow is
// or reaches a reference; the New / Changed mark of a design (#60) with its "what changed" as the tooltip; an ↗ when the flow has a main link (#54).

import { h } from '../dom.js';
import { chip, splitKey } from '../format.js';
import { href } from '../router.js';
import { describeCount } from '../../core/flow-counts.js';
import { lockChip } from '../components/lock.js';
import { markBadge, markTitle } from '../components/status-mark.js';
import { icon } from '../icons.js';
import { entryKey } from './flow-tabs-state.js';
import { markOfPoint } from './flow-list-filter.js';
import { safeUrl } from '../components/ext-links.js';

const countBadge = (c) => (c ? h('span.count', { title: describeCount(c) }, ` (${c.total})`) : null);
/** The comment count of a flow (0.27.0): a small speech-bubble icon and the number, nothing when there are none. */
const cmtBadge = (n) => (n ? h('span.fl-cm', { title: `${n} comment${n === 1 ? '' : 's'}`, 'aria-label': `${n} comment${n === 1 ? '' : 's'}` }, icon('comment'), String(n)) : null);

/** The ↗ of a main link: a small button that opens it in a new tab (never inside the row's own link). */
export function extLink(links) {
  const main = links?.main ?? null;
  if (!safeUrl(main?.url)) return null; // http(s) only, like the other link spots
  return h('span.fl-ext', { role: 'link', tabindex: 0, title: `${main.label ?? 'Link'} (opens in a new tab)`, 'aria-label': `${main.label ?? 'Link'}, opens in a new tab`,
    on: { click: (e) => { e.preventDefault(); e.stopPropagation(); window.open(main.url, '_blank', 'noopener'); }, keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); window.open(main.url, '_blank', 'noopener'); } } } }, icon('external'));
}

/** The text of the mark's tooltip: "New since baseline prod, Oct 21: +1 call" (pure parts in status-mark.js). */
const markTip = (info, marks) => [markTitle(info, marks), info.what].filter(Boolean).join(': ');

/** entryRow(p, { marks, counts, onPick, design }) -> the row element. */
export function entryRow(p, { marks, counts, cmts = {}, onPick, design }) {
  const cm = cmtBadge(cmts[`flow:${p.service}/${p.id}`]);
  const info = design ? markOfPoint(marks, p) : null, rest = splitKey(p.bindKey).rest, lock = p.reference || p.partial ? lockChip({ source: p.reference?.source ?? null }, { short: true, text: p.reference ? null : 'partial', title: p.reference ? 'This entry point is a reference: its behaviour is in another environment.' : `This flow runs into ${p.partial} reference${p.partial === 1 ? '' : 's'}.` }) : null;
  return h('a.entry', { href: href('/flows', { service: p.service, ingress: p.id }), 'data-key': entryKey(p.service, p.id), on: { click: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); onPick(p); } } },
    p.name ? h('span.fl-nm', extLink(p.flowLinks?.main ? p.flowLinks : p.links), h('b', p.name), lock || info ? h('span.fl-tags', lock, info ? markBadge(info, { store: marks, short: true, title: markTip(info, marks) }) : null) : null) : null,
    h('span.row', p.bindKey.startsWith('amqp-rpc:') ? chip('rpc', 'amqp rpc') : chip(p.transport), p.entryPoint ? h('span.xs.muted', 'entry point') : null,
      p.name ? null : [lock, info ? markBadge(info, { store: marks, short: true, title: markTip(info, marks) }) : null, extLink(p.flowLinks?.main ? p.flowLinks : p.links)]),
    h('span.key', rest, p.name ? null : countBadge(counts.get(`${p.service}:${p.id}`)), p.name ? null : cm), p.name ? h('span.xs.muted', `${p.service} · ${p.id}`, countBadge(counts.get(`${p.service}:${p.id}`)), cm) : null,
    p.summary ? h('span.fl-sum.xs.muted', p.summary) : null);
}

/** A removed endpoint (a ghost of the marks), listed under "Changed only, and removed": muted, struck through, not a link. */
export const removedRow = (g, marks) => h('div.entry.is-removed', { title: `Removed since ${marks.against === 'source' ? 'the source' : 'the baseline'}` }, h('span.row', markBadge({ mark: 'removed' }, { store: marks })), h('span.key', `${g.service} · ${g.label}`));
