// Validates sample manifests against the schema, checks internal references,
// resolves bind keys across services, and prints link-health stats.
// This is a throwaway prototype of the resolver described in docs/DESIGN.md §3 and §5.
//
// Usage: node scripts/check-samples.mjs [samplesDir]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const dir = process.argv[2] ?? join(root, 'samples');
const schema = JSON.parse(readFileSync(join(root, 'schema/manifest.schema.json'), 'utf8'));

// Schema validation needs ajv (`npm install`); without it the resolver checks still run.
let ajv, validate;
try {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const { default: addFormats } = await import('ajv-formats');
  ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  validate = ajv.compile(schema);
} catch {
  console.warn('! ajv not installed — skipping schema validation (run npm install)');
  validate = () => true;
  ajv = { errorsText: () => '' };
}

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
let failed = false;
const fail = (msg) => { failed = true; console.error('  ✗ ' + msg); };

// ---------- load + validate ----------
const snapshots = new Map(); // service name -> full manifest
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const m = load(join(dir, f));
  if (!validate(m)) { fail(`${f}: ${ajv.errorsText(validate.errors)}`); continue; }
  snapshots.set(m.service.name, m);
}
const deltaDir = join(dir, 'deltas');
const deltas = existsSync(deltaDir)
  ? readdirSync(deltaDir).filter((f) => f.endsWith('.json')).sort().map((f) => {
      const d = load(join(deltaDir, f));
      if (!validate(d)) fail(`deltas/${f}: ${ajv.errorsText(validate.errors)}`);
      return d;
    })
  : [];
console.log(`Schema: ${snapshots.size} manifests, ${deltas.length} delta(s) validated`);

// ---------- delta apply ----------
const LISTS = ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings'];
const keyOf = (list, e) => (list === 'channels' ? e.bindKey : e.id);
function applyDelta(d) {
  const cur = snapshots.get(d.service.name);
  if (!cur) throw new Error(`delta for unknown service ${d.service.name}`);
  if (cur.version !== d.baseVersion) throw new Error(`VERSION_MISMATCH: have ${cur.version}, delta base ${d.baseVersion}`);
  if (d.version <= cur.version) throw new Error('version must increase');
  const next = structuredClone(cur);
  for (const list of LISTS) {
    let items = next[list] ?? [];
    const del = new Set(d.delete?.[list] ?? []);
    items = items.filter((e) => !del.has(keyOf(list, e)));
    for (const u of d.upsert?.[list] ?? []) {
      const i = items.findIndex((e) => keyOf(list, e) === keyOf(list, u));
      if (i >= 0) items[i] = u; else items.push(u);
    }
    next[list] = items;
  }
  Object.assign(next, { version: d.version, harvestedAt: d.harvestedAt, commit: d.commit });
  snapshots.set(d.service.name, next);
}

// ---------- matching ----------
const globRe = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');
const matches = (pattern, match, key) => (match === 'glob' ? globRe(pattern).test(key) : pattern === key);
// higher is more specific: exact beats glob; fewer wildcards, then longer literal prefix
const specificity = (pattern, match) => match !== 'glob' ? [1, 0, pattern.length]
  : [0, -(pattern.match(/\*+/g) ?? []).length, pattern.split('*')[0].length];
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const DEFAULT_DELIVERY = { http: 'unicast', grpc: 'unicast', sqs: 'unicast', sns: 'multicast', amqp: 'multicast' };

