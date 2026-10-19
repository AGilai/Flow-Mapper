// Contract report: what a harvester's manifest leaves out or cannot link, so the harvester can fix
// its data before filing a bug. Pure; never a rejection. See docs/HARVESTER-GUIDE.md ("Contract report").
// Add a check by writing a `Rule` and listing it in RULES; give it a new code and a one-sentence fix.

import type { GraphIndex } from './graph-index.ts';
import { filterAllows, keyMatches } from './glob.ts';
import { drift, mixedCommits } from './harvest-quality.ts';
import type { Source, Unresolved } from './types.ts';

export type Level = 'error' | 'warn' | 'info';
export interface Finding {
  level: Level; code: string; service: string;
  kind: 'ingress' | 'egress' | 'step' | 'binding' | 'channel' | 'service';
  id: string; message: string; fix: string;
}
export interface ContractReport { errors: number; warnings: number; infos: number; findings: Finding[] }

/** One service's entities as stored (before placeholder bind keys are filled in). */
export interface ServiceManifest {
  service: string;
  functions?: { id: string; file?: string; steps?: { seq: number; type: string; target?: string; unresolved?: Unresolved[] }[] }[];
  ingress?: { id: string; bindKey?: string; source?: Source; unresolved?: Unresolved[] }[];
  egress?: { id: string; bindKey?: string; transport: string; events?: string[]; source?: Source; unresolved?: Unresolved[] }[];
  bindings?: { id: string; from: string; match?: 'exact' | 'glob'; events?: '*' | string[]; source?: Source }[];
}
interface Ctx { m: ServiceManifest; g: GraphIndex; add: (f: Omit<Finding, 'service'>) => void }
type Rule = (c: Ctx) => void;

const blank = (s: string | undefined) => s !== undefined && !s.trim();
const sample = (ids: string[]) => ids.slice(0, 3).join(', ') + (ids.length > 3 ? `, +${ids.length - 3} more` : '');
const FANOUT = new Set(['sns-topic', 'eventbridge-bus']);

const unresolvedNoDetail: Rule = ({ m, add }) => {
  const check = (kind: 'ingress' | 'egress' | 'step', id: string, list?: Unresolved[]) => {
    for (const u of list ?? []) if (blank(u.reason) || blank(u.detail)) add({
      level: 'warn', code: 'unresolved-no-detail', kind, id,
      message: `${kind} '${id}' has an unresolved (${u.what}) entry with an empty ${blank(u.reason) ? 'reason' : 'detail'}`,
      fix: 'Fill reason with a short code (e.g. dynamic_dispatch) and detail with the expression you could not resolve.',
    });
  };
  for (const i of m.ingress ?? []) check('ingress', i.id, i.unresolved);
  for (const e of m.egress ?? []) check('egress', e.id, e.unresolved);
  for (const f of m.functions ?? []) for (const s of f.steps ?? []) check('step', `${f.id}#${s.seq}`, s.unresolved);
};

const missingSource: Rule = ({ m, add }) => {
  const ids = [
    ...(m.ingress ?? []).filter((i) => !i.source?.file).map((i) => `ingress ${i.id}`),
    ...(m.egress ?? []).filter((e) => !e.source?.file).map((e) => `egress ${e.id}`),
    // steps carry no source of their own: they point at their function's file
    ...(m.functions ?? []).filter((f) => !f.file && f.steps?.length).flatMap((f) => f.steps!.map((s) => `step ${f.id}#${s.seq}`)),
  ];
  if (ids.length) add({
    level: 'info', code: 'missing-source', kind: 'service', id: m.service,
    message: `${ids.length} ingress, egress or step item(s) have no source.file (${sample(ids)})`,
    fix: 'Send source: {file, line} on every ingress and egress, and file on every function, so the UI can link to the code.',
  });
};

const bindingNoEvents: Rule = ({ m, g, add }) => {
  for (const b of m.bindings ?? []) {
    const ch = g.channels.get(b.from);
    if (b.events === undefined && ch && FANOUT.has(ch.kind)) add({
      level: 'info', code: 'binding-no-events', kind: 'binding', id: b.id,
      message: `subscription '${b.id}' on ${b.from} has no events, so every event type is delivered`,
      fix: `Send events: ["TypeA", ...] from the subscription's filter policy or rule pattern, or events: "*" if it really takes everything.`,
    });
  }
};

