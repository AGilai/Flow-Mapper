// What the flow page knows of each component beyond the trace: its runtime (#49: `details.runtime`), read once from `GET /services`.
// A lifeline head asks `runtimeFor(service)`; `runtimeSvg` draws the small Kubernetes mark (a heptagon outline, not a brand logo).

import { s } from '../dom.js';
import { SVG_PATH } from '../icons.js';
import { RUNTIME_NAMES, runtimeOf } from '../components/ext-links.js';

let runtimes = new Map();
/** Remember the runtime of every component in a `GET /services` list. */
export const setServiceInfo = (list) => { runtimes = new Map((list ?? []).map((x) => [x.name, runtimeOf(x)]).filter(([, r]) => r)); };
export const runtimeFor = (service) => runtimes.get(service) ?? null;

/** The mark as an SVG group at (x, y), `size` px square, tooltip = the runtime's name. */
export function runtimeSvg(runtime, x, y, size = 13) {
  if (!RUNTIME_NAMES[runtime]) return null;
  const g = s('g', { class: 'rtg', transform: `translate(${x},${y}) scale(${size / 24})` }, s('title', {}, RUNTIME_NAMES[runtime]));
  const body = s('g');
  body.innerHTML = SVG_PATH.k8s;
  g.append(body);
  return g;
}
