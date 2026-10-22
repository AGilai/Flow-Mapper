// What the flow page knows of each component beyond the trace: its runtime (#49: `details.runtime`), read once from `GET /services`.
// A lifeline head asks `runtimeFor(service)`; `runtimeSvg` draws the small Kubernetes mark (a heptagon outline, not a brand logo).

import { s } from '../dom.js';
import { SVG_PATH } from '../icons.js';
import { RUNTIME_NAMES, runtimeOf } from '../components/ext-links.js';

const info = new Map(); // env ('' = the page's own, for callers that name none) -> { kinds, runtimes }
/** Remember the runtime of every component in a `GET /services` list of `env` (0.36.0: tabs of two envs side by side each read their own). */
export const setServiceInfo = (list, env = '') => { info.set(env, { kinds: new Map((list ?? []).map((x) => [x.name, x.kind])), runtimes: new Map((list ?? []).map((x) => [x.name, runtimeOf(x)]).filter(([, r]) => r)) }); };
/** The kind (service, gateway, lambda…) of a component: the trace carries it only in a design environment, so a prod diagram asks here (0.27.3, product icons). */
export const kindFor = (service, env = '') => info.get(env ?? '')?.kinds.get(service) ?? null;
export const runtimeFor = (service, env = '') => info.get(env ?? '')?.runtimes.get(service) ?? null;

/** The mark as an SVG group at (x, y), `size` px square, tooltip = the runtime's name. */
export function runtimeSvg(runtime, x, y, size = 13) {
  if (!RUNTIME_NAMES[runtime]) return null;
  const g = s('g', { class: 'rtg', transform: `translate(${x},${y}) scale(${size / 24})` }, s('title', {}, RUNTIME_NAMES[runtime]));
  const body = s('g');
  body.innerHTML = SVG_PATH.k8s;
  g.append(body);
  return g;
}