const bindingEmptyEvents: Rule = ({ m, add }) => {
  for (const b of m.bindings ?? []) if (Array.isArray(b.events) && !b.events.length) add({
    level: 'warn', code: 'binding-empty-events', kind: 'binding', id: b.id,
    message: `subscription '${b.id}' has events: [], which delivers nothing`,
    fix: 'Send the event types the subscription lets through, or omit events (or send "*") if it takes everything.',
  });
};

const egressNoEvents: Rule = ({ m, g, add }) => {
  for (const e of m.egress ?? []) {
    const ch = e.bindKey ? g.channels.get(e.bindKey) : undefined;
    const fanout = ch ? FANOUT.has(ch.kind) : e.transport === 'sns' || e.transport === 'eventbridge';
    if (fanout && !e.events?.length && !e.unresolved?.some((u) => u.what === 'event')) add({
      level: 'warn', code: 'egress-no-events', kind: 'egress', id: e.id,
      message: `egress '${e.id}' publishes to ${e.bindKey} without event types, so subscribers' filters cannot be applied`,
      fix: 'Send events: ["TypeA", ...] for what this publish sends, or unresolved: [{what: "event", reason, candidates}] if you cannot tell.',
    });
  }
};

const dangling: Rule = ({ m, g, add }) => {
  for (const e of g.resolution.dangling) if (e.service === m.service) add({
    level: 'warn', code: 'dangling-egress', kind: 'egress', id: e.id,
    message: `egress '${e.id}' (${e.bindKey}) matches no ingress or channel in env '${g.model.env}'`,
    fix: "Check the bindKey spelling against the callee's ingress or the declared channel; if the target is not harvested yet, ignore this.",
  });
};

const filterMatchesNothing: Rule = ({ m, g, add }) => {
  for (const b of m.bindings ?? []) {
    if (!Array.isArray(b.events) || !b.events.length) continue;
    const published = g.model.egress.filter((e) => keyMatches(b.from, b.match, e.bindKey))
      .flatMap((e) => [...(e.events ?? []), ...(e.unresolved ?? []).flatMap((u) => (u.what === 'event' ? u.candidates ?? [] : []))]);
    if (published.length && !published.some((t) => filterAllows(b.events as string[], t))) add({
      level: 'warn', code: 'filter-matches-nothing', kind: 'binding', id: b.id,
      message: `subscription '${b.id}' filters on [${b.events.join(', ')}] but ${b.from} only receives [${[...new Set(published)].join(', ')}]`,
      fix: "Correct the subscription's events (or the publisher's egress events) so at least one published type passes.",
    });
  }
};

const KINDS = new Set(['ingress', 'egress', 'binding', 'channel']);
const harvestQuality: Rule = ({ m, g, add }) => {
  for (const x of mixedCommits(g)) if (x.service === m.service) add({
    level: 'info', code: 'mixed-commit', kind: 'service', id: m.service,
    message: `items were scanned at other commits than the manifest's: ${x.others.map((o) => `${o.commit} (${o.items})`).join(', ')}`,
    fix: "Scan every item at the commit you send in the manifest, or set source.commit on the items that differ.",
  });
  for (const d of drift(g)) if (d.service === m.service) add({
    level: 'info', code: 'drift', kind: KINDS.has(d.kind) ? (d.kind as Finding['kind']) : 'service', id: d.id,
    message: `${d.kind} '${d.id}' was checked against the live system and differs (provenance.verified: drift)`,
    fix: 'Align the code and the deployed system, or re-run the live check; Flow-Mapper keeps what you sent.',
  });
};

export const RULES: Rule[] = [unresolvedNoDetail, missingSource, bindingNoEvents, bindingEmptyEvents, egressNoEvents, dangling, filterMatchesNothing, harvestQuality];

/** `m`: the service's entities as stored; `g`: the env's index after applying them. */
export function contractReport(m: ServiceManifest, g: GraphIndex): ContractReport {
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, 'service'>) => { findings.push({ ...f, service: m.service }); };
  for (const rule of RULES) rule({ m, g, add });
  const n = (l: Level) => findings.filter((f) => f.level === l).length;
  return { errors: n('error'), warnings: n('warn'), infos: n('info'), findings };
}
