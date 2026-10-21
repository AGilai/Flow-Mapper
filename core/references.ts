// References: a copied endpoint whose behaviour (handler and call tree) is not in the design. One definition for the server, the
// preview and the UI. An ingress row of a design environment is a reference iff
//   (a) it has an origin: a baseline row for it (the design copied or imported it from a source env), or an import op in the draft being read
//       (a function's origin counts for `origins` below: an endpoint whose handler was imported later reads as imported),
//   (b) it names at least one handler (its own or an event consumer's), and
//   (c) none of those handlers is a function of its service in the rows being read.
// A design-made endpoint with a dangling handler is not a reference: it is "not designed yet". Sealed environments have no origins.

import { rowId, type ItemRow } from './item-rows.ts';

export interface Origin { sourceEnv: string; takenAt: string; inDraft?: boolean }
export interface RefEndpoint { service: string; ingress: string; bindKey: string; source: string }
export interface EnvRefs {
  /** 'ing:<s>/<id>' -> a reference. */
  endpoints: Record<string, RefEndpoint>;
  /** 'svc:<s>' with at least one reference endpoint: how many, out of how many endpoints. */
  components: Record<string, { refs: number; endpoints: number }>;
  /** 'ing:<s>/<id>' that has an origin and is not a reference (its behaviour came from a source). imported = taken after the env was copied. */
  origins: Record<string, { from: string; at: string; imported: boolean; inDraft?: true }>;
}
export interface OriginInput { service: string; list: string; key: string; sourceEnv: string; takenAt: string }

/** Ingress and function rows that came from another environment: the baseline's, overridden by the rows a draft's import ops bring (`inDraft`). */
export function originsOf(base: OriginInput[], draftBase: OriginInput[] = []): Map<string, Origin> {
  const out = new Map<string, Origin>();
  for (const r of base) if (r.list === 'ingress' || r.list === 'functions') out.set(rowId(r), { sourceEnv: r.sourceEnv, takenAt: r.takenAt });
  for (const r of draftBase) if (r.list === 'ingress' || r.list === 'functions') out.set(rowId(r), { sourceEnv: r.sourceEnv, takenAt: r.takenAt, inDraft: true });
  return out;
}

/** The handler function ids an ingress names: its own and its event consumers'. */
export const handlersOf = (i: { handler?: string; events?: { handler?: string }[] }): string[] =>
  [i.handler, ...(i.events ?? []).map((e) => e.handler)].filter((h): h is string => !!h);

export function referencesOf(cur: ItemRow[], origins: Map<string, Origin>, copiedAt: string | null): EnvRefs {
  const fns = new Map<string, Set<string>>(), count = new Map<string, number>();
  for (const r of cur) {
    if (r.list === 'functions') { let s = fns.get(r.service); if (!s) fns.set(r.service, (s = new Set())); s.add(r.key); }
    else if (r.list === 'ingress') count.set(r.service, (count.get(r.service) ?? 0) + 1);
  }
  const hasFn = (service: string, id: string) => !!fns.get(service)?.has(id);
  const out: EnvRefs = { endpoints: {}, components: {}, origins: {} };
  for (const r of cur) {
    if (r.list !== 'ingress') continue;
    const o = origins.get(rowId(r));
    if (!o) continue;
    const anchor = `ing:${r.service}/${r.key}`, hs = handlersOf(r.data ?? {});
    if (hs.length && !hs.some((h) => hasFn(r.service, h))) {
      out.endpoints[anchor] = { service: r.service, ingress: r.key, bindKey: r.data?.bindKey ?? '', source: o.sourceEnv };
      const c = out.components[`svc:${r.service}`] ??= { refs: 0, endpoints: count.get(r.service) ?? 0 };
      c.refs++;
    } else {
      // behaviour imported after the copy (its handler came in by an import) makes the endpoint "imported", whatever its own row says
      const later = hs.map((h) => origins.get(rowId({ service: r.service, list: 'functions', key: h }))).find((f) => f && f.takenAt !== copiedAt);
      const x = later ?? o;
      out.origins[anchor] = { from: x.sourceEnv, at: x.takenAt, imported: x.takenAt !== copiedAt, ...(x.inDraft ? { inDraft: true as const } : {}) };
    }
  }
  return out;
}
