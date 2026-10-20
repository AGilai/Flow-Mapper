// What the event page draws, from the API's `flow`: producer blocks with their targets and visible rows.
// Rows a subscription filters out are skipped here (the data keeps them). Beyond 8 rows only Handled
// rows collapse; problem and possible rows always stay. See docs/UI-GUIDE.md §2.

export const ROW_LIMIT = 8;
const visible = (r) => r.outcome !== 'filtered';

/** Rows of consecutive targets sort so a consumer that appears in two targets sits next to itself. */
function adjacent(targets) {
  const names = (t) => new Set(t.rows.map((r) => r.consumer));
  targets.forEach((t, i) => {
    const prev = i ? names(targets[i - 1]) : new Set(), next = i < targets.length - 1 ? names(targets[i + 1]) : new Set();
    const key = (r) => (next.has(r.consumer) ? 2 : prev.has(r.consumer) ? 0 : 1);
    // One run per consumer: rows of a service stay together, in the order its first row had.
    const first = new Map();
    t.rows.forEach((r, k) => { if (!first.has(r.consumer)) first.set(r.consumer, k); });
    t.rows = t.rows.map((r, k) => [r, k]).sort((a, b) => key(a[0]) - key(b[0]) || first.get(a[0].consumer) - first.get(b[0].consumer) || a[1] - b[1]).map((x) => x[0]);
  });
  return targets;
}

const target = (t) => ({ target: t, all: t.rows.length, rows: t.rows.filter(visible), shown: [], hidden: 0 });

/** One block per producer service, plus one for consumers nothing feeds when no producer is known. */
export function prepare(flow) {
  const mk = (group, targets, unresolved) => ({
    group, unresolved,
    targets: adjacent(targets.map(target)).filter((t) => t.rows.length || t.target.topic),
  });
  const blocks = flow.groups.map((g) => mk(g, g.targets, flow.unresolved.filter((u) => u.service === g.producer)));
  if (!flow.groups.length && flow.unfed.length) blocks.push(mk(null, flow.unfed, []));
  return blocks;
}

/** Sets `shown` and `hidden` on every target. Returns the number of rows in all and how many are hidden. */
export function collapse(blocks, expanded) {
  const all = blocks.flatMap((b) => b.targets.flatMap((t) => t.rows));
  const room = expanded || all.length <= ROW_LIMIT ? Infinity : Math.max(3, ROW_LIMIT - all.filter((r) => r.outcome !== 'handled').length);
  let used = 0, hidden = 0;
  for (const b of blocks) for (const t of b.targets) {
    t.shown = t.rows.filter((r) => r.outcome !== 'handled' || used++ < room);
    t.hidden = t.rows.length - t.shown.length;
    hidden += t.hidden;
  }
  return { total: all.length, hidden };
}
