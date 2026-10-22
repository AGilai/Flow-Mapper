// What a flow tab needs from its own environment (0.36.0): its traces, flow descriptions, flow names, marks, subsystems and services. Tabs of different
// environments sit side by side, so none of it may come from "the page's env" (`state.env`). `createEnvCtx` builds one context per env, lazily, and the
// page's own env is seeded with what the page loaded already. A context of another env reads its committed state (no draft, see api.js `withDraft`).
//   const ctxs = createEnvCtx(() => opts);  ctxs.seed(state.env, { names, marks, subs });
//   const ctx = ctxs.get('sase-hld');       // at once: { env, data, desc, nameOf, foreign, design, meta, marks|null, subs|null }
//   await ctx.ready;                        // names, marks and subsystems are there (never rejects)

import { api } from '../api.js';
import { state, isDesign } from '../state.js';
import { metaOf } from '../env-info.js';
import { loadMarks } from '../design/marks-store.js';
import { loadSubsystems } from '../design/subsystems-store.js';
import { setServiceInfo } from '../design/service-info.js';
import { createTabData } from './flow-tab-data.js';
import { createDescStore } from './flow-desc.js';

/** getOpts() -> the page's trace options ({ frontier }), shared by every env's traces. */
export function createEnvCtx(getOpts) {
  const cache = new Map();
  function make(env, seed = null) {
    const names = seed?.names ?? new Map(), nameOf = (service, ingress) => names.get(`${service}/${ingress}`) ?? '';
    const ctx = { env, names, nameOf, foreign: env !== state.env, design: isDesign(env), meta: metaOf(state.envMeta, env), data: createTabData(env, getOpts, nameOf), desc: createDescStore(env), marks: seed?.marks ?? null, subs: seed?.subs ?? null };
    ctx.ready = seed ? Promise.resolve(ctx) : Promise.all([api.flowNames(env).catch(() => []), loadMarks(env), loadSubsystems(env), api.services(env).catch(() => [])]).then(([list, marks, subs, svcs]) => {
      for (const n of list) names.set(`${n.service}/${n.ingress}`, n.name);
      ctx.marks = marks; ctx.subs = subs;
      setServiceInfo(svcs, env); // runtimes and kinds of this env's components, for the heads of its diagrams
      return ctx;
    });
    return ctx;
  }
  return {
    get: (env) => { if (!cache.has(env)) cache.set(env, make(env)); return cache.get(env); },
    /** The page's own env: what the page loaded already (names: Map `service/ingress` -> name, marks, subs). */
    seed: (env, parts) => { cache.set(env, make(env, parts)); },
    /** Every trace is stale (the frontier option changed). */
    clearData: () => cache.forEach((c) => c.data.clear()),
  };
}
