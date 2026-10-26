// The scenario controls in the flow header row (0.38.0, #82 part 3, frame 21a / 21d): a "Scenario (N)" chip that opens a popover with every decision
// (the same dropdowns as the divider rows, the locked ones with their reason and file:line, "Reset to defaults"), and the small External | Full switch.
// Nothing new above the flow. A hidden "Resolve names" slot is kept for later. The state and the fetching are flow-scenario.js; this is only the view.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { armSelect, lockReason, depBadge } from './flow-decision-draw.js';
import { levelOf, srcText } from './flow-decision-rows.js';
import { changedCount } from './flow-scenario-pure.js';

const stop = (fn) => (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(ev); }; // the header row is a <summary>: a click on a control must not fold the description

/** createScenarioUi({ scen, st, srcUrl(at) }) -> { el, update(view), dispose() }. `st`: the tab's scenario state (detail, chosen). */
export function createScenarioUi({ scen, st, srcUrl = () => null }) {
  let view = null, pop = null, off = null;
  const chip = h('button.scn-chip', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'data-qa': 'scenario-chip', hidden: true, on: { click: stop(() => (pop ? close() : open())) } });
  const seg = h('div.seg.scn-seg', { role: 'group', 'aria-label': 'Detail', 'data-qa': 'detail-switch' }, [['simple', 'Simple', 'Each external call once, repeats counted, decisions shown together, internal steps hidden'], ['external', 'External', 'Calls between components, database operations and problems. Open a service to see its internal calls.'], ['full', 'Full', 'Every call, inside the services too']].map(([id, label, title]) =>
    h('button', { type: 'button', 'data-detail': id, title, on: { click: stop(() => scen.setDetail(id)) } }, label)));
  const resolve = h('button.btn.sm.scn-resolve', { type: 'button', hidden: true, 'data-qa': 'resolve-names' }, 'Resolve names'); // reserved: not offered in v1
  const el = h('span.scn-ctl', { on: { click: stop(() => {}) } }, chip, seg, resolve);
  // 0.44.0 (#90), frame 24a: under the header, what Simple leaves out (the count links to External), and where the decisions bar was, the decisions folded into it
  const toExt = (e) => { e.preventDefault(); scen.setDetail('external'); };
  const cap = h('p.simple-cap', { 'data-qa': 'simple-caption', hidden: true }), note = h('div.simple-note', { 'data-qa': 'simple-note', hidden: true });
  const extra = h('div.simple-extra', cap, note);
  function paintSimple(v) {
    const on = st.detail === 'simple' && v.detail === 'simple', hid = (v.participants ?? []).reduce((n, p) => n + (p.hiddenSteps ?? 0), 0), dn = v.flattened ?? 0;
    cap.hidden = !on; note.hidden = !on || !dn;
    cap.replaceChildren('Simple: each external call once, decisions flattened', ...(hid ? [' · ', h('a.simple-link', { href: '#', 'data-qa': 'simple-hidden', on: { click: toExt } }, `${hid} internal ${hid === 1 ? 'step' : 'steps'} hidden`)] : []));
    note.replaceChildren(h('b', `${dn} ${dn === 1 ? 'decision' : 'decisions'} shown together`), ' · ', h('a.simple-link', { href: '#', 'data-qa': 'simple-choose', on: { click: toExt } }, 'choose in External'));
  }

  function row(d, level) {
    const sel = armSelect(d, (g, arm) => { scen.choose(g, arm); requestAnimationFrame(() => pop?.querySelector(`[data-g="${CSS.escape(g)}"]`)?.focus()); }, { id: null });
    sel.setAttribute('data-g', d.group_id);
    const src = srcText(d.lock?.source), url = d.lock ? srcUrl(d.lock.at) : null, gsrc = srcText(d.guard);
    return h('div.scn-d', { class: level ? 'nested' : '' }, h('div.scn-dn', level ? h('span.dec-nest', '└ ') : null, h('span.t', { title: [d.name, d.template_name].filter(Boolean).join('\n') }, d.name)), sel,
      d.lock ? h('div.scn-why', icon('lock'), h('span', `${lockReason(d)} · `, src ? (url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, src) : h('span.mono', src)) : null)) : null,
      d.depends_on === 'data' ? h('div.scn-dep', depBadge(d), gsrc ? h('span.mono.xs.muted', gsrc) : null) : null);
  }
  function fill() {
    const ds = view?.decisions ?? [], lv = levelOf(ds), none = !changedCount(scen.decisions(), st.chosen, scen.editAll());
    pop.replaceChildren(h('div.scn-h', h('b', 'Scenario'), h('span.muted', `${ds.length} ${ds.length === 1 ? 'decision affects' : 'decisions affect'} this flow`)), h('div.scn-list', ds.map((d) => row(d, lv.get(d.group_id) ?? 0))),
      h('div.scn-f', h('button.lnk', { type: 'button', 'data-qa': 'scenario-reset', disabled: none, on: { click: () => scen.reset() } }, 'Reset to defaults'), h('span.xs.muted', scen.editAll() ? 'Defaults: all branches while editing' : 'Defaults: first arm of each decision')));
  }
  function place() {
    const r = chip.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 6)}px`; pop.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
  }
  function open() {
    pop = h('div.scn-pop', { role: 'dialog', 'aria-label': 'Scenario', 'data-qa': 'scenario-pop' });
    fill(); document.body.append(pop); place(); chip.setAttribute('aria-expanded', 'true');
    const down = (e) => { if (!pop.contains(e.target) && !chip.contains(e.target)) close(); }, key = (e) => { if (e.key === 'Escape') { close(); chip.focus(); } };
    setTimeout(() => { addEventListener('pointerdown', down, true); addEventListener('keydown', key, true); addEventListener('resize', close); });
    off = () => { removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true); removeEventListener('resize', close); };
    pop.querySelector('select, [tabindex]')?.focus();
  }
  function close() { off?.(); off = null; pop?.remove(); pop = null; chip.setAttribute('aria-expanded', 'false'); }

  return {
    el, extra,
    update(v) {
      view = v; paintSimple(v);
      const n = v.decisions?.length ?? 0, diff = changedCount(scen.decisions(), st.chosen, scen.editAll()) > 0;
      chip.hidden = !n; chip.classList.toggle('set', diff);
      chip.replaceChildren(`Scenario `, h('span.n', `(${n})`), icon('chev'));
      chip.title = diff ? 'Not the default scenario: click to see the choices' : 'Either / or decisions in this flow';
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.detail === st.detail)));
      seg.classList.toggle('busy', scen.loading.has('*'));
      if (pop) { if (n) fill(); else close(); }
    },
    dispose: close,
  };
}
