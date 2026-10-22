// The "Step details" control of the flow toolbar (0.30.0, frame 17d): one button that says what is on, and a panel with two sections, Step bar and Arrows,
// each with Title / API / Description checkboxes, and presets. The arrows keep at least one field. Remembered per viewer (storage may be unavailable) and in the URL.

import { h } from '../dom.js';
import { BAR_DEFAULT, ARROWS_DEFAULT, canon, toggle, summary, PRESETS } from './step-details-pure.js';

const KEY = { bar: 'flow-mapper.step-bar', arrows: 'flow-mapper.step-arrows' };
export const stored = (which, dflt) => { try { const v = localStorage.getItem(KEY[which]); return v == null ? dflt : v === '-' ? '' : canon(v) || dflt; } catch { return dflt; } };
const keep = (which, set) => { try { localStorage.setItem(KEY[which], set === '' ? '-' : set); } catch { /* storage unavailable */ } };

/** createStepMenu({ bar, arrows, onChange({ bar, arrows }) }) -> { el, set(bar, arrows), close() } */
export function createStepMenu({ bar, arrows, onChange }) {
  const FIELDS = [['t', 'Title'], ['a', 'API'], ['d', 'Description']];
  const label = h('span.sdm-l'), btn = h('button.btn.sm.sdm-btn', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'data-qa': 'step-details', on: { click: () => (panel.hidden ? open() : close()) } }, label, h('span.sdm-c', '▾'));
  const panel = h('div.sd-menu', { hidden: true, role: 'group', 'aria-label': 'Step details' });
  const el = h('span.sdm', btn, panel);

  const section = (which, title, note, min) => {
    const cur = which === 'bar' ? bar : arrows;
    return h('div.sdm-sec', h('h5', title, h('small', note)), ...FIELDS.map(([c, name]) => {
      const on = cur.includes(c), last = min && on && cur.length <= min;
      return h('label.sdm-o', { class: last ? 'locked' : '', title: last ? 'The arrows keep at least one field' : null }, h('input', { type: 'checkbox', checked: on, disabled: last, 'data-sd': `${which}-${c}`, on: { change: () => apply(which, toggle(cur, c, min)) } }), name);
    }));
  };
  function paint() {
    label.textContent = summary(bar, arrows);
    panel.replaceChildren(section('bar', 'Step bar', 'above the diagram', 0), section('arrows', 'Arrows', 'on the diagram', 1),
      h('div.sdm-pre', ...PRESETS.map((p) => h('button.link', { type: 'button', on: { click: () => { bar = p.bar; arrows = p.arrows; keep('bar', bar); keep('arrows', arrows); paint(); onChange({ bar, arrows }); } } }, p.label))),
      h('p.sdm-n', 'The bar always has the stepper. A step shows the fields it has; a step with none of the chosen arrow fields shows its API.'));
  }
  function apply(which, set) {
    if (which === 'bar') bar = set; else arrows = set || ARROWS_DEFAULT;
    keep(which, which === 'bar' ? bar : arrows); paint(); onChange({ bar, arrows });
  }
  const onDoc = (e) => { if (!el.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } };
  function open() { paint(); panel.hidden = false; panel.style.left = '0'; panel.style.right = 'auto'; if (panel.getBoundingClientRect().right > innerWidth - 8) { panel.style.left = 'auto'; panel.style.right = '0'; } // keep it inside the window
     btn.setAttribute('aria-expanded', 'true'); document.addEventListener('mousedown', onDoc, true); panel.addEventListener('keydown', onKey); }
  function close() { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', onDoc, true); panel.removeEventListener('keydown', onKey); }
  label.textContent = summary(bar, arrows);
  return { el, close, set(b, a) { bar = b ?? BAR_DEFAULT; arrows = a ?? ARROWS_DEFAULT; label.textContent = summary(bar, arrows); if (!panel.hidden) paint(); } };
}
