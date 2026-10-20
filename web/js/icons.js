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
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

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

/** Brand mark: three stations on two lines. */
export function brandMark() {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 28 28');
  el.setAttribute('class', 'brand-mark');
  el.innerHTML = `<path d="M5 8h9a5 5 0 0 1 5 5v7" stroke="var(--t-http)" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M5 20h6a5 5 0 0 0 5-5V8" stroke="var(--t-sqs)" stroke-width="3" fill="none" stroke-linecap="round" opacity=".9"/>
    <circle cx="5" cy="8" r="3" fill="var(--surface)" stroke="var(--ink)" stroke-width="2"/>
    <circle cx="19" cy="20" r="3" fill="var(--surface)" stroke="var(--ink)" stroke-width="2"/>
    <circle cx="5" cy="20" r="3" fill="var(--surface)" stroke="var(--ink)" stroke-width="2"/>`;
  return el;
}
