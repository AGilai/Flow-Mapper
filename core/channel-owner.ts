// Who owns a channel (0.50.0, #104): the component whose manifest declares it (`channels[]`), for the flow view's subsystem bands.
// A service of kind `infra` is shared plumbing, not an owner; several declarers: the first in model order that is not infra. None: undefined. Pure.

import type { GraphIndex } from './graph-index.ts';

const memo = new WeakMap<GraphIndex, Map<string, string>>();

/** The owning component of the channel with this bind key, or undefined (declared by infra only, or by nobody). */
export function channelOwner(g: GraphIndex, key: string): string | undefined {
  let m = memo.get(g);
  if (!m) {
    m = new Map();
    for (const c of g.model.channels) if (!m.has(c.bindKey) && g.services.get(c.service)?.kind !== 'infra') m.set(c.bindKey, c.service);
    memo.set(g, m);
  }
  return m.get(key);
}
