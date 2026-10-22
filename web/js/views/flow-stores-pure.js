// Data stores in a flow diagram (0.27.1, bug #62), pure: each collection a store is used through is a lifeline of its own, and more than
// MAX_COLLECTION_LIFELINES of one store in one flow fold into a single lifeline. Grouping, folding, labels and the bands over the heads.
// The drawing is flow-draw-bands.js (bands, legend) and flow-draw-heads.js / flow-draw-rows.js (heads, arrows). No DOM.

export const MAX_COLLECTION_LIFELINES = 5; // not a setting; counted per store and per flow

/** A resource step's key `mongodb:users-db/users` -> { group: 'mongodb:users-db', store: 'users-db', kind: 'mongodb', collection: 'users' }. A key with no '/' has no collection. */
export function splitStore(m) {
  const key = String(m.store ?? ''), i = key.indexOf('/'), group = i < 0 ? key : key.slice(0, i), collection = i < 0 ? null : key.slice(i + 1) || null;
  return { group, store: group.replace(/^[^:]+:/, '') || group, kind: m.storeKind ?? (group.includes(':') ? group.split(':')[0] : 'store'), collection };
}

/** A write is drawn heavier, with no return. Only the harvester's (or the operation's) `write`; read_write and unknown draw as a read. */
export const isWrite = (m) => m.access === 'write';

/** The label of an arrow's operation: the harvester's own words. A step without one (the trace says `use`) says its access mode instead. */
export function opLabel(m) {
  if (m.label !== 'use') return m.label;
  return m.access === 'read' || m.access === 'write' ? m.access : m.access === 'read_write' ? 'read/write' : 'access';
}

/** Map group -> number of collections, for the stores that fold in this flow (more than `max` distinct collections). msgs: the resource messages. */
export function foldedStores(msgs, max = MAX_COLLECTION_LIFELINES) {
  const seen = new Map();
  for (const m of msgs) {
    if (m.kind !== 'resource') continue;
    const { group, collection } = splitStore(m);
    if (!seen.has(group)) seen.set(group, new Set());
    seen.get(group).add(collection ?? '');
  }
  return new Map([...seen].filter(([, set]) => set.size > max).map(([group, set]) => [group, set.size]));
}

/** The lifeline of a message's store: one per collection, or one per store when it folds. `folds`: foldedStores(...). */
export function storeColumn(m, folds) {
  const { group, store, kind, collection } = splitStore(m), n = folds.get(group);
  const base = { kind: 'resource', transport: 'res', group, store, storeKind: kind, owner: m.owner ?? null }; // owner: the declaring component, for the subsystem band (flow-bands.js)
  return n ? { ...base, id: `res:${group}`, label: `${store} (${n} collections)`, sub: `${kind} · name on each arrow`, stack: true, collections: n }
    : { ...base, id: `res:${group}/${collection ?? ''}`, label: collection ?? store, sub: `${store} · ${kind}`, collection };
}

/** The label of an arrow: the operation, and the collection when the lifeline does not name it (the fold). */
export const arrowLabel = (m, folded) => { const { collection } = splitStore(m); return folded && collection ? `${opLabel(m)} · ${collection}` : opLabel(m); };
/** The step's own label in the walk and the panel: always the operation and the collection. */
export const stepLabel = (m) => { const { collection } = splitStore(m); return collection ? `${opLabel(m)} · ${collection}` : opLabel(m); };

/** Order of the store lifelines: by the first step that touches the store, then by the first step that touches the collection (`ci` = creation order). */
export function orderStores(cols) {
  const first = new Map();
  for (const c of cols) if (!first.has(c.group)) first.set(c.group, c.ci);
  return [...cols].sort((a, b) => first.get(a.group) - first.get(b.group) || a.ci - b.ci);
}

/** The bands over the heads: runs of neighbouring lifelines of one store. columns: the lane's columns; folded: Set of squeezed indexes. -> [{ from, to, group, label }] */
export function bandsOf(columns, folded = new Set()) {
  const out = [];
  columns.forEach((c, i) => {
    if (c.kind !== 'resource' || folded.has(i)) return;
    const last = out[out.length - 1];
    if (last && last.to === i - 1 && last.group === c.group) last.to = i;
    else out.push({ from: i, to: i, group: c.group, label: `${c.storeKind}: ${c.store}` });
  });
  return out;
}
