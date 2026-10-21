// A flow's name and description as a reader sees them: the stored ones, with what an open draft's flow op says laid over them.
// One rule for the server's draft reader and the static preview.

export interface FlowText { name?: string; description?: string }

/** A field the op sets wins; '' clears it; a field the op does not mention comes from `base`. */
export function overlayText(op: FlowText | undefined, base: FlowText | null | undefined): FlowText | null {
  const pick = (mine: string | undefined, theirs: string | undefined) => (mine === undefined ? theirs : mine.trim() || undefined);
  const name = pick(op?.name, base?.name), description = pick(op?.description, base?.description);
  return name || description ? { ...(name ? { name } : {}), ...(description ? { description } : {}) } : null;
}

/** Entry points with their flow's `name` and `summary` (first 140 characters of its description) where set; with `refs` also
 *  `reference: true` (the entry itself is a reference) and `partial: n` (references its flow reaches, from `reached`). */
export function decorateEntries<E extends { service: string; id: string }>(
  entries: E[], texts: Map<string, FlowText>, refs?: { endpoints: Record<string, unknown> }, reached?: Map<string, number>,
) {
  return entries.map((e) => {
    const t = texts.get(`${e.service}/${e.id}`), n = reached?.get(`${e.service}:${e.id}`), summary = t?.description?.trim().slice(0, 140);
    return { ...e, ...(t?.name ? { name: t.name } : {}), ...(summary ? { summary } : {}),
      ...(refs?.endpoints[`ing:${e.service}/${e.id}`] ? { reference: true } : {}), ...(n ? { partial: n } : {}) };
  });
}
