// The review list's grouping, pure: changes (GET /changes items) by component, and the word for the kind of item an anchor names.

const KIND_WORD = { svc: 'component', fn: 'function', ing: 'endpoint', egr: 'call', res: 'store', bind: 'subscription', ch: 'channel', dto: 'message', evt: 'event message', schema: 'schema', flow: 'flow', grp: 'subsystem', link: 'abstract link', rel: 'flow relation' };
const SERVICE_KINDS = new Set(['svc', 'fn', 'ing', 'egr', 'res', 'bind', 'dto', 'flow']);

const kindOf = (anchor) => anchor.slice(0, Math.max(0, anchor.indexOf(':')));

/** The component an anchor belongs to ('' for channels, event messages and schemas, which belong to none). Service names never contain '/'. */
export function serviceOfAnchor(anchor) {
  if (!SERVICE_KINDS.has(kindOf(anchor))) return '';
  const rest = anchor.slice(anchor.indexOf(':') + 1), j = rest.indexOf('/');
  return j < 0 ? rest : rest.slice(0, j);
}

export const kindWord = (anchor) => KIND_WORD[kindOf(anchor)] ?? 'item';

/** Changes grouped by component: [{service, items}] in name order, the component's own row first; items of no component go last under ''. */
export function groupChanges(items) {
  const by = new Map();
  for (const it of items) {
    const svc = it.under ? it.under.slice(4) : serviceOfAnchor(it.anchor);
    if (!by.has(svc)) by.set(svc, []);
    by.get(svc).push(it);
  }
  return [...by].map(([service, list]) => ({ service, items: list.sort((a, b) => Number(a.anchor !== `svc:${service}`) - Number(b.anchor !== `svc:${service}`)) }))
    .sort((a, b) => (a.service === '' ? 1 : b.service === '' ? -1 : a.service < b.service ? -1 : 1));
}
