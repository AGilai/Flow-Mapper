// Inline stroke icons (24px grid). icon('name') returns an <svg>.

const P = {
  system: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.3 6.6l7.3.4M7.3 8.2l3.6 7.6M16.7 9.3l-3.5 6.7"/>',
  services: '<rect x="3.5" y="4" width="17" height="6" rx="1.5"/><rect x="3.5" y="14" width="17" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  flow: '<path d="M6 3v18M18 3v18"/><path d="M6 8h10l-2-2M18 14H8l2 2"/>',
  health: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 7V4M9 4.5l1.5 2.5M15 4.5L13.5 7M3 13h4M17 13h4M4 8l3 2M20 8l-3 2M4 19l3-2M20 19l-3-2"/>',
  chev: '<path d="M15 6l-6 6 6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>',
  commit: '<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>',
  rpc: '<path d="M3 8h17M16 4l4 4-4 4M21 16H4M8 12l-4 4 4 4"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  k8s: '<path d="M12 2.6l7.6 3.6 1.9 8.2-5.3 6.6H7.8l-5.3-6.6 1.9-8.2z"/><path d="M12 8.2v4M12 12.2l3.2 2M12 12.2l-3.2 2"/>',
  comment: '<path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H11l-4.5 3.5v-3.5h-2a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/>',
  action: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8.2 12.2l2.6 2.6 5-5.4"/>',
  ul: '<path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20"/><path d="M4.6 6.5h.01M4.6 12h.01M4.6 17.5h.01" stroke-width="2.6"/>',
  ol: '<path d="M10 6.5h10M10 12h10M10 17.5h10M4.5 5l1.5-1v5M4.2 14.5c.4-.9 2.3-.9 2.3.3 0 1-2.4 1.6-2.4 2.9h2.6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  table: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 10h17M3.5 14.5h17M9.2 5v14M14.8 5v14"/>',
  more: '<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="2.8"/>',
  warn: '<path d="M12 4 21 20H3z"/><path d="M12 10v4.5M12 17.4h.01"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

/** Status-mark glyphs on a 12px grid: a 4-point star (New) and a ring with a dot (Changed). Shapes, not hues, tell them apart from a warning. */
export const GLYPH = {
  new: { d: 'M6 .6L7.5 4.5 11.4 6 7.5 7.5 6 11.4 4.5 7.5.6 6 4.5 4.5z', fill: true },
  chg: { d: 'M6 1.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8zM6 2.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4zM6 4.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z', fill: false },
};

/** Lock (a reference) and the Kubernetes mark on a 24px grid, for drawings: `<g>` paths, drawn with the surrounding stroke. */
export const SVG_PATH = { lock: P.lock, k8s: P.k8s };

/** The six subsystem icons (0.28.1, frame 12c): simple 16px line icons, drawn with the surrounding stroke (`--ink-2`). The names are core/subsystems.ts SUBSYSTEM_ICONS. */
export const SS_PATH = {
  platform: '<path d="M8 2l6 3-6 3-6-3z"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3"/>',
  agent: '<rect x="3" y="3" width="10" height="7" rx="1"/><path d="M1.5 13h13M6.5 10v3M9.5 10v3"/>',
  network: '<circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="2.6" ry="6"/><path d="M2 8h12"/>',
  cloud: '<path d="M4.5 12.5a3 3 0 0 1-.3-6 4 4 0 0 1 7.7 1A2.6 2.6 0 0 1 11.5 12.5z"/>',
  shield: '<path d="M8 1.8l5 1.8v4c0 3-2.2 5-5 6.4C5.2 12.6 3 10.6 3 7.6v-4z"/><path d="M5.8 8l1.5 1.5L10.3 6.5"/>',
  database: '<ellipse cx="8" cy="3.6" rx="5" ry="2"/><path d="M3 3.6v8.8c0 1.1 2.2 2 5 2s5-.9 5-2V3.6M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>',
};
export const SS_NAMES = Object.keys(SS_PATH);

/** A subsystem icon as an <svg> (HTML pages and panels); null when the name is not one of the six. `size` px. */
export function subIcon(name, size = 16) {
  if (!Object.hasOwn(SS_PATH, name)) return null;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 16 16', width: size, height: size, fill: 'none', 'stroke-width': 1.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ss-icon' })) el.setAttribute(k, v);
  el.innerHTML = SS_PATH[name];
  return el;
}

export function icon(name, cls = '') {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', '18');
  el.setAttribute('height', '18');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.7');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  if (cls) el.setAttribute('class', cls);
  el.innerHTML = P[name] ?? '';
  return el;
}

/** Brand mark (same as web/favicon.svg): two lifelines with a call and its return (option D). */
export function brandMark() {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 32 32');
  el.setAttribute('class', 'brand-mark');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<rect width="32" height="32" rx="7" fill="var(--accent)"/>
    <path d="M8 6v20M24 6v20" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
    <path d="M12.5 12h8M17.5 8.5l3.5 3.5-3.5 3.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M19.5 21h-8M14.5 17.5L11 21l3.5 3.5" fill="none" stroke="#8ff0df" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  return el;
}
