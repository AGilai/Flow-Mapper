// "Compared with": the baseline frozen at copy time, or the source environment as it is now. Marks are the same kind either way.

import { h } from '../dom.js';
import { state, setDesign } from '../state.js';
import { shortDate } from '../env-info.js';

/** compareSwitch(meta, sourceGone) -> .seg. meta = the env's row of /envs/meta ({source, copiedAt}); `sourceGone`: the source env was deleted. */
export function compareSwitch(meta, sourceGone) {
  const src = meta.source ?? 'source', when = shortDate(meta.copiedAt);
  const btn = (id, label, title, disabled) => h('button', { type: 'button', 'data-compare': id, 'aria-pressed': String(state.compare === id), disabled: !!disabled, title,
    on: { click: () => { if (state.compare !== id) setDesign({ compare: id }); } } }, label);
  return h('div.seg.dz-compare', { role: 'group', 'aria-label': 'Compared with' },
    btn('baseline', `Baseline: ${src}${when ? ', ' + when : ''}`, `Marks compare with ${src} as it was when this environment was copied`),
    btn('source', `${src} now`, sourceGone ? `${src} no longer exists: compare with the baseline` : `Marks compare with ${src} as it is now`, sourceGone));
}
