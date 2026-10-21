// Canvas renderer for the system map: pan/zoom, hover, select, focus highlight,
// collision-aware labels and team "districts". Canvas (not SVG) so ~1,000 nodes and
// ~3,000 edges stay smooth. Colours come from CSS tokens.

import { drawNode, readTheme } from './graph-style.js';
import { drawDistricts, drawEdges } from './graph-draw-edges.js';
import { drawLabels } from './graph-draw-labels.js';
import { nodeAt, edgeAt } from './graph-hit.js';
import { iconImage } from '../components/object-icon.js';
import { createMarkLayer } from './graph-marks.js';

export function createCanvasGraph(host, { onSelect, onHover, marks = null } = {}) {
  const markLayer = marks ? createMarkLayer(marks) : null;
  const canvas = document.createElement('canvas');
  canvas.className = 'graph-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'System map. Use the search box or the services list for keyboard access.');
  host.append(canvas);
  const ctx = canvas.getContext('2d');

  let nodes = [], edges = [], pos = new Map(), byId = new Map(), degree = new Map();
  let visible = null, edgeOk = null, highlight = null, selected = null, hovered = null, groups = [];
  let k = 1, tx = 0, ty = 0, w = 0, hgt = 0, dpr = 1;
  let theme = readTheme();
  let raf = 0;
  let pendingFit = null;
  let hoverSet = null; // neighbours of the hovered node, shown while hovering

  const toScreen = (p) => [p.x * k + tx, p.y * k + ty];
  const toWorld = (sx, sy) => [(sx - tx) / k, (sy - ty) / k];
  const isVis = (id) => !visible || visible.has(id);
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
  // Map node → object icon (null until loaded, or when the object has none).
  const iconFor = (n) => (n.kind === 'channel' ? iconImage('channel', n.sub, schedule)
    : n.kind === 'resource' ? iconImage('store', n.sub, schedule)
    : n.kind === 'gateway' || n.svcKind === 'lambda' ? iconImage('service', n.svcKind ?? n.kind, schedule) : null);

  function resize() {
    const r = host.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    w = r.width; hgt = r.height;
    canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, hgt * dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${hgt}px`;
    if (pendingFit && w) { const f = pendingFit; pendingFit = null; fit(f.ids); }
    schedule();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => { theme = readTheme(); schedule(); };
  mq.addEventListener('change', onTheme);

  // The state the drawing and hit-testing modules read, as a snapshot of the closure at call time.
  const view = () => ({ nodes, edges, pos, byId, degree, visible, edgeOk, highlight, selected, hovered, hoverSet, groups, k, w, hgt, theme, isVis, toScreen, toWorld });

  function draw() {
    raf = 0;
    const S = view();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const focus = hoverSet ?? highlight;
    const dimmed = (id) => focus && !focus.has(id);

    drawDistricts(ctx, S);
    drawEdges(ctx, S, focus, dimmed);

    // Nodes.
    const order = nodes.filter((n) => isVis(n.id));
    for (const n of order) drawNode(ctx, n, toScreen(pos.get(n.id)), k, degree, theme, {
      dim: dimmed(n.id), selected: selected === n.id, hovered: hovered === n.id, img: iconFor(n),
    });

    drawLabels(ctx, S, order, focus, dimmed);
    if (markLayer?.draw(ctx, S, order, dimmed)) schedule(); // the twinkle runs a moment
  }

  // ---- interaction ----
  let drag = null;
  const pointers = new Map();
  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, [ev.offsetX, ev.offsetY]);
    drag = { x: ev.offsetX, y: ev.offsetY, tx, ty, moved: false, dist: pinchDist() };
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, [ev.offsetX, ev.offsetY]);
    if (drag && pointers.size === 2) {
      const d = pinchDist();
      if (drag.dist) zoomAt(w / 2, hgt / 2, d / drag.dist);
      drag.dist = d; drag.moved = true;
      return;
    }
    if (drag) {
      const dx = ev.offsetX - drag.x, dy = ev.offsetY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      tx = drag.tx + dx; ty = drag.ty + dy;
      schedule();
      return;
    }
    const n = nodeAt(view(), ev.offsetX, ev.offsetY);
    const id = n?.id ?? null;
    canvas.style.cursor = n || edgeAt(view(), ev.offsetX, ev.offsetY) ? 'pointer' : 'grab';
    if (id !== hovered) {
      hovered = id;
      hoverSet = null;
      if (n && !highlight) { hoverSet = new Set([id]); for (const e of edges) { if (e.from === id) hoverSet.add(e.to); if (e.to === id) hoverSet.add(e.from); } }
      onHover?.(n); schedule();
    }
  });
  const end = (ev) => {
    pointers.delete(ev.pointerId);
    if (drag && !drag.moved && pointers.size === 0) {
      const n = nodeAt(view(), ev.offsetX, ev.offsetY);
      if (n) onSelect?.({ type: 'node', item: n });
      else { const e = edgeAt(view(), ev.offsetX, ev.offsetY); onSelect?.(e ? { type: 'edge', item: e } : null); }
    }
    if (pointers.size === 0) drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); zoomAt(ev.offsetX, ev.offsetY, Math.exp(-ev.deltaY * 0.0015)); }, { passive: false });
  function pinchDist() { const p = [...pointers.values()]; return p.length === 2 ? Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) : 0; }
  function zoomAt(sx, sy, f) {
    const nk = Math.max(0.08, Math.min(6, k * f));
    tx = sx - ((sx - tx) * nk) / k; ty = sy - ((sy - ty) * nk) / k; k = nk;
    schedule();
  }

  function fit(ids) {
    const pts = (ids ? [...ids] : nodes.filter((n) => isVis(n.id)).map((n) => n.id)).map((id) => pos.get(id)).filter(Boolean);
    if (!w) { pendingFit = { ids }; return; }
    if (!pts.length) return;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 60;
    k = Math.min(2.2, Math.min((w - pad * 2) / Math.max(1, maxX - minX), (hgt - pad * 2) / Math.max(1, maxY - minY)));
    tx = w / 2 - ((minX + maxX) / 2) * k; ty = hgt / 2 - ((minY + maxY) / 2) * k;
    schedule();
  }

  return {
    setData(d) {
      nodes = d.nodes; edges = d.edges; pos = d.positions;
      byId = new Map(nodes.map((n) => [n.id, n]));
      degree = new Map();
      for (const e of edges) { degree.set(e.from, (degree.get(e.from) ?? 0) + 1); degree.set(e.to, (degree.get(e.to) ?? 0) + 1); }
      this.updateGroups();
      schedule();
    },
    updateGroups() {
      const m = new Map();
      for (const n of nodes) {
        if (!n.team || !isVis(n.id)) continue;
        const p = pos.get(n.id);
        if (!m.has(n.team)) m.set(n.team, []);
        m.get(n.team).push(p);
      }
      groups = [...m].filter(([, ps]) => ps.length > 1).map(([name, ps]) => {
        const x = ps.reduce((a, p) => a + p.x, 0) / ps.length, y = ps.reduce((a, p) => a + p.y, 0) / ps.length;
        return { name, x, y, size: ps.length };
      });
    },
    setVisible(set) { visible = set; this.updateGroups(); schedule(); },
    setEdgeFilter(fn) { edgeOk = fn; schedule(); },
    setHighlight(set) { highlight = set; schedule(); },
    select(id) { selected = id; schedule(); },
    fit,
    zoomTo(id) { const p = pos.get(id); if (!p) return; k = Math.max(k, 1.6); tx = w / 2 - p.x * k; ty = hgt / 2 - p.y * k; schedule(); },
    zoomBy(f) { zoomAt(w / 2, hgt / 2, f); },
    degreeOf: (id) => degree.get(id) ?? 0,
    dispose() { ro.disconnect(); mq.removeEventListener('change', onTheme); cancelAnimationFrame(raf); },
  };
}