function report(title) {
  console.log(`\n=== ${title} ===`);
  const all = [...snapshots.values()];
  const ingress = all.flatMap((m) => (m.ingress ?? []).map((e) => ({ ...e, svc: m.service.name })));
  const egress = all.flatMap((m) => (m.egress ?? []).map((e) => ({ ...e, svc: m.service.name })));
  const channels = new Map(all.flatMap((m) => (m.channels ?? []).map((c) => [c.bindKey, c])));
  const bindings = all.flatMap((m) => (m.bindings ?? []).map((b) => ({ ...b, svc: m.service.name })));

  // internal reference integrity
  for (const m of all) {
    const fns = new Set((m.functions ?? []).map((f) => f.id));
    const egs = new Set((m.egress ?? []).map((e) => e.id));
    const rs = new Set((m.resources ?? []).map((r) => r.id));
    for (const i of m.ingress ?? []) if (!fns.has(i.handler)) fail(`${m.service.name}: ingress ${i.id} handler ${i.handler} missing`);
    for (const f of m.functions ?? []) for (const s of f.steps ?? []) {
      const ok = s.type === 'call' ? fns.has(s.target) : s.type === 'egress' ? egs.has(s.target) : rs.has(s.target);
      if (!ok) fail(`${m.service.name}: ${f.id} step ${s.seq} → missing ${s.type} ${s.target}`);
    }
  }

  const hitIngress = new Set();
  const links = [];
  const dangling = [], ambiguous = [];
  const ingressFor = (key, delivery) => {
    const cands = ingress.filter((i) => matches(i.bindKey, i.match, key));
    if (delivery === 'multicast' || cands.length <= 1) return { picked: cands, tie: false };
    const ranked = cands.map((c) => [specificity(c.bindKey, c.match), c]).sort((a, b) => cmp(b[0], a[0]));
    const tie = cmp(ranked[0][0], ranked[1][0]) === 0;
    return { picked: [ranked[0][1]], tie };
  };
  const bindingsFrom = (key) => bindings.filter((b) => matches(b.from, b.match, key));

  for (const e of egress) {
    const delivery = e.delivery ?? DEFAULT_DELIVERY[e.transport] ?? 'unicast';
    const { picked, tie } = ingressFor(e.bindKey, delivery);
    if (tie) ambiguous.push(e);
    picked.forEach((i) => { hitIngress.add(i); links.push([`${e.svc}:${e.id}`, `${i.svc}:${i.id}`, 'key']); });
    const viaBind = bindingsFrom(e.bindKey);
    viaBind.forEach((b) => links.push([`${e.svc}:${e.id}`, b.to, `binding ${b.svc}:${b.id}`]));
    if (!picked.length && !viaBind.length && !channels.has(e.bindKey)) dangling.push(e);
    else if (!picked.length && !viaBind.length) dangling.push({ ...e, note: 'channel has no subscription' });
  }
  const brokenBindings = [];
  for (const b of bindings) {
    const consumers = ingress.filter((i) => matches(i.bindKey, i.match, b.to));
    consumers.forEach((i) => hitIngress.add(i));
    if (!consumers.length) brokenBindings.push(b);
  }

  const unbound = [];
  for (const [key, c] of channels) {
    if (c.kind === 'sns-topic' && !bindingsFrom(key).length) unbound.push(`${key} (topic without subscription)`);
    if ((c.kind === 'sqs-queue' || c.kind === 'amqp-queue') && !ingress.some((i) => matches(i.bindKey, i.match, key)))
      unbound.push(`${key} (queue without consumer)`);
    if (c.kind === 'amqp-exchange' && !bindings.some((b) => b.from.startsWith(key + '/'))) unbound.push(`${key} (exchange without binding)`);
  }
  const orphans = ingress.filter((i) => !i.entryPoint && !hitIngress.has(i));

  console.log(`Links resolved: ${links.length}`);
  for (const [a, b, why] of links) console.log(`  ${a}  →  ${b}   [${why}]`);
  const show = (label, arr, f) => { console.log(`${label}: ${arr.length}`); arr.forEach((x) => console.log('  • ' + f(x))); };
  show('Dangling egress', dangling, (e) => `${e.svc}:${e.id}  ${e.bindKey}${e.note ? '  — ' + e.note : ''}`);
  show('Orphan ingress', orphans, (i) => `${i.svc}:${i.id}  ${i.bindKey}`);
  show('Unbound channels', unbound, (x) => x);
  show('Bindings to nothing', brokenBindings, (b) => `${b.svc}:${b.id}  ${b.from} → ${b.to}`);
  show('Ambiguous unicast', ambiguous, (e) => `${e.svc}:${e.id}  ${e.bindKey}`);
  console.log('Coverage by service (resolved egress / total):');
  for (const m of all) {
    const total = (m.egress ?? []).length;
    if (!total) continue;
    const bad = dangling.filter((d) => d.svc === m.service.name).length;
    console.log(`  ${m.service.name.padEnd(18)} v${String(m.version).padEnd(4)} ${total - bad}/${total}`);
  }
}

report('Baseline (full manifests)');
for (const d of deltas) {
  try { applyDelta(d); report(`After delta ${d.service.name} v${d.baseVersion} → v${d.version}`); }
  catch (err) { fail(err.message); }
}
// a stale delta must be rejected
if (deltas.length) {
  try { applyDelta(deltas[0]); fail('stale delta was accepted'); }
  catch (err) { console.log(`\nStale delta correctly rejected: ${err.message}`); }
}
process.exit(failed ? 1 : 0);
