// #85 incomplete flows: the texts, pure (docs/plans/incomplete-flows.md section 4). No DOM, no core imports, so node tests load it.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** #135: the chip text, neutral: `3 open ends`, `1 open end`; `open ends` alone when the harvester knows the flow is incomplete but not where (n = 0). */
export const badgeText = (n) => (n > 0 ? plural(n, 'open end', 'open ends') : 'open ends');
export const badgeLabel = (n, { button = false } = {}) => (n > 0 ? `${plural(n, 'open end', 'open ends')}: calls not followed${button ? '. Show them' : ''}` : 'Open ends: the harvester reports where it could not follow a call');
/** The header chip: `5 open ends \u00b7 6 in called services`; with none in the flow's own service `6 open ends in called services`. */
export const headText = (own, called = 0) => (own > 0 ? plural(own, 'open end', 'open ends') + (called > 0 ? ` \u00b7 ${called} in called services` : '') : called > 0 ? `${plural(called, 'open end', 'open ends')} in called services` : 'open ends');
export const headLabel = (own, called = 0) => `${headText(own, called)}. Show them`;
/** "N of M flows fully traced (P%)" over the Flows list; nothing when there are no flows. */
export const tracedText = (total, incomplete) => (total > 0 ? `${total - incomplete} of ${total} flows fully traced (${Math.round(((total - incomplete) / total) * 100)}%)` : '');

/** The list row's tooltip: the count is the entry's own service only. */
export const listTip = (n, service) => (n > 0
  ? `${plural(n, 'call', 'calls')} in ${service} could not be followed, so part of this flow is not drawn. Open the flow for the ones in called services.`
  : 'The harvester reports this flow as not fully traced.');
/** The header's tooltip; `source` 'coverage' is the fallback (no step of the trace carries a `gap`). */
export const headTip = (own, called, source, service) => `${source === 'coverage' ? `${plural(own, 'call', 'calls')} in ${service} could not be followed (the entry point's coverage report; called services may add more).` : `${plural(own, 'call', 'calls')} in ${service} could not be followed${called > 0 ? `, and ${called} in the services it calls` : ''}.`} Open ends are calls the harvester could not resolve, so what they reach is not drawn. Select to list them.`;

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
export const filterStatus = (k, t) => `${k} of ${t} flows have open ends`;

/** The "LLM inferred" provenance (reserved, ask 5): a step or edge whose `provenance.kind` is 'llm'. Nothing sends it yet. */
export const isInferred = (x) => x?.provenance?.kind === 'llm';
export const INFERRED_TAG = 'inferred (LLM)';
export const INFERRED_TIP = 'Inferred by a model from code context, not proven by a call in the code.';
