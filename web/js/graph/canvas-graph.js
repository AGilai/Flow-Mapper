// Canvas renderer for the system map: pan/zoom, hover, select, focus highlight,
// collision-aware labels and team "districts". Canvas (not SVG) so ~1,000 nodes and
// ~3,000 edges stay smooth. Colours come from CSS tokens.

import { drawNode, nodeRadius, edgeStyle, readTheme } from './graph-style.js';
import { iconImage } from '../components/object-icon.js';

export function createCanvasGraph(host, { onSelect, onHover } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'graph-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'System map. Use the search box or the services list for keyboard access.');
  host.append(canvas);
  const ctx = canvas.getContext('2d');

  let nodes = [], edges = [], pos = new Map(), byId = new Map(), degree = new Map();
  let visible = null, highlight = null, selected = null, hovered = null, groups = [];
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

  function draw() {
    raf = 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const focus = hoverSet ?? highlight;
    const dimmed = (id) => focus && !focus.has(id);

    // Team districts: label at the centroid when zoomed out.
    if (k < 1.1) {
      ctx.font = `600 ${Math.max(12, 15 * Math.min(1, k * 1.4))}px ${theme.font}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = theme.district;
      const used = [];
      for (const g of [...groups].sort((a, b) => b.size - a.size)) {
        const [sx, sy] = toScreen(g);
        const tw = ctx.measureText(g.name).width;
        const box = [sx - tw / 2 - 6, sy - 10, tw + 12, 20];
        if (used.some((b) => box[0] < b[0] + b[2] && box[0] + box[2] > b[0] && box[1] < b[1] + b[3] && box[1] + box[3] > b[1])) continue;
        used.push(box);
        ctx.fillText(g.name, sx, sy);
      }
    }

    // Edges, batched by style. Quieter as the map gets denser.
    const density = Math.max(0, Math.min(1, 1 - (edges.length - 60) / 600));
    const batches = new Map();
    for (const e of edges) {
      if (!isVis(e.from) || !isVis(e.to)) continue;
      // With a centre (hovered/selected node), only its own edges are in focus.
      const center = hoverSet ? hovered : highlight && selected && highlight.has(selected) ? selected : null;
      const inFocus = focus && (center ? e.from === center || e.to === center : !dimmed(e.from) && !dimmed(e.to));
      const st = edgeStyle(e, theme, {
        dim: !!focus && !inFocus, focused: !!inFocus, selected: selected === e.id,
        gateway: byId.get(e.from)?.kind === 'gateway' || byId.get(e.to)?.kind === 'gateway', density,
      });
      const key = `${st.color}|${st.dash}|${st.alpha}|${st.width}`;
      if (!batches.has(key)) batches.set(key, { st, list: [] });
      batches.get(key).list.push(e);
    }
    for (const { st, list } of batches.values()) {
      ctx.strokeStyle = st.color; ctx.globalAlpha = st.alpha; ctx.lineWidth = st.width;
      ctx.setLineDash(st.dash ? [4, 3] : []);
      ctx.beginPath();
      for (const e of list) {
        const [ax, ay] = toScreen(pos.get(e.from)), [bx, by] = toScreen(pos.get(e.to));
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        if (k > 1.15) { // arrowhead at the target's edge
          const r = nodeRadius(byId.get(e.to), degree) * Math.max(0.5, Math.min(k, 1.25)) + 2;
          const ang = Math.atan2(by - ay, bx - ax), ex = bx - Math.cos(ang) * r, ey = by - Math.sin(ang) * r;
          ctx.moveTo(ex - Math.cos(ang - 0.4) * 6, ey - Math.sin(ang - 0.4) * 6); ctx.lineTo(ex, ey);
          ctx.lineTo(ex - Math.cos(ang + 0.4) * 6, ey - Math.sin(ang + 0.4) * 6);
        }
      }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // Nodes.
    const order = nodes.filter((n) => isVis(n.id));
    for (const n of order) drawNode(ctx, n, toScreen(pos.get(n.id)), k, degree, theme, {
      dim: dimmed(n.id), selected: selected === n.id, hovered: hovered === n.id, img: iconFor(n),
    });

    // Labels: most important first, skip any that would overlap one already drawn.
    const placed = [];
    const ranked = order
      .map((n) => ({ n, score: (selected === n.id ? 1e6 : 0) + (hovered === n.id ? 1e5 : 0) + (focus?.has(n.id) ? 1e4 : 0) + (degree.get(n.id) ?? 0) + (n.kind === 'gateway' ? 50 : 0) }))
      .sort((a, b) => b.score - a.score);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const { n, score } of ranked) {
      if (dimmed(n.id)) continue;
      const r = nodeRadius(n, degree) * Math.max(0.5, Math.min(k, 1.25));
      const important = score >= 1e4 || (n.kind !== 'channel' && n.kind !== 'resource') ;
      if (!important && k < 1.6) continue;
      if (placed.length > 160) break;
      const [sx, sy] = toScreen(pos.get(n.id));
      if (sx < -50 || sy < -20 || sx > w + 50 || sy > hgt + 20) continue;
      ctx.font = `${n.kind === 'channel' || n.kind === 'resource' ? 400 : 600} ${n.kind === 'channel' || n.kind === 'resource' ? 11 : 12}px ${theme.font}`;
      const tw = ctx.measureText(n.label).width;
      const box = [sx + r + 4, sy - 8, tw + 4, 16];
      if (placed.some((b) => box[0] < b[0] + b[2] && box[0] + box[2] > b[0] && box[1] < b[1] + b[3] && box[1] + box[3] > b[1])) continue;
      placed.push(box);
      ctx.fillStyle = theme.halo;
      ctx.fillRect(box[0] - 1, box[1] + 1, box[2], box[3] - 2);
      ctx.fillStyle = n.kind === 'missing' ? theme.broken : theme.ink;
      ctx.fillText(n.label, box[0] + 1, sy);
    }
  }

  // ---- hit testing ----
  function nodeAt(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    let best = null, bd = Infinity;
    for (const n of nodes) {
      if (!isVis(n.id)) continue;
      const p = pos.get(n.id), r = nodeRadius(n, degree) + 4 / k;
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < r && d < bd) { best = n; bd = d; }
    }
    return best;
  }
  function edgeAt(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    const tol = 5 / k;
    let best = null, bd = tol;
    for (const e of edges) {
      if (!isVis(e.from) || !isVis(e.to) || (highlight && (!highlight.has(e.from) || !highlight.has(e.to)))) continue;
      const a = pos.get(e.from), b = pos.get(e.to);
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / l2));
      const d = Math.hypot(a.x + t * dx - wx, a.y + t * dy - wy);
      if (d < bd) { best = e; bd = d; }
    }
    return best;
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
    const n = nodeAt(ev.offsetX, ev.offsetY);
    const id = n?.id ?? null;
    canvas.style.cursor = n || edgeAt(ev.offsetX, ev.offsetY) ? 'pointer' : 'grab';
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
      const n = nodeAt(ev.offsetX, ev.offsetY);
      if (n) onSelect?.({ type: 'node', item: n });
      else { const e = edgeAt(ev.offsetX, ev.offsetY); onSelect?.(e ? { type: 'edge', item: e } : null); }
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
    setHighlight(set) { highlight = set; schedule(); },
    select(id) { selected = id; schedule(); },
    fit,
    zoomTo(id) { const p = pos.get(id); if (!p) return; k = Math.max(k, 1.6); tx = w / 2 - p.x * k; ty = hgt / 2 - p.y * k; schedule(); },
    zoomBy(f) { zoomAt(w / 2, hgt / 2, f); },
    degreeOf: (id) => degree.get(id) ?? 0,
    dispose() { ro.disconnect(); mq.removeEventListener('change', onTheme); cancelAnimationFrame(raf); },
  };
}
