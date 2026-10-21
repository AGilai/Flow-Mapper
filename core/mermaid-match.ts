// Match the participants of a Mermaid diagram to the components of a design (0.27.2). Pure.
// Order: exact name (the id, or the `as` label), normalized (case, - _ space, a -svc / service suffix), close spelling (Levenshtein <= 2,
// only when one component is that close), then a name that only the source environment has ("in prod": never imported by itself).

export type How = 'exact' | 'alias' | 'normalized' | 'similar' | 'in-prod' | 'none' | 'actor' | 'infra';
export interface MatchRow { id: string; label: string; actor: boolean; match: string | null; how: How; candidates: string[]; /** how: 'in-prod': the source's component of that name. */ source?: string; note?: string }
/** What the user (or an agent) decided for a participant: use a component, create one, copy it from the source (one level), leave it the entry client, or skip it (a channel or data store). */
export type MatchChoice = { component: string } | { create: true; name?: string } | { fromSource: true } | { client: true } | { skip: true };

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const normalize = (s: string) => { const k = s.toLowerCase().replace(/[-_\s.]+/g, ''); return k.replace(/(service|svc)$/, '') || k; };
/** A component name from what the diagram calls a participant (`Policy Engine` -> `policy-engine`). */
export const componentName = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '') || 'component';
export const validName = (s: string) => NAME.test(s);

export function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function find(forms: string[], names: string[]): { name: string; how: 'exact' | 'alias' | 'normalized' } | null {
  const [id, label] = forms;
  const hit = (v: string) => names.find((n) => n === v);
  if (hit(id)) return { name: id, how: 'exact' };
  if (label && hit(label)) return { name: label, how: id === label ? 'exact' : 'alias' };
  const keys = new Map(names.map((n) => [normalize(n), n]));
  for (const f of forms) { const n = keys.get(normalize(f)); if (n) return { name: n, how: 'normalized' }; }
  return null;
}

/** A lifeline the exporter writes for a channel (`sns:order-events`) or a data store (`orders-db.orders`, `user:{id}`): not a component. */
export const looksInfra = (s: string) => /^[A-Za-z][\w-]*:\S/.test(s) || /[{}]/.test(s) || /^[\w-]+\.[\w.-]+$/.test(s);

export function matchParticipants(parts: { id: string; label: string; actor: boolean }[], here: string[], source: string[] = []): MatchRow[] {
  const sourceOnly = source.filter((n) => !here.includes(n));
  return parts.map((p) => {
    const forms = [p.id, p.label].filter((v, i, a) => v && a.indexOf(v) === i);
    const row = (r: Partial<MatchRow>): MatchRow => ({ id: p.id, label: p.label, actor: p.actor, match: null, how: 'none', candidates: [], ...r });
    const long = forms.filter((f) => normalize(f).length >= 4);   // a one-letter id says nothing about spelling
    const near = (names: string[]) => (long.length ? names.map((n) => ({ n, d: Math.min(...long.map((f) => distance(normalize(f), normalize(n)))) })).filter((x) => x.d <= 3 && normalize(x.n).length >= 3).sort((a, b) => a.d - b.d) : []);
    const close = near(here), candidates = close.map((x) => x.n).slice(0, 5);
    const hitHere = find(forms, here);
    if (!hitHere && forms.some(looksInfra)) return row({ how: 'infra', note: 'looks like a channel or data store, not a component: skipped' });
    if (hitHere) return row({ match: hitHere.name, how: hitHere.how, candidates });
    const within = close.filter((x) => x.d <= 2);
    if (within.length === 1 || (within.length > 1 && within[0].d < within[1].d)) return row({ match: within[0].n, how: 'similar', candidates, note: `${within[0].d} edit${within[0].d === 1 ? '' : 's'} from '${within[0].n}' after normalizing: check it` });
    const hitSrc = find(forms, sourceOnly);
    if (hitSrc) return row({ how: 'in-prod', source: hitSrc.name, candidates });
    return row({ how: p.actor ? 'actor' : 'none', candidates });
  });
}

/** The default choice per participant: what matched; an actor with no match is the entry client; the rest are created (a source-only name too: copying it is a choice). */
export function defaultChoices(rows: MatchRow[]): Record<string, MatchChoice> {
  return Object.fromEntries(rows.map((r) => [r.id, r.match ? { component: r.match } : r.how === 'actor' ? { client: true } : r.how === 'infra' ? { skip: true } : { create: true, name: componentName(r.source ?? r.label) }]));
}

/** One value of the `matches` an API takes (a plain string is a component name); null when it makes no sense. */
export function readChoice(v: unknown): MatchChoice | null {
  if (typeof v === 'string' && v) return { component: v };
  const o = v as any;
  if (!o || typeof o !== 'object') return null;
  if (typeof o.component === 'string' && o.component) return { component: o.component };
  if (o.create === true) return typeof o.name === 'string' && o.name ? { create: true, name: o.name } : { create: true };
  if (o.fromSource === true) return { fromSource: true };
  if (o.client === true) return { client: true };
  if (o.skip === true) return { skip: true };
  return null;
}
