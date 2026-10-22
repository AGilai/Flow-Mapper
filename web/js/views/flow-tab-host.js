// The host a tab view is built with (0.36.0). The page's own host serves the tabs of the page's env. A tab of another env gets a derived one: that env's
// data (descriptions, names, marks, subsystems, traces), read only (no pencils, no forms) and everything it opens (a flow, the info pane) stays in its env.
//   const { hostFor, penRO } = createHostFor(host, { drillIn(spec, env), openIn(spec, env), paneIn(target, env) });   hostFor(ctx) -> the host for that env's tabs

import { pencils } from '../design/pencil.js';
import { setEnv } from '../state.js';

export function createHostFor(host, { drillIn, openIn, paneIn }) {
  const cache = new Map(), penRO = pencils({ readOnly: true });
  function hostFor(ctx) {
    if (!ctx.foreign) return host;
    if (!cache.has(ctx.env)) {
      cache.set(ctx.env, { ...host, env: ctx.env, marks: ctx.marks, subs: ctx.subs, design: ctx.design, desc: ctx.desc, nameOf: ctx.nameOf, traceFor: ctx.data.traceFor, describe: ctx.data.describe, readOnly: true, edit: null, pen: penRO,
        switchEnv: () => setEnv(ctx.env), openEntry: (e) => drillIn(e, ctx.env), openFlow: (e) => openIn(e, ctx.env), openPane: (t) => paneIn(t, ctx.env) });
    }
    return cache.get(ctx.env);
  }
  return { hostFor, penRO };
}
