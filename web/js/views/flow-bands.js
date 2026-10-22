// Subsystem bands over a flow's component heads (0.28.1, frame 12c), pure. `subOf(service)` -> the subsystem key of a component ('' = none).
// groupColumns puts the components of one subsystem next to each other; subBands says which run of heads each band covers. No DOM.

const isSvc = (c) => c.kind === 'service' && c.service;
const isRes = (c) => c.kind === 'resource';

/** The key of the "Shared" band (0.30.1, #67): data stores that no component of a subsystem owns. */
export const SHARED = '~shared';
/** The band a lifeline belongs to: a component's subsystem; a data store has its owner's subsystem, else Shared (no owner, or an owner in no subsystem). '' = none. */
export const memberOf = (c, subOf) => (isSvc(c) ? subOf(c.service) : isRes(c) ? (c.owner && subOf(c.owner)) || SHARED : '');

/**
 * groupColumns(columns, subOf) -> the columns with the components of one subsystem together.
 * The first column (the caller or the client app) stays first. The components with a subsystem fill the places that components with a subsystem
 * had, grouped by the order each subsystem first appears, in their old order inside a group. A component with no subsystem, a topic, a queue and
 * an unresolved target keep their place. A data store (0.30.1) goes right after the last lifeline of its owner's subsystem (an owner subsystem with
 * no component in the flow: after the last component); stores with no owner subsystem go together after that, the "Shared" band. Never changes the array it is given.
 */
export function groupColumns(columns, subOf) {
  const slots = [];
  columns.forEach((c, i) => { if (i > 0 && isSvc(c) && subOf(c.service)) slots.push(i); });
  const order = [];
  for (const i of slots) { const k = subOf(columns[i].service); if (!order.includes(k)) order.push(k); }
  const moved = slots.map((i) => columns[i]).sort((a, b) => order.indexOf(subOf(a.service)) - order.indexOf(subOf(b.service))); // Array.sort is stable
  const out = [...columns];
  slots.forEach((i, k) => { out[i] = moved[k]; });
  return placeStores(out, subOf);
}

function placeStores(cols, subOf) {
  const stores = cols.filter((c, i) => i > 0 && isRes(c));
  if (!stores.length) return cols;
  const out = cols.filter((c, i) => i === 0 || !isRes(c)), placed = new Set();
  const lastOf = (k) => out.findLastIndex((c) => (isSvc(c) && subOf(c.service) === k) || (placed.has(c) && memberOf(c, subOf) === k));
  const tail = [], at = () => Math.max(0, out.findLastIndex((c) => isSvc(c) || placed.has(c))) + 1;
  for (const c of stores) {
    const k = memberOf(c, subOf), i = k === SHARED ? -1 : lastOf(k);
    if (i >= 0) { out.splice(i + 1, 0, c); placed.add(c); } else tail.push(c);
  }
  const order = [];
  for (const c of tail) { const k = memberOf(c, subOf); if (!order.includes(k)) order.push(k); }
  order.sort((a, b) => (a === SHARED) - (b === SHARED)); // owner subsystems with no component here first, Shared last
  out.splice(at(), 0, ...order.flatMap((k) => tail.filter((c) => memberOf(c, subOf) === k)));
  return out;
}

/**
 * subBands(columns, folded, subOf) -> [{ key, from, to }]: the runs of neighbouring heads of one subsystem (column indexes, first to last).
 * `folded`: Set of Squeezed column indexes. A fold whose columns are all components of one subsystem is part of that subsystem's run;
 * a mixed fold has no band (and ends the run). A topic, a queue or a store between two components ends the run too.
 */
export function subBands(columns, folded, subOf) {
  const out = [];
  let i = 0;
  while (i < columns.length) {
    let j = i, key = null;
    if (folded.has(i)) {
      while (j + 1 < columns.length && folded.has(j + 1)) j++;
      const ks = new Set(columns.slice(i, j + 1).map((c) => memberOf(c, subOf)));
      key = ks.size === 1 ? [...ks][0] : null;
    } else key = memberOf(columns[i], subOf) || null;
    const last = out[out.length - 1];
    if (key) { if (last && last.to === i - 1 && last.key === key) last.to = j; else out.push({ key, from: i, to: j }); }
    i = j + 1;
  }
  return out;
}
