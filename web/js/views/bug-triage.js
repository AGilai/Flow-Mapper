// Side box on the bug page: status workflow, priority (suggested or overridden), severity, assignee, links.

import { h } from '../dom.js';
import { href } from '../router.js';
import { STATUS_LABEL } from '../format.js';

export function triageBox(b, update) {
  const fixForm = h('div.stack');
  const status = h('select.select', { 'aria-label': 'Move to' },
    h('option', { value: '' }, 'Move to…'), b.allowedTransitions.map((s) => h('option', { value: s }, STATUS_LABEL[s] ?? s)));
  status.addEventListener('change', () => {
    fixForm.replaceChildren();
    if (status.value !== 'fixed') return;
    // Fixing needs the version it ships in and how it was fixed.
    const ver = h('input.input', { placeholder: 'e.g. 0.2.1', value: b.fixedInVersion ?? '', 'aria-label': 'Fixed in version' });
    const type = h('select.select', { 'aria-label': 'Fix type' }, [['code', 'Code change'], ['map-data', 'Map data correction'], ['config', 'Configuration'], ['none', 'No change needed']].map(([v, l]) => h('option', { value: v }, l)));
    const ref = h('input.input', { placeholder: 'PR link or changelog id', 'aria-label': 'Reference' });
    fixForm.append(h('label.field', h('span.small', 'Fixed in version'), ver), h('label.field', h('span.small', 'How'), type), h('label.field', h('span.small', 'Reference'), ref));
    status.dataset.fix = '1';
    fixForm._read = () => ({ fixedInVersion: ver.value.trim(), resolution: { type: type.value, ref: ref.value.trim() || undefined } });
  });
  const apply = h('button.btn.primary', { on: { click: () => {
    if (!status.value) return;
    const extra = status.value === 'fixed' ? fixForm._read() : {};
    update({ status: status.value, ...extra }, `Moved to ${STATUS_LABEL[status.value]}`);
  } } }, 'Update status');

  const pri = h('select.select', { 'aria-label': 'Priority', on: { change: (e) => update({ priority: e.target.value === 'auto' ? null : e.target.value }, 'Priority updated') } },
    h('option', { value: 'auto', selected: !b.priorityOverride }, b.priorityOverride ? 'Use suggested' : `Suggested (${b.priority})`),
    ['P0', 'P1', 'P2', 'P3'].map((p) => h('option', { value: p, selected: b.priorityOverride && p === b.priority }, `${p} (override)`)));
  const sev = h('select.select', { 'aria-label': 'Severity', on: { change: (e) => update({ severity: e.target.value }, 'Severity updated') } },
    ['S1', 'S2', 'S3', 'S4'].map((s) => h('option', { value: s, selected: s === b.severity }, s)));
  const assignee = h('input.input', { value: b.assignee ?? '', placeholder: 'Unassigned', 'aria-label': 'Assignee',
    on: { change: (e) => update({ assignee: e.target.value || null }, 'Assignee updated') } });

  return h('aside.box', { style: { position: 'sticky', top: 0 } },
    h('div.box-body.stack', { style: { gap: 'var(--s4)' } },
      h('section.stack', h('h3', 'Status'), h('p.small', STATUS_LABEL[b.status]), b.allowedTransitions.length ? [status, fixForm, h('div', apply)] : null),
      h('section.stack', h('h3', 'Priority'), pri,
        h('p.xs.muted', `Severity plus impact: the linked parts of the map carry ${b.impact} flow${b.impact === 1 ? '' : 's'}.`)),
      h('section.stack', h('h3', 'Severity'), sev),
      h('section.stack', h('h3', 'Assignee'), assignee),
      h('section.stack', h('h3', 'Linked to the map'),
        b.links.length ? h('div.list', b.links.map((l, i) => h('div.list-item',
          h('span.pill', l.type),
          l.type === 'service' ? h('a.grow.truncate', { href: href(`/services/${encodeURIComponent(l.id)}`) }, l.id) : h('span.key.grow.truncate', l.service ? `${l.service}:${l.id}` : l.id),
          h('button.btn.ghost', { 'aria-label': 'Unlink', on: { click: () => update({ links: b.links.filter((_, j) => j !== i) }, 'Unlinked') } }, '×'))))
          : h('p.small.muted', 'Nothing linked. Link services or functions so impact can be measured.'))));
}
