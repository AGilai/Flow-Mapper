// The Import panel (frame 10): what "Import into design" brings from another environment, one level, before anything is written.
// The counts are the preview's own (`total` = the ops the import appends), never a fixed number. What a callee in another component
// needs stays a reference, each with its own Import (it opens that preview). Nothing is written until the primary button.

import { h, fill, toast } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { chip } from '../format.js';
import { lockChip } from '../components/lock.js';
import { me } from './who.js';
import { afterEdit } from './after-edit.js';
import { ingressOf } from '../views/flow-refs.js';

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const nice = (key) => String(key ?? '').replace(/^[\w-]+:/, '').replace(/^(\w+) [^/\s]*(\/.*)$/, '$1 $2');
const transportOf = (key) => String(key ?? '').split(':')[0].replace('amqp-queue', 'amqp').replace('amqp-rpc', 'rpc');

/** The rows of "Comes along" (pure): [[label, text, small?]] from a preview. */
export function comesAlong(p) {
  const c = p.counts ?? {}, sum = p.summary ?? {}, svc = ingressOf(p.anchor)?.service ?? String(p.anchor).replace(/^svc:/, '');
  const rows = [];
  if (p.level === 'component') {
    const parts = [[c.headers, 'component'], [c.ingress, 'endpoint'], [c.egress, 'call'], [c.resources, 'store'], [c.channels, 'queue or topic', 'queues or topics'], [c.bindings, 'binding'], [c.dtos, 'DTO'], [c.schemas, 'schema']].filter(([n]) => n > 0);
    rows.push(['Component', parts.map(([n, a, b]) => plural(n, a, b)).join(' · ') || 'its header', 'Its endpoints become references: no functions come along.']);
    return rows;
  }
  if (sum.handler) rows.push(['Handler', sum.handler, sum.inside > 0 ? `and ${plural(sum.inside, 'function')} it calls inside ${svc}` : null]);
  if (sum.calls?.length) rows.push(['Calls it makes', String(sum.calls.length), sum.calls.map((x) => nice(x.label)).join(', ')]);
  if (sum.stores?.length) rows.push(['Stores', sum.stores.map((x) => x.key).join(', '), 'with their schemas']);
  const msgs = (c.dtos ?? 0) + (c.messages ?? 0);
  if (msgs) rows.push(['Messages', plural(msgs, 'DTO')]);
  if ((c.channels ?? 0) + (c.bindings ?? 0)) rows.push(['Queues and topics', plural(c.channels ?? 0, 'channel'), `${plural(c.bindings ?? 0, 'binding')} between this call and its consumers`]);
  return rows;
}

/** openImport({ panel, flowsEl, anchor, source }) -> the preview is loaded into the flows page's side panel. */
export function openImport({ panel, flowsEl, anchor, source }) {
  const to = ingressOf(anchor), body = h('div.imp-body', h('p.small.muted', 'Looking at what comes along…'));
  const title = to ? `Import ${to.service} · ${to.ingress}` : `Import ${String(anchor).replace(/^svc:/, '')}`;
  const sub = h('span.xs.muted', `from ${source} (now) into draft ${state.draft} · one level`);
  const h3 = h('h3', title), kind = h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } }, lockChip({ source }, { short: true }));
  flowsEl?.classList.add('mp-open');
  panel.open(h('div.ep-head', kind, h3, sub), h('div.ep-pad', { 'data-qa': 'import-panel' }, body));
  const close = () => panel.close();
  const reopen = (a) => openImport({ panel, flowsEl, anchor: a, source });

  api.importPreview(state.env, state.draft, { source, anchor }).then((p) => {
    const mine = [...(p.alreadyHere ?? []), ...(p.items ?? [])].find((x) => x.anchor === p.anchor);
    if (mine) { h3.textContent = `Import ${to?.service ?? ''} · ${nice(mine.label)}`; if (to) kind.prepend(chip(transportOf(mine.label))); }
    const go = h('button.btn.primary', { type: 'button', 'data-qa': 'import-go', on: { click: () => run(go, p) } }, `Import ${plural(p.total, 'item')} into draft`);
    fill(body,
      h('div.imp-sec', h('h4', `Comes along: ${plural(p.total, 'item')}`),
        h('dl.kv', comesAlong(p).map(([k, v, small]) => [h('dt', k), h('dd', h('span.mono', v), small ? [' ', h('small.muted', small)] : null)]))),
      p.alreadyHere?.length ? h('details.imp-sec', h('summary', `Already here: ${p.alreadyHere.length}`),
        h('ul.imp-list', p.alreadyHere.map((x) => h('li', h('span.mono', nice(x.label)), x.differs ? h('small.muted', ' kept as in this design') : null)))) : null,
      stays(p, reopen),
      h('p.xs.muted', `Imported items are unchanged against ${source}, so they get no spark. Edit them here and they show as Changed.`),
      p.warnings?.length ? h('p.xs.muted', p.warnings.join(' ')) : null,
      h('div.imp-acts', go, h('button.btn', { type: 'button', on: { click: close } }, 'Cancel')));
  }).catch((err) => fill(body, err.code === 'NOTHING_TO_IMPORT' || err.status === 409 && /nothing/i.test(err.message)
    ? h('div.info-note', { 'data-qa': 'import-nothing' }, h('p', `Nothing to import: everything this brings is already in the design.`), h('button.btn', { type: 'button', on: { click: close } }, 'Close'))
    : h('div.error-box', { 'data-qa': 'import-error' }, err.message)));

  async function run(btn, p) {
    btn.disabled = true;
    try {
      const out = await api.importIntoDraft(state.env, state.draft, { source, anchor }, me());
      toast(`Imported ${plural(out?.preview?.total ?? p.total, 'item')} into draft ${state.draft}`);
      panel.close();
      afterEdit();
    } catch (err) { btn.disabled = false; fill(body, h('div.error-box', err.message)); }
  }
}

function stays(p, reopen) {
  const refs = (p.references ?? []).filter((r) => r.state !== 'designed');
  if (!refs.length) return null;
  return h('div.imp-sec', h('h4', `Stays a reference: ${plural(refs.length, 'component')}`),
    h('ul.imp-list', refs.map((r) => h('li.imp-ref', lockChip({ source: p.source }, { short: true }), h('span.mono', `${r.service} · ${nice(r.bindKey)}`),
      h('small.muted', r.state === 'new-reference' ? 'new: a stub comes along' : ''),
      h('button.btn.sm', { type: 'button', 'data-qa': 'import-next', on: { click: () => reopen(`ing:${r.service}/${r.ingress}`) } }, 'Import')))));
}
