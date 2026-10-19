// Deterministic mock system for testing views at scale.
// generateMock({services: 100}) ≈ 100 services, ~2,000 endpoints, ~500 queues, gateways with glob routes,
// SNS→SQS fan-out (incl. a wildcard subscriber), RabbitMQ topic bindings, shared caches,
// and a realistic sprinkle of broken links (dangling calls, unbound topics/queues).

import { DOMAINS, LANGS, NOUNS, SUFFIXES, EVENTS } from './vocab.ts';

export interface MockOptions { services?: number; seed?: number; env?: string }

function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return {
    next,
    int: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}

interface Svc { m: any; domain: string; name: string; fnSeq: number; egSeq: number }

export function generateMock(opts: MockOptions = {}): any[] {
  const n = opts.services ?? 100;
  const env = opts.env ?? 'default';
  const R = rng(opts.seed ?? 1);
  const T = '2026-10-19T08:00:00Z';
  const svcs: Svc[] = [];

  // ---- services, endpoints, functions ----
  for (let i = 0; svcs.length < n; i++) {
    const domain = DOMAINS[i % DOMAINS.length];
    const suffix = SUFFIXES[Math.floor(i / DOMAINS.length) % SUFFIXES.length];
    const name = `${domain}${suffix}`;
    if (svcs.some((s) => s.name === name)) break;
    const m: any = {
      schemaVersion: '1.0', kind: 'full', env,
      service: { name, kind: 'service', team: domain, repo: `github.com/acme/${name}`, language: R.pick(LANGS), tags: [suffix.slice(1)] },
      version: R.int(1, 60), harvestedAt: T, commit: (i * 2654435761 >>> 0).toString(16).slice(0, 7),
      functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [],
    };
    const s: Svc = { m, domain, name, fnSeq: 0, egSeq: 0 };
    svcs.push(s);

    // own store + shared cache
    const store = R.pick(['mongodb', 'dynamodb', 'postgres'] as const);
    m.resources.push({ id: 'db', kind: store, name: `${name}-db`, bindKey: `${store}:${name}-db` });
    if (R.chance(0.6)) m.resources.push({ id: 'cache', kind: 'redis', name: `cache-${domain.length % 3}`, bindKey: `redis:cache-${domain.length % 3}` });

    const nouns = NOUNS[domain] ?? ['item'];
    const endpoints = R.int(10, 30);
    for (let e = 0; e < endpoints; e++) {
      const noun = nouns[e % nouns.length];
      const variant = Math.floor(e / nouns.length);
      const [method, path] = ([
        ['GET', `/${noun}s`], ['GET', `/${noun}s/{id}`], ['POST', `/${noun}s`], ['PUT', `/${noun}s/{id}`],
        ['DELETE', `/${noun}s/{id}`], ['GET', `/${noun}s/{id}/history`], ['POST', `/${noun}s/{id}/actions/sync`],
      ] as const)[variant % 7];
      const fid = `${noun}Controller.${method.toLowerCase()}${variant}`;
      if (m.ingress.some((x: any) => x.id === `in.${fid}` || x.bindKey === `http:${method} ${name}${path}`)) continue;
      const svcFn = `${noun}Service.${['load', 'save', 'apply', 'validate'][variant % 4]}`;
      if (!m.functions.some((f: any) => f.id === svcFn)) {
        const steps: any[] = [];
        if (m.resources.some((r: any) => r.id === 'cache') && method === 'GET') steps.push({ type: 'resource', target: 'cache', operation: `GET ${noun}:{id}` });
        steps.push({ type: 'resource', target: 'db', operation: method === 'GET' ? 'read' : 'write', condition: steps.length ? 'cache miss' : undefined });
        m.functions.push({ id: svcFn, name: svcFn, file: `src/${noun}/service.${ext(m.service.language)}`, line: R.int(10, 400), steps });
      }
      m.functions.push({ id: fid, name: fid, file: `src/${noun}/controller.${ext(m.service.language)}`, line: R.int(5, 300), steps: [{ type: 'call', target: svcFn }] });
      m.ingress.push({
        id: `in.${fid}`, bindKey: `http:${method} ${name}${path}`, transport: 'http', handler: fid,
        details: { method, path, public: R.chance(0.45) },
      });
    }
  }

  const allIngress = svcs.flatMap((s) => s.m.ingress.map((i: any) => ({ s, i })));
  const called = new Set<string>();
  const addEgress = (s: Svc, eg: any, fromFn: any, step: any) => {
    const id = eg.id ?? `out.${s.egSeq++}`;
    if (!s.m.egress.some((e: any) => e.id === id)) s.m.egress.push({ ...eg, id });
    fromFn.steps.push({ ...step, type: 'egress', target: id });
  };
  const serviceFns = (s: Svc) => s.m.functions.filter((f: any) => f.id.includes('Service.'));

  // ---- service-to-service REST ----
  const internal = allIngress.filter((x: any) => !x.i.details.public);
  for (const s of svcs.filter((x) => x.m.service.kind === 'service')) {
    const fns = serviceFns(s);
    if (!fns.length) continue;
    for (let k = R.int(3, 12); k > 0; k--) {
      const fromFn = R.pick(fns);
      if (R.chance(0.03)) { // dangling: a route that does not exist
        addEgress(s, { bindKey: `http:GET ${R.pick(svcs).name}/legacy/${R.pick(EVENTS)}`, transport: 'http', mode: 'sync' }, fromFn, {});
        continue;
      }
      const fresh = internal.filter((x: any) => x.s !== s && !called.has(x.i.bindKey));
      const t = fresh.length && R.chance(0.8) ? R.pick(fresh) : R.pick(internal.filter((x: any) => x.s !== s));
      called.add(t.i.bindKey);
      addEgress(s, { bindKey: t.i.bindKey, transport: 'http', mode: 'sync', details: { timeoutMs: R.pick([1000, 2000, 5000]) } }, fromFn, { operation: t.i.details.method });
    }
    if (R.chance(0.15)) { // call through the public gateway (matched by its glob route)
      const t = R.pick(allIngress.filter((x: any) => x.i.details.public && x.s !== s));
      addEgress(s, { bindKey: `http:${t.i.details.method} public/api/${t.s.domain}${t.i.details.path}`, transport: 'http', mode: 'sync' }, R.pick(fns), { note: 'via public gateway' });
    }
  }

  // ---- gateways: glob routes per domain, literal egress per public endpoint ----
  for (const gw of ['public-gateway', 'partner-gateway'].slice(0, n >= 40 ? 2 : 1)) {
    const m: any = {
      schemaVersion: '1.0', kind: 'full', env, service: { name: gw, kind: 'gateway', team: 'platform', language: 'go', tags: ['edge'] },
      version: R.int(10, 40), harvestedAt: T, functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [],
    };
    const g: Svc = { m, domain: 'platform', name: gw, fnSeq: 0, egSeq: 0 };
    const host = gw === 'public-gateway' ? 'public' : 'partner';
    for (const d of new Set(svcs.map((s) => s.domain))) {
      const fn = { id: `route.${d}`, name: `route /api/${d}/**`, file: `routes/${d}.go`, line: 1, steps: [] as any[] };
      m.functions.push(fn);
      m.ingress.push({ id: `in.${d}`, bindKey: `http:* ${host}/api/${d}/**`, match: 'glob', transport: 'http', handler: fn.id, entryPoint: true });
      for (const { s, i } of allIngress.filter((x: any) => x.s.domain === d && (x.i.details.public || (!called.has(x.i.bindKey) && R.chance(0.85))) && (host === 'public' || R.chance(0.3)))) {
        addEgress(g, { id: `to.${s.name}.${i.id}`, bindKey: i.bindKey, transport: 'http', mode: 'sync' }, fn, { operation: i.details.method });
        called.add(i.bindKey);
      }
    }
    svcs.push(g);
  }

  // ---- events: SNS topics with SQS subscribers ----
  const infra: any = {
    schemaVersion: '1.0', kind: 'full', env, service: { name: 'infra', kind: 'infra', team: 'platform' },
    version: 1, harvestedAt: T, channels: [],
  };
  const topics: { key: string; owner: Svc }[] = [];
  const producers = svcs.filter((x) => x.m.service.kind === 'service' && !x.name.endsWith('-reporting'));
  for (const s of producers) {
    for (let k = R.int(1, 3); k > 0; k--) {
      const key = `sns:${s.domain}-${R.pick(EVENTS)}-events`;
      if (topics.some((t) => t.key === key)) continue;
      topics.push({ key, owner: s });
      infra.channels.push({ bindKey: key, kind: 'sns-topic', name: key.slice(4) });
      addEgress(s, { bindKey: key, transport: 'sns', mode: 'async', delivery: 'multicast' }, R.pick(serviceFns(s)), { mode: 'async', operation: 'publish' });
    }
  }
  const consumers = svcs.filter((x) => x.m.service.kind === 'service');
  const targetQueues = Math.round(n * 5);
  for (let q = 0; q < targetQueues; q++) {
    const c = R.pick(consumers);
    const t = R.pick(topics);
    if (t.owner === c) continue;
    const qkey = `sqs:${c.name}-${t.key.slice(4)}`;
    if (c.m.channels.some((x: any) => x.bindKey === qkey)) continue;
    c.m.channels.push({ bindKey: qkey, kind: 'sqs-queue', name: qkey.slice(4) });
    const unconsumed = R.chance(0.01);
    if (!unconsumed) {
      const fid = `on${cap(t.key.slice(4).replace(/-events$/, '').replace(/-./g, (x) => x[1].toUpperCase()))}`;
      if (!c.m.functions.some((f: any) => f.id === fid)) {
        c.m.functions.push({ id: fid, name: fid, file: `src/consumers/${fid}.${ext(c.m.service.language)}`, line: 1, steps: [{ type: 'call', target: R.pick(serviceFns(c)).id }] });
      }
      c.m.ingress.push({ id: `in.${qkey.slice(4)}`, bindKey: qkey, transport: 'sqs', handler: fid });
    }
    if (!R.chance(0.01)) c.m.bindings.push({ id: `sub.${qkey.slice(4)}`, from: t.key, to: qkey });
  }
  // a few topics nobody subscribes to (unbound), plus a wildcard subscriber
  topics.slice(0, 3).forEach((t, k) => {
    const key = `sns:${t.owner.domain}-orphaned-${k}-feed`;
    infra.channels.push({ bindKey: key, kind: 'sns-topic', name: key.slice(4) });
    addEgress(t.owner, { bindKey: key, transport: 'sns', mode: 'async' }, R.pick(serviceFns(t.owner)), { mode: 'async', operation: 'publish' });
  });
  const lake = svcs.find((s) => s.domain === 'analytics' && s.m.service.kind === 'service');
  if (lake) {
    lake.m.channels.push({ bindKey: 'sqs:analytics-firehose', kind: 'sqs-queue', name: 'analytics-firehose' });
    lake.m.functions.push({ id: 'ingestAny', name: 'ingestAny', file: 'src/firehose.py', line: 1, steps: [{ type: 'resource', target: 'db', operation: 'append' }] });
    lake.m.ingress.push({ id: 'in.firehose', bindKey: 'sqs:analytics-firehose', transport: 'sqs', handler: 'ingestAny' });
    lake.m.bindings.push({ id: 'sub.firehose', from: 'sns:*-events', match: 'glob', to: 'sqs:analytics-firehose' });
  }

  // ---- RabbitMQ: a topic exchange per a few domains, glob bindings ----
  for (const s of producers.filter((_, k) => k % 9 === 0)) {
    const ex = `amqp:${s.domain}`;
    infra.channels.push({ bindKey: ex, kind: 'amqp-exchange', name: s.domain, details: { type: 'topic' } });
    const ev = R.pick(EVENTS);
    addEgress(s, { bindKey: `${ex}/${s.domain}.${ev}`, transport: 'amqp', mode: 'async', delivery: 'multicast' }, R.pick(serviceFns(s)), { mode: 'async', operation: 'publish' });
    const c = R.pick(consumers.filter((x) => x !== s));
    const qkey = `amqp-queue:${c.name}-${s.domain}`;
    if (c.m.channels.some((x: any) => x.bindKey === qkey)) continue;
    c.m.channels.push({ bindKey: qkey, kind: 'amqp-queue', name: qkey.slice(11) });
    c.m.bindings.push({ id: `bind.${s.domain}`, from: `${ex}/${s.domain}.*`, match: 'glob', to: qkey });
    const fid = `on${cap(s.domain)}Message`;
    c.m.functions.push({ id: fid, name: fid, file: 'src/amqp.ts', line: 1, steps: [{ type: 'call', target: R.pick(serviceFns(c)).id }] });
    c.m.ingress.push({ id: `in.amqp.${s.domain}`, bindKey: qkey, transport: 'amqp', handler: fid });
  }

  // ---- entry points: crons and webhooks on workers; mark uncalled public routes ----
  for (const s of svcs.filter((x) => x.name.endsWith('-worker'))) {
    s.m.functions.push({ id: 'nightlyJob', name: 'nightlyJob', file: 'src/jobs.ts', line: 1, steps: [{ type: 'call', target: R.pick(serviceFns(s)).id }] });
    s.m.ingress.push({ id: 'cron.nightly', bindKey: `cron:${s.name}/nightly`, transport: 'cron', handler: 'nightlyJob', entryPoint: true });
  }

  // number steps, drop undefined fields
  for (const s of svcs) for (const f of s.m.functions) f.steps = f.steps.map((st: any, k: number) => clean({ seq: k + 1, ...st }));
  return [infra, ...svcs.map((s) => s.m)];
}

const cap = (x: string) => x[0].toUpperCase() + x.slice(1);
const ext = (lang: string) => ({ typescript: 'ts', python: 'py', go: 'go', java: 'java', kotlin: 'kt' } as Record<string, string>)[lang] ?? 'ts';
const clean = (o: any) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
