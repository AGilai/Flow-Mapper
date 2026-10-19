// Log file picking (drag and drop or browse) and inline log viewing.

import { h, fill } from '../dom.js';
import { icon } from '../icons.js';
import { attachmentUrl } from '../api.js';

const MAX = 5 * 1024 * 1024;

/** A dropzone that collects File objects into `files`. Calls onAdd(file) for each accepted file. */
export function logDropzone(files, onAdd) {
  const list = h('div.list');
  const input = h('input', { type: 'file', multiple: true, class: 'sr-only', id: `f${Math.random().toString(36).slice(2)}` });
  const zone = h('div.dropzone', icon('upload'), h('p', 'Drop log files here or ', h('label', { for: input.id, style: { color: 'var(--accent)', cursor: 'pointer' } }, 'browse'), '.'), input, list);
  const add = (fl) => {
    for (const f of fl) {
      if (f.size > MAX) { list.append(h('div.small', { style: { color: 'var(--bad)' } }, `${f.name} is larger than 5 MB`)); continue; }
      files.push(f);
      onAdd?.(f);
      list.append(h('div.list-item', h('span.key.grow', f.name), h('span.xs.muted', `${Math.ceil(f.size / 1024)} KB`)));
    }
  };
  input.addEventListener('change', () => add(input.files));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); add(e.dataTransfer.files); });
  return zone;
}

/** Attachment row with an expandable inline view for text logs. */
export function attachmentRow(bugId, a) {
  const url = attachmentUrl(bugId, a.id);
  const view = h('div');
  const toggle = h('button.btn.ghost', { on: { click: async () => {
    if (view.childElementCount) { fill(view); toggle.textContent = 'View'; return; }
    const text = url ? await (await fetch(url)).text() : '';
    fill(view, h('div.log-view', text.slice(0, 200_000)));
    toggle.textContent = 'Hide';
  } } }, 'View');
  return h('div.stack', { style: { gap: '6px' } },
    h('div.list-item', h('span.key.grow', a.filename), h('span.xs.muted', `${Math.ceil(a.size / 1024)} KB`),
      url ? toggle : null, url ? h('a.btn.ghost', { href: url, download: a.filename }, 'Download') : null),
    view);
}
