// "Related flows" on a flow's page (0.28.2, #50): the typed relations of this entry-point flow, under its description and above the walk. Each row reads from this
// flow's end ("supersedes X", "is superseded by Y", "is a variant of Z"), the other flow's name opens its tab, the note follows, and a design shows its mark.
// In Edit with a draft: "+ relation", Edit (the form) and a quick remove (undoable in Review changes). Sealed environments have none: the section is not drawn.

import { h, fill, toast } from '../dom.js';
import { api } from '../api.js';
import { state, isDesign } from '../state.js';
import { marksNow } from '../design/marks-store.js';
import { markBadge } from '../components/status-mark.js';
import { afterEdit } from '../design/after-edit.js';
import { me } from '../design/who.js';
import { setQuery } from '../router.js';
import { REL_TYPES, TYPE_LABEL } from './flow-relations-pure.js';
import { REL_SHOW, relSlice, toggled } from './flow-info-pure.js';

const FILTER_FROM = 6; // type chips only when a flow has more relations than this

/**
 * createRelations({ host, root, editing }) -> { el, dispose } | null (a sealed environment)
 * host: { env, nameOf(service, ingress), openEntry({ service, ingress }), edit?: { relation({ here, view? }) } }; root: { service, ingress }.
 */
export function createRelations({ host, root, editing, onCount = null }) {
  if (!root || !isDesign(host.env)) return null;
  const el = h('section.rel-sec', { 'data-qa': 'related-flows', hidden: true, 'aria-label': 'Related flows' });
  let views = [], openNotes = new Set(), only = REL_TYPES.includes(host.relType) ? host.relType : null, more = false, gone = false; // `only`: the type chip, kept in the URL as relType=
  const marks = () => host.marks ?? marksNow(); // the marks of the flow's own environment
  const nameOf = (f) => host.nameOf?.(f.service, f.ingress) || `${f.service} · ${f.ingress}`;

  async function remove(v) {
    try {
      await api.designEdit(host.env, state.draft, { kind: 'delete', anchor: `rel:${v.id}` }, me());
      toast(`Removed from draft ${state.draft}`); afterEdit();
    } catch (err) { toast(err.message); }
  }
  function row(v) {
    const info = marks()?.markOf?.(`rel:${v.id}`), key = `${v.other.service} · ${v.other.ingress}`, name = host.nameOf?.(v.other.service, v.other.ingress);
    return h('li.rel-row', { 'data-qa': 'relation', 'data-type': v.type, class: openNotes.has(v.id) ? 'open' : '' },
      h('span.rel-ty', { title: TYPE_LABEL[v.type] }, v.phrase),
      h('a.rel-name', { href: '#', title: `Open ${key}`, on: { click: (e) => { e.preventDefault(); (host.openFlow ?? host.openEntry)({ service: v.other.service, ingress: v.other.ingress }); } } }, name || key),
      name ? h('span.mono.xs.muted.rel-key', key) : null,
      info ? markBadge(info, { store: marks(), short: true }) : null,
      editing && host.edit ? h('span.rel-acts',
        h('button.linkish', { type: 'button', 'data-qa': 'relation-edit', on: { click: () => host.edit.relation({ here: root, view: v }) } }, 'Edit'),
        h('button.linkish', { type: 'button', 'data-qa': 'relation-remove', 'aria-label': `Remove the relation with ${name || key}`, on: { click: () => remove(v) } }, 'Remove')) : null,
      v.note ? h('span.rel-note', { title: openNotes.has(v.id) ? null : v.note }, v.note) : null, // plain text, one line with an ellipsis; the chevron opens this row's note (0.45.0, #91)
      v.note ? h('button.rel-tg', { type: 'button', 'data-qa': 'rel-note-toggle', 'aria-expanded': String(openNotes.has(v.id)), 'aria-label': `${openNotes.has(v.id) ? 'Collapse' : 'Expand'} the note of ${name || key}`, on: { click: () => { openNotes = toggled(openNotes, v.id); draw(); } } }, h('span', { 'aria-hidden': 'true' }, '▾')) : null);
  }
  function draw() {
    if (gone) return;
    el.hidden = !views.length && !(editing && host.edit);
    const shown = only && views.length > FILTER_FROM ? views.filter((v) => v.type === only) : views;
    const chips = views.length > FILTER_FROM ? h('div.rel-chips', { role: 'group', 'aria-label': 'Filter by type' }, [['', 'All', views.length], ...REL_TYPES.map((t) => [t, TYPE_LABEL[t], views.filter((v) => v.type === t).length]).filter(([, , n]) => n)]
      .map(([t, label, n]) => h('button.rel-chip', { type: 'button', 'aria-pressed': String((only ?? '') === t), on: { click: () => { only = t || null; more = false; setQuery({ relType: only }); draw(); } } }, `${label} ${n}`))) : null;
    fill(el, h('div.rel-head', h('h5', 'Related flows', h('span.count', `(${views.length})`)), h('span.grow'), chips,
      editing && host.edit ? h('button.btn.sm', { type: 'button', 'data-qa': 'add-relation', title: 'Relate this flow to another one in the draft', on: { click: () => host.edit.relation({ here: root }) } }, '+ relation') : null),
      shown.length ? [h('ul.rel-list', { class: more ? 'is-open' : '' }, relSlice(shown, more).shown.map(row)),
        shown.length > REL_SHOW ? h('button.linkish.rel-more', { type: 'button', 'data-qa': 'rel-more', on: { click: () => { more = !more; draw(); } } }, more ? 'Show fewer' : `Show ${relSlice(shown, false).more} more`) : null] : h('p.xs.muted.rel-none', views.length ? 'No relations of this type.' : 'No related flows yet.'));
  }
  api.flowRelations(host.env, root).then((v) => { views = v; onCount?.(v.length); draw(); }).catch(() => { /* the flow still works without the section */ });
  return { el, dispose: () => { gone = true; } };
}
