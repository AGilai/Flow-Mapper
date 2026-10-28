// #85 incomplete flows: the texts, pure (docs/plans/incomplete-flows.md section 4). No DOM, no core imports, so node tests load it.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** The badge text: `incomplete · 3 blocked`, or just `incomplete` when the harvester knows the flow is incomplete but not where (n = 0). */
export const badgeText = (n) => (n > 0 ? `incomplete · ${n} blocked` : 'incomplete');
export const badgeLabel = (n, { button = false } = {}) => (n > 0 ? `Incomplete: ${plural(n, 'blocked call', 'blocked calls')} not followed${button ? '. Show why incomplete' : ''}` : 'Incomplete flow');

/** The list row's tooltip: the count is the entry's own service only. */
export const listTip = (n, service) => (n > 0
  ? `Incomplete flow. ${plural(n, 'call', 'calls')} in ${service} could not be followed, so part of this flow is not drawn. Open the flow for the full count across services.`
  : 'Incomplete flow. The harvester reports it as incomplete.');
/** The header's tooltip; `source` 'coverage' is the fallback (no step of the trace carries a `gap`). */
export const headTip = (n, source, service) => `Incomplete flow. ${plural(n, 'call', 'calls')} could not be followed, so part of this flow is not drawn: the harvester could not tell what they call. ${source === 'coverage' ? `Counted for ${service} only.` : 'Counted across every service on this trace, folded frontier steps included.'} Select to see why.`;

/** The frontier marker: `frontier: 6 steps`, `frontier: 1 step`, with `· 2 blocked` appended when some are blocked. */
export const frontierParts = (k, m = 0) => ({ base: `frontier: ${plural(k, 'step', 'steps')}`, blocked: m > 0 ? ` · ${m} blocked` : '' });
export const frontierText = (k, m = 0) => { const p = frontierParts(k, m); return p.base + p.blocked; };

/** Line 2 of a blocked step: `blocked: <plain>`; without `plain` the reason, and without both `target not resolved`. */
export const blockedWhy = (site, gap) => site?.plain || gap?.plain || site?.reason || gap?.reason || 'target not resolved';
export const blockedLine = (site, gap) => `blocked: ${blockedWhy(site, gap)}`;
/** Line 1: the code text, else the label, else the function name. */
export const blockedCall = (site, label) => site?.call || label || site?.fn || '';

/** A site's heading in "Why incomplete": the plain reason, capitalised; the machine code goes beside it. */
export const siteTitle = (s) => cap(s.plain || s.reason || 'target not resolved');
export const siteCode = (s) => (s.plain && s.reason ? s.reason : '');
export const sitePlace = (s) => (s.file ? `${s.file}${s.line ? `:${s.line}` : ''}` : '');

/** #96: a notBlocked entry's heading: its label, else the package. */
export const nbTitle = (e) => e.label || e.plain || e.package || 'Not a gap';

/** Sites grouped by service when they span more than one: [{ service, sites }] (service '' = one flat group). */
export function siteGroups(sites) {
  const services = [...new Set(sites.map((s) => s.service))];
  return services.length > 1 ? services.map((service) => ({ service, sites: sites.filter((s) => s.service === service) })) : [{ service: '', sites }];
}

/** The status line under the filters. */
export const filterStatus = (k, t) => `${k} of ${t} flows are incomplete`;

/** The "LLM inferred" provenance (reserved, ask 5): a step or edge whose `provenance.kind` is 'llm'. Nothing sends it yet. */
export const isInferred = (x) => x?.provenance?.kind === 'llm';
export const INFERRED_TAG = 'inferred (LLM)';
export const INFERRED_TIP = 'Inferred by a model from code context, not proven by a call in the code.';
