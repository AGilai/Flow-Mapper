// Report a bug: title, what happened, steps, severity, version, optional linked service and log files.

import { h, toast } from '../dom.js';
import { api, isPreview } from '../api.js';
import { state } from '../state.js';
import { go } from '../router.js';
import { pageHead } from '../components/page.js';
import { logDropzone } from './bug-logs.js';

const SEVERITY = [
  ['S1', 'Blocks work', 'Data is wrong or missing, or a core view is unusable.'],
  ['S2', 'Major', 'A feature fails, with a workaround.'],
  ['S3', 'Minor', 'Something is off but work continues.'],
  ['S4', 'Cosmetic', 'Layout, wording or polish.'],
];

export async function render({ main, query }) {
  const services = (await api.services(state.env)).filter((s) => s.kind !== 'infra').map((s) => s.name);
  const remembered = (() => { try { return localStorage.getItem('flow-mapper.reporter') ?? ''; } catch { return ''; } })();
  const files = [];

  const field = (label, control, hint) => h('label.field', h('span', label, hint ? h('span.hint', ` ${hint}`) : null), control);
  const title = h('input.input', { required: true, maxLength: 200, placeholder: 'Sequence view freezes on long flows' });
  const desc = h('textarea.textarea', { placeholder: 'What did you expect, and what happened instead?' });
  const steps = h('textarea.textarea', { placeholder: '1. Open Flows\n2. Pick public-gateway POST /orders\n3. Switch to Full flow' });
  const version = h('input.input', { value: state.version, 'aria-describedby': 'v-hint' });
  const reporter = h('input.input', { value: remembered, placeholder: 'Your name' });
  const service = h('select.select', h('option', { value: '' }, 'Not about a specific service'),
    services.map((s) => h('option', { value: s, selected: s === query.get('service') }, s)));
  const sev = h('div.stack', { role: 'radiogroup', 'aria-label': 'Severity' }, SEVERITY.map(([id, label, help]) =>
    h('label.check', { style: { alignItems: 'flex-start' } }, h('input', { type: 'radio', name: 'sev', value: id, checked: id === 'S3' }),
      h('span', h('b', `${id} ${label}`), h('span.muted', ` ${help}`)))));
  const submit = h('button.btn.primary', { type: 'submit' }, 'Report bug');
  const error = h('div');

  const form = h('form.form', {
    on: {
      submit: async (e) => {
        e.preventDefault();
        if (!title.value.trim()) { title.focus(); return; }
        submit.disabled = true;
        error.replaceChildren();
        try {
          try { localStorage.setItem('flow-mapper.reporter', reporter.value); } catch { /* storage unavailable */ }
          const bug = await api.createBug({
            title: title.value, description: desc.value, steps: steps.value, severity: form.querySelector('input[name=sev]:checked').value,
            appVersion: version.value || state.version, env: state.env, reporter: reporter.value || 'anonymous', channel: 'web',
            links: service.value ? [{ type: 'service', id: service.value }] : [],
          });
          for (const f of files) await api.attach(bug.id, f);
          toast(`Bug #${bug.id} reported`);
          go(`/bugs/${bug.id}`);
        } catch (err) {
          error.append(h('div.error-box', err.message, err.details ? h('pre.small', JSON.stringify(err.details, null, 1)) : null));
          submit.disabled = false;
        }
      },
    },
  },
    field('Title', title),
    field('What happened', desc),
    field('Steps to reproduce', steps, 'optional'),
    h('fieldset.field', { style: { border: 0, padding: 0, margin: 0 } }, h('legend', h('b.small', 'Severity')), sev),
    h('div.two-col', { style: { gridTemplateColumns: '1fr 1fr' } },
      field('Version', version, 'where you saw it'),
      field('Reported by', reporter)),
    field('Related service', service, 'helps prioritize by impact'),
    isPreview ? null : field('Logs', logDropzone(files), 'up to 5 MB each'),
    error,
    h('div.row', submit, h('a.btn.ghost', { href: '#/bugs' }, 'Cancel')));

  main.append(pageHead('Report a bug', 'Bugs in Flow-Mapper itself: the map, the views, the API or MCP.'), h('div.content', form));
  title.focus();
}
