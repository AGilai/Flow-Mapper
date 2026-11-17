// Status marks on a flow diagram. Lifeline heads carry the mark of their component (svc:); an arrow carries the mark of its call (egr:<caller>/<id>),
// else of a new endpoint it reaches (ing:). The highest new level wins: the children of a new component carry no mark (the marks endpoint prunes
// them), so an arrow inside or out of a new component stays plain and its head carries the spark. Joined by anchor computed from the message, never by row.
// Pure: no DOM, no imports (the store is a marks store from design/marks-store.js).

/** The anchor of a lifeline head, or null (client, queue, unresolved ... carry no mark). A store head has the anchors of its resources (`res:<service>/<id>`, #122): see headAnchors. */
export const headAnchor = (col) => (col?.kind === 'service' && col.service ? `svc:${col.service}` : col?.kind === 'resource' ? col.anchors?.[0] ?? null : null);
/** All anchors a head stands for: a component's own, or the resources behind a store head (a folded store has several). */
export const headAnchors = (col) => (col?.kind === 'resource' ? col.anchors ?? [] : [headAnchor(col)].filter(Boolean));

/** { anchor, info } of the arrow of a trace message, or null. */
export function arrowMark(store, m) {
  if (!m) return null;
  if (m.mark) return { anchor: `step:${m.service}/${m.fn}#${m.seq}`, info: { mark: m.mark, ...(m.changed ? { what: m.changed } : {}) }, step: true }; // 0.32.2 (#75): the step's own flag, whatever the diff says
  if (!store) return null;
  if (m.service && m.egress) {
    const anchor = `egr:${m.service}/${m.egress}`, info = store.markOf(anchor);
    if (info) return { anchor, info };
  }
  if (m.target?.service && m.target.ingress) {
    const anchor = `ing:${m.target.service}/${m.target.ingress}`, info = store.markOf(anchor);
    if (info?.mark === 'new') return { anchor, info };
  }
  return null;
}

/** Without a marks store (a harvested environment, an empty design) a step's own flag is still drawn. */
export const stepMarksOnly = { store: null, head: () => null, fold: () => null, arrow: (m) => { const r = arrowMark(null, m); return r ? { ...r, inDraft: false } : null; } };

/** The marks adapter the lane drawing asks. */
export function laneMarks(store) {
  if (!store || store.empty) return null;
  const head = (col) => { // the highest mark of its anchors: new, else changed
    const hits = headAnchors(col).map((a) => ({ anchor: a, info: store.markOf(a) })).filter((x) => x.info && x.info.mark !== 'removed');
    const r = hits.find((x) => x.info.mark === 'new') ?? hits[0];
    return r ? { anchor: r.anchor, info: r.info, inDraft: !!store.inDraft?.(r.anchor) } : null;
  };
  return {
    store, head,
    fold: (cols) => { const hits = cols.map(head).filter(Boolean); return hits.find((r) => r.info.mark === 'new') ?? hits[0] ?? null; }, // #122: a fold box shows the highest mark of the lanes it hides
    arrow: (m) => { const r = arrowMark(store, m); return r && r.info.mark !== 'removed' ? { ...r, inDraft: !r.step && !!store.inDraft?.(r.anchor) } : null; },
  };
}

/** The distinct services a flow's trace touches (for the "removed" list under the diagram). */
export const servicesOf = (trace) => [...new Set((trace?.participants ?? []).filter((p) => p.kind === 'service' && p.service).map((p) => p.service))];
