// Tabs of different environments side by side (0.36.0): the pieces around them that are not the diagram. A tab of another env than the page's is read
// only and says so (`foreignNote`, in flow-xenv-ui.js); a tab whose env is gone says that instead of a diagram (`unavailableBox`); with two or more envs among the open
// tabs each tab carries a short env chip (`tabChips`).

import { chipLabels } from '../env-info.js';
import { envOfKey, parseKey } from './flow-tab-keys.js';

/** The chip label of every tab key (a Map key -> text), or an empty Map while the open tabs are of one env only. */
export function tabChips(keys) {
  const envs = keys.map((k) => envOfKey(k));
  const distinct = new Set(envs.filter(Boolean));
  if (distinct.size < 2) return new Map();
  const labels = chipLabels([...distinct]);
  return new Map(keys.map((k, i) => [k, labels.get(envs[i]) ?? null]));
}

/** What the tab strip draws for a tab whose env does not exist: the flow's own name from the key, and no data. */
export function goneDescribe(key) {
  const p = parseKey(key);
  const title = p ? (p.service ?? p.handler ?? key) : key, sub = p ? (p.ingress ?? p.fn ?? p.queue ?? '') : '';
  return { kind: p?.kind ?? 'entry', title, sub, tip: `${title}${sub ? ` · ${sub}` : ''}: environment ${p?.env ?? '?'} not found`, color: 'var(--muted)', gone: true };
}

export const noteText = (env) => `Viewing ${env}. Switch to it to edit.`;
export const goneText = (env) => `Environment ${env} is not available`;
