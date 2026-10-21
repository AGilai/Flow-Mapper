// New environment (#/envs/new): copy from any environment as Blank, Components or Full copy. The creator names the
// subsystems and picks components, with one-hop neighbours suggested. The server does the copy in one transaction.

import { h, fill, debounce, toast } from '../dom.js';
import { api, isPreview } from '../api.js';
import { state, setEnv } from '../state.js';
import { go } from '../router.js';
import { pageHead } from '../components/page.js';
import { envLine, metaOf, nameError, summarySentence } from '../env-info.js';
import { groupsField } from './env-new-groups.js';
import { pickTable } from './env-new-table.js';

const MODES = [
  ['blank', 'Blank', 'Nothing copied. The environment starts empty.'],
  ['components', 'Components', 'The components you pick, without their flows. You design new flows against real endpoints.'],
  ['full', 'Full copy', 'Everything, flows and descriptions too. Use it to duplicate a design.'],
];

export async function render({ main, query }) {
  const source0 = state.envs.includes(query.get('source')) ? query.get('source') : state.envs.includes(state.env) ? state.env : state.envs[0];
  const st = { name: '', source: source0, mode: ['blank', 'components', 'full'].includes(query.get('mode')) ? query.get('mode') : 'components',
    groups: [], comps: [], picked: new Set(), assign: new Map(), neighbours: [], filter: '' };
  const err = h('div');
  const nameHelp = h('span.env-help');
  const nameInput = h('input.input.env-name', { type: 'text', id: 'env-name', autocomplete: 'off', spellcheck: false, placeholder: 'sase-hld',
    on: { input: (e) => { st.name = e.target.value.trim(); changed(); } } });
  const countLabel = h('span.env-count');
  const tableHost = h('div.env-field');
  const summaryText = h('p');
  const create = h('button.btn.primary', { type: 'button', on: { click: submit } }, 'Create environment');
  const table = pickTable(st, changed);
  const groups = groupsField(st, changed);
  const sourceSel = h('select.select.env-source', { id: 'env-source', on: { change: (e) => loadSource(e.target.value) } },
    state.envs.map((n) => h('option', { value: n, selected: n === st.source }, `${n}: ${envLine(metaOf(state.envMeta, n))}`)));
  const modeBox = h('fieldset.env-modes', { role: 'radiogroup', 'aria-label': 'Copy' });

  const takenNames = () => state.envs;
  const loadNeighbours = debounce(async () => {
    if (st.mode !== 'components' || !st.picked.size) { st.neighbours = []; table.draw(); return; }
    try { st.neighbours = await api.neighbours(st.source, [...st.picked]); } catch { st.neighbours = []; }
    table.draw();
  }, 200);

  function changed() {
    for (const n of st.picked) if (!st.groups.some((g) => g.key === st.assign.get(n))) st.assign.set(n, st.groups[0]?.key ?? '');
    for (const n of [...st.assign.keys()]) if (!st.picked.has(n)) st.assign.delete(n);
    const bad = nameError(st.name, takenNames());
    nameHelp.textContent = bad || 'Lowercase letters, digits and "-". It is the name in the environment list.';
    nameHelp.classList.toggle('bad', !!bad);
    const rows = st.comps.filter((c) => st.picked.has(c.name));
    countLabel.textContent = st.mode === 'components' ? `${rows.length} picked` : '';
    tableHost.hidden = st.mode !== 'components';
    summaryText.textContent = summarySentence({ mode: st.mode, source: st.source, rows, all: st.comps.length, groups: st.groups });
    create.disabled = !st.name || !!bad || (st.mode === 'components' && !rows.length);
    table.draw();
    loadNeighbours();
  }

  function drawModes() {
    fill(modeBox,
      MODES.map(([id, label, text]) => h('label.env-mode', h('input', { type: 'radio', name: 'env-mode', value: id, checked: st.mode === id, on: { change: () => { st.mode = id; changed(); } } }), h('b', label), text)),
      h('label.env-mode.off', { title: 'Later' }, h('input', { type: 'radio', name: 'env-mode', disabled: true }), h('b', 'Linked'), 'The source as it changes, with the design on top. ', h('span.env-later', 'Later')));
  }

  async function loadSource(name) {
    st.source = name; st.picked.clear(); st.assign.clear(); st.neighbours = [];
    try { st.comps = await api.envComponents(name); } catch (e) { st.comps = []; fill(err, h('div.error-box', e.message)); }
    const meta = metaOf(state.envMeta, name);
    if (meta.kind === 'design' && st.mode === 'full' && !st.groups.length) st.groups = meta.groups.map((g) => ({ ...g }));
    fill(err);
    changed();
  }

  async function submit() {
    create.disabled = true; create.textContent = 'Creating…';
    const services = st.mode === 'components' ? [...st.picked].map((name) => ({ name, groupPath: st.assign.get(name) || undefined })) : undefined;
    try {
      const made = await api.createEnv({ name: st.name, source: st.source, mode: st.mode, groups: st.groups, levels: ['Subsystem', 'Component'], services, createdBy: 'web' });
      state.envMeta = await api.envMeta();
      state.envs = state.envMeta.map((m) => m.name);
      setEnv(made.name, true);
      toast(`Created ${made.name}`);
      go('/system');
    } catch (e) {
      fill(err, h('div.error-box', { role: 'alert' }, e.message));
      create.textContent = 'Create environment'; changed();
    }
  }

  fill(main,
    pageHead('New environment', 'A design environment holds a high-level design. Harvesters never write to it.'),
    h('div.content', h('div.env-form', isPreview ? h('div.callout.info', h('span.dot'), 'In the preview you can look at this page, but creating an environment needs the server.') : null, err,
      h('div.env-field', h('label', { for: 'env-name' }, 'Name'), nameInput, nameHelp),
      h('div.env-field', h('label', { for: 'env-source' }, 'Source environment'), sourceSel, h('span.env-help', 'Any environment: prod, or a design to duplicate it.')),
      h('div.env-field', h('span.env-lab', 'Copy'), modeBox),
      h('div.env-field', h('span.env-lab', 'Subsystems'), groups),
      tableHost,
      h('div.env-summary', summaryText, h('span.env-btns', h('a.btn', { href: '#/system' }, 'Cancel'), create)))));
  tableHost.append(h('span.env-lab', 'Components from the source ', countLabel), table.el);
  drawModes();
  await loadSource(st.source);
  return { dispose() {} };
}
