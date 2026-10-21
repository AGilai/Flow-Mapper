// The DTO form: role, status, content (JSON, a parse error shows inline). A content that is a JSON Schema also shows its field table.
// One `designEdit` {kind:'dto'} (an existing `meta` is kept by the builder).

import { api } from '../../api.js';
import { state } from '../../state.js';
import { h } from '../../dom.js';
import { schemaTable } from '../../components/schema-table.js';
import { parseContent, looksLikeSchema } from './dto-parse.js';
import { createFields, openForm, select, input, textarea, tag } from './form-kit.js';

export { parseContent, looksLikeSchema } from './dto-parse.js';

/** openDtoForm({ panel, flowsEl, service, ingress, role }) */
export async function openDtoForm({ panel, flowsEl, service, ingress, role = 'request' }) {
  const info = await api.endpoint(state.env, service, ingress).catch(() => null), slot = info?.slots?.find((s) => s.role === role), dto = slot?.dto ?? null;
  const fields = createFields(), roleSel = select([['request', 'Request'], ['response', 'Response']], role), status = input(dto?.status ?? '', { placeholder: 'e.g. 200' });
  const content = textarea(dto ? JSON.stringify(dto.content, null, 2) : '{\n  \n}', 10), preview = h('div.fwide');
  content.classList.add('mono');
  const paint = () => { try { const v = JSON.parse(content.value); preview.replaceChildren(...(looksLikeSchema(v) ? [schemaTable(v)] : [])); } catch { preview.replaceChildren(); } };
  content.addEventListener('input', paint);
  fields.field('role', 'Role', roleSel); fields.field('status', 'Status', status, 'The response status this body belongs to (empty for a request).'); fields.field('content', 'Content', content, 'An example payload or a JSON Schema.'); fields.wide(preview);
  paint();
  openForm({ panel, flowsEl, fields, chips: [tag('message')], title: `${role === 'request' ? 'Request' : 'Response'} DTO · ${service}`, sub: `${ingress} · Draft ${state.draft}`,
    build: () => ({ kind: 'dto', service, ingress, role: roleSel.value, ...(status.value.trim() ? { status: status.value.trim() } : {}), content: parseContent(content.value) }),
    remove: dto ? { label: 'Delete DTO', title: 'Delete this message?', body: 'Only this body goes.', edit: { kind: 'delete', anchor: `dto:${service}/${role}/${dto.status || '-'}/${ingress}` } } : null });
}
