// The one "Report a bug" form, used by the page (#/bugs/new) and the floating dialog.
// bugForm({ services, service, seenOn, draft, onDone(bug), cancel }) -> { el, title }.
// `draft` (optional object) keeps what was typed so a closed dialog can be reopened; `seenOn` is appended to the steps on submit.

import { h } from '../dom.js';
import { api, isPreview } from '../api.js';
import { state } from '../state.js';
import { logDropzone } from '../views/bug-logs.js';

const SEVERITY = [
  ['S1', 'Blocks work', 'Data is wrong or missing, or a core view is unusable.'],
  ['S2', 'Major', 'A feature fails, with a workaround.'],
  ['S3', 'Minor', 'Something is off but work continues.'],
  ['S4', 'Cosmetic', 'Layout, wording or polish.'],
];
const FIELDS = ['title', 'desc', 'steps', 'version', 'reporter', 'service', 'sev'];

export function bugForm({ services, service = null, seenOn = null, draft = null, onDone, cancel }) {
  const remembered = (() => { try { return localStorage.getItem('flow-mapper.reporter') ?? ''; } catch { return ''; } })();
  const d = { title: '', desc: '', steps: '', version: state.version, reporter: remembered, service: service ?? '', sev: 'S3', ...draft };
  const files = [];

  const field = (label, control, hint) => h('label.field', h('span', label, hint ? h('span.hint', ` ${hint}`) : null), control);
  const title = h('input.input', { required: true, maxLength: 200, value: d.title, placeholder: 'Sequence view freezes on long flows' });
  const desc = h('textarea.textarea', { value: d.desc, placeholder: 'What did you expect, and what happened instead?' });
  const steps = h('textarea.textarea', { value: d.steps, placeholder: '1. Open Flows\n2. Pick public-gateway POST /orders\n3. Switch to Full flow' });
  const version = h('input.input', { value: d.version });
  const reporter = h('input.input', { value: d.reporter, placeholder: 'Your name' });
  const svc = h('select.select', h('option', { value: '' }, 'Not about a specific service'),
    services.map((s) => h('option', { value: s, selected: s === d.service }, s)));
  const sev = h('div.stack', { role: 'radiogroup', 'aria-label': 'Severity' }, SEVERITY.map(([id, label, help]) =>
    h('label.check', { style: { alignItems: 'flex-start' } }, h('input', { type: 'radio', name: 'sev', value: id, checked: id === d.sev }),
      h('span', h('b', `${id} ${label}`), h('span.muted', ` ${help}`)))));
  const submit = h('button.btn.primary', { type: 'submit' }, 'Report bug');
  const error = h('div');
  const sevValue = () => sev.querySelector('input:checked').value;
  const sync = () => { if (draft) Object.assign(draft, { title: title.value, desc: desc.value, steps: steps.value, version: version.value, reporter: reporter.value, service: svc.value, sev: sevValue() }); };

  const el = h('form.form', {
    on: {
      input: sync, change: sync,
      submit: async (e) => {
        e.preventDefault();
        if (!title.value.trim()) { title.focus(); return; }
        submit.disabled = true;
        error.replaceChildren();
        try {
          try { localStorage.setItem('flow-mapper.reporter', reporter.value); } catch { /* storage unavailable */ }
          const stepText = seenOn ? `${steps.value.trimEnd()}${steps.value.trim() ? '\n\n' : ''}Seen on: ${seenOn}` : steps.value;
          const bug = await api.createBug({
            title: title.value, description: desc.value, steps: stepText, severity: sevValue(),
            appVersion: version.value || state.version, env: state.env, reporter: reporter.value || 'anonymous', channel: 'web',
            links: svc.value ? [{ type: 'service', id: svc.value }] : [],
          });
          for (const f of files) await api.attach(bug.id, f);
          if (draft) for (const k of FIELDS) delete draft[k];
          onDone(bug);
        } catch (err) {
          error.append(h('div.error-box', err.message, err.details ? h('pre.small', JSON.stringify(err.details, null, 1)) : null));
          submit.disabled = false;
        }
      },
    },
  },
    h('div.form.form-body',
    field('Title', title),
    field('What happened', desc),
    field('Steps to reproduce', steps, 'optional'),
    h('fieldset.field', { style: { border: 0, padding: 0, margin: 0 } }, h('legend', h('b.small', 'Severity')), sev),
    h('div.two-col', { style: { gridTemplateColumns: '1fr 1fr' } },
      field('Version', version, 'where you saw it'),
      field('Reported by', reporter)),
    field('Related service', svc, 'helps prioritize by impact'),
    isPreview ? null : field('Logs', logDropzone(files), 'up to 5 MB each'),
    error),
    h('div.row.form-foot', submit, cancel));
  return { el, title };
}
