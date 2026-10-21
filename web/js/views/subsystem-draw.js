// The subsystem level as SVG (0.28.1, frame 3): boxes (icon, label, count line, the components as a list), the rolled-up lines in the transport colour
// with their counts, and the abstract links (dashed ink, open ends, a chip with the state). The geometry is graph/subsystem-layout.js.
// A New subsystem shows one spark and no per-component sparks (the highest new level); prod components are muted. Boxes, lines and links are focusable.

import { s } from '../dom.js';
import { GLYPH, subIcon } from '../icons.js';
import { lineMark } from '../../core/subsystem-rollup.js';
import { thickness, routeItems, routeMerged, mergePairs, itemsOf, lineLabel, HEAD_H } from '../graph/subsystem-layout.js';

const TRANSPORT_VAR = { http: '--t-http', rpc: '--t-rpc', grpc: '--t-http', sns: '--t-sns', sqs: '--t-sqs', amqp: '--t-amqp', eventbridge: '--t-eb', socket: '--t-socket', cron: '--t-cron' };
const tvar = (t) => `var(${TRANSPORT_VAR[t] ?? '--ink-2'})`;
const W = 6.4; // an average glyph of the 10.5px labels, for placing a mark after a text

// the place goes on a <g>, the path stays at the origin: the spark's twinkle animates the path's own transform and would throw it to the corner of the diagram
const spark = (x, y, k = 1) => s('g', { transform: `translate(${x} ${y}) scale(${k})` }, s('path', { class: 'spark', d: GLYPH.new.d }));
const ring = (x, y) => s('g', { transform: `translate(${x} ${y})` }, s('path', { class: 'chg', d: GLYPH.chg.d }));
const markGlyph = (m, x, y) => (m === 'new' ? spark(x, y) : m === 'changed' ? ring(x, y) : null);
const press = (el, fn) => { el.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(); } }); return el; };

function drawBox(box, p, { marks, hasMarks, selected, onBox, onGo, onHover, tf = 1 }) {
  const maxCh = Math.floor(196 / (6.6 * tf)), fit = (t) => (t.length > maxCh ? `${t.slice(0, maxCh - 1)}…` : t); // text keeps its size when the drawing is scaled down: long names are clipped
  const m = marks.markOf(`grp:${box.key}`), isNew = m?.mark === 'new', ic = box.icon ? subIcon(box.icon, 18) : null, tx = ic ? p.x + 38 : p.x + 16;
  if (ic) { ic.setAttribute('x', p.x + 14); ic.setAttribute('y', p.y + 12); }
  const n = box.components.length, count = `${n} ${n === 1 ? 'component' : 'components'}`, what = m?.what ?? '';
  const g = s('g', { class: `ss-box${selected === box.key ? ' sel' : ''}${isNew ? ' isnew' : ''}`, 'data-key': box.key, tabindex: 0, role: 'button', 'aria-label': `${box.label}: ${count}${what ? `, ${what}` : ''}. Press Enter for details` },
    s('rect', { class: 'rg', x: p.x, y: p.y, width: p.w, height: p.h, rx: 12 }), ic,
    s('text', { class: 'box-t', x: tx, y: p.y + 26 }, fit(box.label)), markGlyph(m?.mark, tx + box.label.length * 7.6 * tf + 6, p.y + 14),
    s('text', { class: 'box-c', x: p.x + 16, y: p.y + 48 }, count), what ? s('text', { class: 'box-c', x: p.x + 16, y: p.y + 64 }, fit(what), s('title', {}, what)) : null,
    p.rows.map((r) => {
      const c = box.components.find((x) => x.name === r.name), cm = isNew ? null : marks.markOf(`svc:${r.name}`)?.mark, old = hasMarks && !isNew && !cm;
      const row = s('g', { class: `ss-comp${old ? ' old' : ''}`, 'data-svc': r.name, tabindex: 0, role: 'link', 'aria-label': `${r.name}: open at component level` },
        s('text', { class: 'box-n', x: p.x + 16, y: r.y }, fit(r.name), s('title', {}, `${r.name}${c?.kind ? ` (${c.kind})` : ''}: open at component level`)), markGlyph(cm, p.x + 22 + Math.min(r.name.length, maxCh) * 6.9 * tf, r.y - 10));
      return press(row, () => onGo(r.name));
    }),
    p.more ? s('text', { class: 'box-c', x: p.x + 16, y: p.y + HEAD_H + p.rows.length * 20 + 14 }, `+${p.more} more`) : null);
  for (const [ev, v] of [['mouseenter', box.key], ['mouseleave', null], ['focusin', box.key], ['focusout', null]]) g.addEventListener(ev, () => onHover?.(v));
  return press(g, () => onBox(box.key));
}

function chip(x, y, text, cls = '', tf = 1) {
  const w = text.length * 5.8 * tf + 14;
  return s('g', { class: `chip-b ${cls}` }, s('rect', { x: x - w / 2, y, width: w, height: 15, rx: 7.5 }), s('text', { x, y: y + 11, 'text-anchor': 'middle' }, text));
}

/**
 * drawSubsystems({ L, map, marks, opts: { rolled, abstract }, selected, onBox(key), onLine(line), onLink(view), onGo(service) }) -> { el, routes }
 * L: layoutBoxes(); map: SubsystemMap; marks: the marks store; selected: 'box:<key>' | line id | 'link:<id>' | null.
 */
