// Links (#54) and the runtime mark (#49), shared by the service page, the flow header and the lifeline head.
// `links` = { main?: {label, url}, sub?: [{label, url}] } (0.25.1; absent on older servers: nothing is drawn). Only http(s) URLs become links; they open in a
// new tab with rel="noopener". `runtime` = k8s-pod | k8s-deployment | k8s-daemonset | k8s-operator | k8s-job.

import { h } from '../dom.js';
import { icon } from '../icons.js';

const safe = (l) => !!l && typeof l.url === 'string' && /^https?:\/\//i.test(l.url);
const anchor = (cls, l, ...kids) => h(`a.${cls}`, { href: l.url, target: '_blank', rel: 'noopener noreferrer', title: `${l.label || l.url} (opens in a new tab)` }, ...kids);

/** The main link as text with an ↗, or null. */
export const mainLink = (links) => (safe(links?.main) ? anchor('ext-main', links.main, links.main.label || links.main.url, ' ', icon('external', 'ext-i')) : null);

/** The sub links as small chips with an ↗, or null. */
export function subChips(links) {
  const subs = (links?.sub ?? []).filter(safe);
  return subs.length ? h('span.ext-chips', subs.map((l) => anchor('ext-chip', l, l.label || l.url, icon('external', 'ext-i')))) : null;
}

/** Main link and sub chips together (one node or null). */
export function linksRow(links) {
  const a = mainLink(links), b = subChips(links);
  return a || b ? h('span.row', { style: { gap: 'var(--s3)', flexWrap: 'wrap' } }, a, b) : null;
}

export const RUNTIME_NAMES = { 'k8s-pod': 'Kubernetes pod', 'k8s-deployment': 'Kubernetes deployment', 'k8s-daemonset': 'Kubernetes daemonset', 'k8s-operator': 'Kubernetes operator', 'k8s-job': 'Kubernetes job' };

/** The runtime of a service header (`details.runtime`, or `runtime`), when it is one we know; else null. */
export const runtimeOf = (header) => { const r = header?.details?.runtime ?? header?.runtime; return RUNTIME_NAMES[r] ? r : null; };

/** The small Kubernetes glyph (a heptagon outline, not a brand logo) with the runtime's name as its tooltip. */
export const runtimeGlyph = (runtime) => (RUNTIME_NAMES[runtime] ? h('span.runtime-glyph', { title: RUNTIME_NAMES[runtime], role: 'img', 'aria-label': RUNTIME_NAMES[runtime] }, icon('k8s')) : null);
