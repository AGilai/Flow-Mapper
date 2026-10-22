// The info pane of a subsystem (0.33.0, frame 19b): Overview, About, Components (each row opens its own pane), Links to other subsystems, Flows through it.
// `subsystemSpec(key, ctx)` -> the spec `pane-frame.js` draws and `pane-expanded.js` lays out as rows. ctx: { pen, env?, map?, onComponent(name), onLine(l)?, onLink(v)? }.

import { h } from '../dom.js';
import { api } from '../api.js';
import { href } from '../router.js';
import { state, isDesign } from '../state.js';
import { loadMarks } from '../design/marks-store.js';
import { loadSubsystems } from '../design/subsystems-store.js';
import { markBadge, countBadges } from '../components/status-mark.js';
import { subIcon, icon } from '../icons.js';
import { envQuery } from '../views/inventory-links.js';
import { chip } from '../format.js';
import { markOfPoint } from '../views/flow-list-filter.js';
import { block, facts, flowsList, firstLine } from './pane-parts.js';
import { loadAbout, aboutSection, aboutRows } from './pane-about.js';
import { questionsButton } from './pane-questions.js';
import { ownersValue } from './pane-owners.js';

const MAX = 8;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export async function subsystemSpec(key, ctx) {
  const env = ctx.env ?? state.env;
  const [map, marks, subs, sys] = await Promise.all([ctx.map ?? api.subsystemMap(env), loadMarks(env), loadSubsystems(env), api.system(env).catch(() => null)]);
  const box = map.boxes.find((b) => b.key === key);
  if (!box) return null;
  const label = (k) => subs.labelOf(k) || 'Not set', names = box.components.map((c) => c.name), aboutOf = new Map((sys?.nodes ?? []).map((n) => [n.label, n.about]));
  const [flows, about] = await Promise.all([api.flowsThrough(env, names).catch(() => []), loadAbout(box.about)]);
  const mk = marks.markOf(`grp:${key}`), design = isDesign(env), cmark = box.components.map((c) => marks.markOf(`svc:${c.name}`));
  const pen = !box.derived ? ctx.pen?.about(box.label, { form: 'subsystem', box }) ?? null : null;
  const invHref = href('/inventory', envQuery(env, { subsystem: box.key || '-' }));

  const owners = Array.isArray(box.owners) ? box.owners : [], ownerPen = () => (!box.derived ? ctx.pen?.button('owners', `${box.label} owners`, { form: 'subsystem', box, at: 'owners' }) ?? null : null);
  const kinds = ['new', 'changed'].map((k) => [k, cmark.filter((m) => m?.mark === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`);
  const overview = () => [ctx.pen?.hint() ?? null, facts([
    ['Components', [`${box.components.length} `, kinds.length ? h('small', `· ${kinds.join(', ')}`) : null]],
    ['Owners', owners.length || (design && !box.derived) ? ownersValue(owners, ownerPen()) : null],
    ['Calls', h('span', `${box.internal} inside · ${box.out} out · ${box.in} in`, box.dangling ? h('span.pane-bad', ` · ${box.dangling} to nothing`) : null)],
  ]), h('div.pane-cta', h('a.btn', { href: invHref }, 'Open in Inventory'))];

  const crow = (c, i) => h('button.pane-row.btn-row', { type: 'button', 'data-qa': 'pane-comp', title: `Open ${c.name}`, on: { click: () => ctx.onComponent?.(c.name) } },
    h('b.mono', c.name), h('span.r', markBadge(cmark[i], { store: marks }), h('span.xs', c.kind)), h('small', firstLine(aboutOf.get(c.name)) || h('i', 'No description yet')));
  const compBody = () => h('div.pane-list', box.components.slice(0, MAX).map(crow), box.components.length > MAX ? h('p.pane-more-n', `+${box.components.length - MAX} more. Open in Inventory to see all.`) : null);

  const lines = (map.lines ?? []).filter((l) => l.from === key || l.to === key), abs = (map.abstract ?? []).filter((v) => v.from.subsystem === key || v.to.subsystem === key);
  const open = (q) => href('/system', envQuery(env, { level: 'subsystems', ...q }));
  const lrow = (l) => h('a.pane-row', { href: open({ line: l.id }), 'data-qa': 'pane-line', on: { click: (e) => { if (ctx.onLine) { e.preventDefault(); ctx.onLine(l); } } } },
    h('b', l.from === key ? label(l.to) : label(l.from)), h('span.r', (l.transports ?? [l.transport]).filter(Boolean).map((t) => chip(t))), h('small', `${label(l.from)} ${l.merged ? '↔' : '→'} ${label(l.to)} · ${plural(l.calls?.length ?? 0, 'call')}`));
  const arow = (v) => h('a.pane-row', { href: open({ link: v.id }), 'data-qa': 'pane-abstract', on: { click: (e) => { if (ctx.onLink) { e.preventDefault(); ctx.onLink(v); } } } },
    h('b', v.name), h('span.r', h('span.pill', 'abstract')), h('small', `${label(v.from.subsystem)} → ${label(v.to.subsystem)} · ${v.state}`));
  const nLinks = lines.length + abs.length;
  const linksBody = () => (nLinks ? h('div.pane-list', [...lines.slice(0, MAX).map(lrow), ...abs.slice(0, MAX).map(arow)]) : h('p.pane-none', 'No calls or abstract links to other subsystems.'));
  const flowsBody = () => flowsList(flows, { env, mark: (e) => markBadge(markOfPoint(marks, e), { store: marks }) });
  const tflows = h('a', { href: href('/flows', envQuery(env, { subsystems: key || '-' })) }, 'Trace flows');

  const spec = {
    kind: 'subsystem', key: `grp:${key}`, target: { kind: 'subsystem', key }, title: box.label, tile: () => h('span.pane-tile.ss', box.icon ? subIcon(box.icon, 20) : icon('services')),
    sub: ['Subsystem', plural(box.components.length, 'component')], questions: about.questions,
    marks: (goQuestions) => [markBadge(mk, { store: marks }), ...(mk ? [] : countBadges(cmark, marks)), questionsButton(about.questions, goQuestions)],
    sections: {
      overview: block('overview', '', {}, overview()), about: aboutSection(about, { pen, design }),
      components: block('components', 'Components', { count: box.components.length, right: h('a', { href: invHref }, 'Open in Inventory') }, compBody()),
      links: block('links', 'Links to other subsystems', { count: nLinks }, linksBody()),
      flows: block('flows', 'Flows through it', { count: flows.length, right: tflows }, flowsBody()),
    },
    counts: { components: box.components.length, links: nLinks, flows: flows.length },
    about, owners,
    edit: () => (!box.derived ? ctx.pen?.button('panel-subsystem', `subsystem ${box.label}`, { form: 'subsystem', box }, { text: 'Edit' }) ?? null : null),
    env, crumb: ['System map', 'Subsystems'], inDraft: marks.inDraft(`grp:${key}`), mark: mk, box,
  };
  spec.expanded = async () => {
    const { about: a, questions } = aboutRows(about, { pen, design });
    return [
      { id: 'overview', title: 'Overview', body: overview }, a, questions,
      { id: 'components', title: 'Components', count: box.components.length, right: h('a', { href: invHref }, 'Open in Inventory'),
        children: box.components.map((c, i) => ({ id: `comp-${c.name}`, defaultOpen: false, title: c.name, small: c.kind, right: markBadge(cmark[i], { store: marks }), body: () => [h('p.pane-md', firstLine(aboutOf.get(c.name)) || h('i', 'No description yet')), h('button.btn.sm', { type: 'button', on: { click: () => ctx.onComponent?.(c.name) } }, `Open ${c.name}`)] })) },
      { id: 'links', title: 'Links to other subsystems', count: nLinks, body: linksBody },
      { id: 'flows', title: 'Flows through it', count: flows.length, right: tflows.cloneNode(true), body: flowsBody },
    ].filter(Boolean);
  };
  return spec;
}
