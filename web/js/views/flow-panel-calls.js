// #88: the Info pane of a merged store node (`*3 get, hget`): one row per call, in order: its step number (a click expands the run and goes to it),
// the operation, the key template (or why there is none), the db, the TTL, the guard, and the code location (a link only when it is http or https).

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { reasonText, humanTtl } from '../../core/store-panel.js';

const web = (u) => (/^https?:\/\//i.test(u ?? '') ? u : null);
const ACC = { read: 'read', write: 'write', read_write: 'read and write' };

/**
 * callsCard(m, trace, { n, expand(k) }) -> the section. n: the step the node is drawn as (null: not numbered); expand(k): open the run and go to its k-th call (1-based).
 * Each call is the fields of its own message (`m.dbGroup.calls`), so a harvester that sent no key template shows "key not reported" with the reason when there is one.
 */
export function callsCard(m, trace, { n = null, expand = null } = {}) {
  const calls = m.dbGroup?.calls ?? [];
  const rows = calls.map((c, i) => {
    const at = c.stepId ? trace.code?.[`step:${c.stepId}`] : null, loc = at?.file ? `${at.file}${at.line ? `:${at.line}` : ''}` : null, url = web(at?.url);
    const why = reasonText(c), key = c.keyTemplate ?? null;
    const no = n != null ? `${n}.${i + 1}` : String(i + 1);
    const meta = [c.dbIndex != null ? h('span', 'db ', h('b', String(c.dbIndex))) : null, c.ttlSeconds != null ? h('span', 'TTL ', h('b', humanTtl(c.ttlSeconds))) : null, ACC[c.access] ? h('span', ACC[c.access]) : null].filter(Boolean);
    return h('li.dc-row', { 'data-call': i + 1 },
      expand ? h('button.dc-no', { type: 'button', title: `Open the run and go to call ${no}`, 'aria-label': `Go to call ${no}, ${c.label}`, on: { click: () => expand(i + 1) } }, no) : h('span.dc-no', no),
      h('div.dc-b',
        h('div.dc-h', h('b.mono', c.label), key ? h('span.mono.dc-key', key) : h('span.muted.small', why ? `key not reported (${why})` : 'key not reported')),
        meta.length ? h('div.dc-m.small.muted', ...meta.flatMap((x, k) => (k ? [' · ', x] : [x]))) : null,
        c.onlyWhen?.guard ? h('div.dc-g.small', h('span.muted', 'only when '), c.onlyWhen.guard) : null,
        loc ? h('div.dc-l.small', url ? h('a.ep-link-inline', { href: url, target: '_blank', rel: 'noopener noreferrer', title: url }, h('span.key', loc), ' ', icon('external')) : h('span.key', loc)) : null));
  });
  return h('section.ep-card.dc', { 'data-qa': 'db-calls' }, h('header', h('h3', `${calls.length} calls to ${m.dbGroup.collections.length === 1 ? m.dbGroup.collections[0] : m.store?.replace(/^[^:]+:/, '') ?? 'the store'}`), h('span.ep-meta', 'in order')),
    h('ol.dc-list', rows), expand ? h('div.ep-pad', h('button.btn.sm', { type: 'button', on: { click: () => expand(0) } }, `Show the ${calls.length} calls as separate arrows`)) : null);
}

/** #88: what a merged node's pane may do: its drawn step `n`, and `expand(k)`: close the pane, open the run (the tab's DB toggle) and go to its k-th call (k 0: only open it). The run's calls become steps n .. n+count-1. */
export function dbContext(m, { walk, host, onDb }) {
  const n = walk.steps().find((x) => x.event.msg === m)?.n ?? null;
  return { n, expand: (k) => { host.panel.close(); onDb?.(m.key); if (k && n) walk.go(n + k - 1); } };
}