export function drawSubsystems({ L, map, marks, opts, selected = null, scale = 1, tf = 1, many = false, onBox, onLine, onLink, onGo, onHover }) {
  const base = itemsOf(map, L, opts), links = base.links, hasMarks = !marks.empty;
  const lines = many ? (opts.rolled === false ? [] : mergePairs(map.lines)) : base.lines; // more than MANY boxes: one merged line per pair, below the boxes
  const routes = routeItems(many ? base.items.filter((i) => i.id.startsWith('link:')) : base.items, L);
  if (many) for (const [id, r] of routeMerged(lines, L)) routes.set(id, r);
  const seen = new Set(lines.map((l) => l.transport).filter(Boolean).concat('ink'));
  const defs = s('defs', {}, [...seen].map((t) => s('marker', { id: `ah-${t}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerUnits: 'userSpaceOnUse', markerWidth: 11, markerHeight: 11, orient: 'auto-start-reverse' }, s('path', { d: 'M0 0L10 5L0 10z', style: `fill:${t === 'ink' ? 'var(--ink-2)' : tvar(t)}` }))));
  const boxes = map.boxes.filter((b) => L.boxes.has(b.key)).map((b) => drawBox(b, L.boxes.get(b.key), { marks, hasMarks, selected: selected === `box:${b.key}` ? b.key : null, onBox, onGo, onHover, tf }));
  const rolls = lines.map((l) => {
    const r = routes.get(l.id);
    if (!r) return null;
    const label = lineLabel(l), mk = lineMark(l, marks.payload.marks ?? {}); // a collapsed line carries every call under it
    const t = l.transport === 'many' ? 'ink' : l.transport, hit = s('path', { class: 'ru-hit', d: r.d });
    const g = s('g', { class: `ru-g${selected === l.id ? ' sel' : ''}`, 'data-id': l.id, 'data-from': l.from, 'data-to': l.to, tabindex: 0, role: 'button', 'aria-label': `${label}, ${l.from} to ${l.to}. Press Enter to list the calls` },
      hit, selected === l.id ? s('path', { class: 'ru-halo', d: r.d, style: `stroke:${t === 'ink' ? 'var(--ink-2)' : tvar(t)}` }) : null,
      s('path', { class: `ru ${l.mode === 'async' ? 'async' : 'sync'}${l.transport === 'many' ? ' many' : ''}`, d: r.d, style: `stroke:${t === 'ink' ? 'var(--ink-2)' : tvar(t)};stroke-width:${thickness(l.count)}`, 'marker-end': many ? null : `url(#ah-${t})` }),
      r.show === false ? null : s('text', { class: 'ru-l', x: r.lx, y: r.ly, 'text-anchor': r.anchor ?? 'middle' }, label), r.show === false ? null : markGlyph(mk, r.anchor ? r.lx + label.length * W * tf + 3 : r.lx + label.length * W * tf / 2 + 3, r.ly - 10), l.links?.length ? s('text', { class: 'ru-l ru-inc', x: r.lx, y: r.ly + 10, 'text-anchor': r.anchor ?? 'middle' }, `includes ${l.links.length} link${l.links.length === 1 ? '' : 's'}`) : null);
    return press(g, () => onLine(l));
  });
  const abs = links.map((v) => {
    const r = routes.get(`link:${v.id}`);
    if (!r) return null;
    const sel = selected === `link:${v.id}`, m = marks.markOf(`link:${v.id}`)?.mark, name = v.name.length > 22 ? `${v.name.slice(0, 21)}…` : v.name;
    const g = s('g', { class: `abs-g${sel ? ' sel' : ''}`, 'data-link': v.id, tabindex: 0, role: 'button', 'aria-label': `Abstract link ${v.name}, ${v.state}. Press Enter for details` },
      s('path', { class: 'ru-hit', d: r.d }), sel ? s('path', { class: 'ru-halo ink', d: r.d }) : null, s('path', { class: 'abs', d: r.d }),
      s('circle', { class: 'abs-end', cx: r.from[0], cy: r.from[1], r: 5 }), s('circle', { class: 'abs-end', cx: r.to[0], cy: r.to[1], r: 5 }),
      s('text', { class: 'ru-l', x: r.lx, y: r.ly, 'text-anchor': r.anchor ?? 'middle' }, name, s('title', {}, v.name)), markGlyph(m, r.anchor ? r.lx + name.length * W * tf + 3 : r.lx + name.length * W * tf / 2 + 3, r.ly - 10),
      chip(r.anchor ? r.lx + 24 : r.lx, r.ly + 5, v.state, v.state === 'broken' ? 'broken' : v.state === 'abstract' ? '' : 'part', tf));
    return press(g, () => onLink(v));
  });
  const H = Math.max(L.height, Math.ceil(Math.max(0, ...[...routes.values()].map((r) => r.bottom ?? 0))) + 40); // the corridors under a row can reach lower than the last box
  const el = s('svg', { class: 'ss-svg', width: Math.round(L.width * scale), height: Math.round(H * scale), viewBox: `0 0 ${L.width} ${H}`, role: 'group', style: `--tf:${tf}`, 'aria-label': `Subsystem level: ${map.boxes.length} subsystems, ${lines.length} rolled-up lines, ${links.length} abstract links` }, defs, ...(many ? [rolls, boxes] : [boxes, rolls]), abs);
  const lineEls = [...el.querySelectorAll('.ru-g')];
  /** many: show only the lines of the box in focus (`key`), the selected line, or all of them. */
  const focus = (key, keepId = null, all = false) => { if (many) for (const g of lineEls) g.classList.toggle('ss-off', !(all || (key != null && (g.dataset.from === key || g.dataset.to === key)) || g.dataset.id === keepId)); };
  focus(null, selected, !!opts.all);
  return { el, routes, focus, many };
}
