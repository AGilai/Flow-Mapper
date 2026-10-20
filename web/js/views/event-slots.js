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

const outcomeRank = (o) => ({ 'no-handler': 0, handled: 1, 'no-reader': 2, possible: 3 }[o] ?? 4);

/** Two rows that reach the same consumer on the same queue, from different producers, are one row. */
function mergeRows(a, b) {
  const best = outcomeRank(a.outcome) <= outcomeRank(b.outcome) ? a : b;
  const ingresses = [...a.ingresses];
  for (const i of b.ingresses) if (!ingresses.some((x) => x.id === i.id)) ingresses.push(i);
  // A producer that surely sends it makes the row a sure one; a possible row only stays possible when all of them are.
  const merged = { ...best, ingresses, alias: [...(a.alias ?? []), b.id, ...(b.alias ?? [])] };
  if (merged.outcome !== 'possible') delete merged.ifSent;
  return merged;
}

/** What a producer sends first: one topic, or direct queues. Producers with the same one share a block. */
const signature = (g, unresolved) => (unresolved.length ? null : JSON.stringify(g.targets.map((t) => (t.topic ? `t:${t.topic.key}` : `q:${t.rows.filter(visible).map((r) => `${r.queue?.key}>${r.consumer}`).join(',')}`))));
const oneBranch = (g) => g.targets.length === 1 && (g.targets[0].topic || g.targets[0].rows.filter(visible).length === 1);

/**
 * Blocks of the page. Producers whose first hop is the same single topic (or the same single queue) are
 * one block: one topic, queue and consumer node however many of them feed it. A producer that sends to
 * several places, or has an unresolved call site, keeps its own block. A block with no producer holds
 * the consumers nothing feeds.
 */
export function prepare(flow) {
  const mk = (groups, targets, unresolved) => ({
    group: groups[0] ?? null, groups, unresolved,
    targets: adjacent(targets.map(target)).filter((t) => t.rows.length || t.target.topic),
  });
  const blocks = [];
  const shared = new Map();
  for (const g of flow.groups) {
    const unresolved = flow.unresolved.filter((u) => u.service === g.producer);
    const sig = oneBranch(g) ? signature(g, unresolved) : null;
    const into = sig && shared.get(sig);
    if (!into) {
      const b = mk([g], g.targets, unresolved);
      blocks.push(b);
      if (sig) shared.set(sig, b);
      continue;
    }
    into.groups.push(g);
    const t = into.targets[0], from = g.targets[0];
    t.target = { ...t.target, possible: t.target.possible && from.possible };
    for (const r of from.rows) {
      const k = t.target.rows.findIndex((x) => x.queue?.key === r.queue?.key && x.consumer === r.consumer && x.outcome !== 'filtered' && r.outcome !== 'filtered');
      if (k < 0) { t.target.rows.push(r); continue; }
      t.target.rows[k] = mergeRows(t.target.rows[k], r);
    }
    t.target.rows = t.target.rows.map((r) => r);
    t.rows = t.target.rows.filter(visible);
    t.all = t.target.rows.length;
  }
  if (!flow.groups.length && flow.unfed.length) blocks.push(mk([], flow.unfed, []));
  for (const b of blocks) {
    b.anyPossible = b.groups.some((g) => g.possible || g.targets.some((t) => t.possible));
    b.groups.forEach((g) => { g.drawnPossible = g.possible || g.targets.some((t) => t.possible); });
  }
  return blocks;
}

/** Sets `shown` and `hidden` on every target, and `producers` / `producersHidden` on a block of many producers. */
export function collapse(blocks, expanded) {
  const all = blocks.flatMap((b) => b.targets.flatMap((t) => t.rows));
  const room = expanded || all.length <= ROW_LIMIT ? Infinity : Math.max(3, ROW_LIMIT - all.filter((r) => r.outcome !== 'handled').length);
  let used = 0, hidden = 0, many = 0;
  for (const b of blocks) {
    for (const t of b.targets) {
      t.shown = t.rows.filter((r) => r.outcome !== 'handled' || used++ < room);
      t.hidden = t.rows.length - t.shown.length;
      hidden += t.hidden;
    }
    // Producers collapse like rows: only when everything they reach is handled; possible ones always stay.
    const calm = b.targets.every((t) => t.rows.every((r) => r.outcome === 'handled'));
    const keep = (g) => !calm || g.drawnPossible;
    const fixed = b.groups.filter(keep).length;
    const slots = expanded || b.groups.length <= ROW_LIMIT ? Infinity : Math.max(3, ROW_LIMIT - fixed);
    let n = 0;
    b.producers = b.groups.filter((g) => keep(g) || n++ < slots);
    b.producersHidden = b.groups.length - b.producers.length;
    hidden += b.producersHidden;
    if (b.groups.length > ROW_LIMIT) many = Math.max(many, b.groups.length);
  }
  return { total: all.length, hidden, producers: many };
}
