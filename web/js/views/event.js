// Event type page: identity, the verdict with its callouts, the flow lanes (producer, topic, queue,
// consumer with the outcome inside), then the Message DTO collapsed. A click on a service opens its
// card in the side panel. See docs/UI-GUIDE.md.

import { h } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { href } from '../router.js';
import { ago, chip } from '../format.js';
import { pageHead } from '../components/page.js';
import { jsonView } from '../components/json-view.js';
import { dtoSource } from '../components/dto-source.js';
import { createPanel } from '../components/panel.js';
import { summary } from '../components/summary.js';
import { titled } from '../components/object-icon.js';
import { eventFlowBlock } from './event-flow.js';
import { eventCompact } from './hub-event.js';
import { viewToggle } from './hub-parts.js';
import { eventPath } from './inventory-links.js';
import { consumerPanel, producerPanel } from './event-panel.js';

const PREVIEW_LINES = 10;
const section = (title, hint, ...body) => h('section.flow-section', h('header', h('h2', title), hint ? h('span.hint', hint) : null), ...body);

/** The Message DTO: the first lines, with "Show all N lines" for the full viewer. */
function message(v) {
  if (!v.dto) return h('div.ep-empty', h('p', 'No message DTO yet.'), h('code.key', `PUT /api/envs/${state.env}/event-dtos/${v.type}`));
  const text = JSON.stringify(v.dto.content, null, 2);
  const lines = text.split('\n');
  const box = h('div.msg-box');
  const draw = (all) => box.replaceChildren(...[dtoSource(v.dto),
    all ? jsonView(v.dto.content) : h('pre.msg-pre', lines.slice(0, PREVIEW_LINES).join('\n') + (lines.length > PREVIEW_LINES ? '\n…' : '')),
    lines.length > PREVIEW_LINES ? h('button.btn.ghost.show-more', { type: 'button', on: { click: () => draw(!all) } }, all ? 'Show fewer lines' : `Show all ${lines.length} lines`) : null].filter(Boolean));
  draw(false);
  return box;
}

export async function render({ main, params, query }) {
  const compact = query?.get('view') !== 'full';
  const v = await api.eventType(state.env, params.type);
  const flow = v.flow;
  const host = h('div.panel-host');
  let selected = null;
  const panel = createPanel(host, { onClose: () => { selected?.classList.remove('selected'); selected = null; } });
  const open = (kind, service, el) => {
    selected?.classList.remove('selected');
    selected = el;
    el.classList.add('selected');
    panel.open(...(kind === 'producer' ? producerPanel(flow, service) : consumerPanel(flow, service)));
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const lanes = compact ? eventCompact(flow, { open }) : eventFlowBlock(flow, { type: v.type, open });
  const meta = v.dto ? h('span.meta', h('span', 'Message DTO updated ', h('b', ago(v.dto.updatedAt)))) : h('span.meta', h('span', 'No message DTO yet'));

  main.append(
    pageHead(h('span.title-row', titled('event', 'event', v.type), chip('event', 'Event type')), meta,
      viewToggle(eventPath(v.type), compact ? 'compact' : 'full'),
      h('a.btn', { href: href('/inventory', { type: 'event' }) }, 'All event types')),
    host);
  host.prepend(h('div.content', h('div.flow-page',
    summary(flow.summary, { reveal: () => lanes.reveal() }),
    compact
      ? h('section.flow-section', h('header', h('h2', 'How it flows'), h('span.hint', 'Click a consumer for its route and handler.'), lanes.toolbar), lanes)
      : section('How it flows', 'From each producer to each consumer, left to right. Click a service for its code and handler.', lanes),
    section('Message', v.dto ? `Updated ${ago(v.dto.updatedAt)}` : null, message(v)))));
  return { dispose: panel.dispose };
}
