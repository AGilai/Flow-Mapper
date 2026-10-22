// Flow tools: traces, descriptions, event types, endpoints, channels and exchanges.

import { HttpError } from '../../errors.ts';
import * as dtos from '../../store/dtos.ts';
import * as desc from '../../store/descriptions.ts';
import * as keys from '../../store/keys.ts';
import { exchangeView } from '../../../core/amqp-exchange.ts';
import { endpointInfo } from '../../../core/endpoint-info.ts';
import { eventTypes, eventView } from '../../../core/events.ts';
import { eventFlow } from '../../../core/event-flow.ts';
import { channelView } from '../../../core/channels.ts';
import { trace } from '../../../core/trace.ts';
import { viewOf as traceView } from '../../../core/trace-view.ts';
import { viewParams } from '../../../core/trace-view-params.ts';
import { traceOut } from '../../refs.ts';
import { type Tool, env, obj, envOf, draftArg, viewOf } from './common.ts';

export const traceFlowTool: Tool = {
  name: 'trace_flow',
  description: "Follow a flow from an ingress or function (in a design environment a message into a copied endpoint whose behaviour lives in its source carries `reference` {anchor, source}, and `partial.steps` lists them: those steps' behaviour is not in the design; `start.name` is the flow's name; egress messages carry `via`, the wrapper chain; display only): ordered calls, DB access, REST calls and async hops across services. RabbitMQ: a publish through an exchange carries `amqp` (exchange, routingKey, type, bindings that match / do not) and its hops `filter.bindingKey`; an RPC over AMQP (`amqp-rpc:{command}`) is a sync call carrying `rpc` (command, queues, timeout). scope 'intra' stays inside the service. A message whose step has either/or `alternatives` (0.36.1) carries them verbatim with `stepId` (`<service>:<fn>#<seq>`, what `arms[].step_ids` name); display only. `detail` (0.37.1, #82): 'external' (the default: ingress, calls out of a service, deliveries, DB operations, problems; consecutive DB operations of one store are one row `DB: N ops (collections)`, internal calls are left out) or 'full' (every internal call too; use it before describing steps); `open` brings back the internal calls of the named services (`svc`) or functions (`svc:fn`). Alternatives are either/or: `decisions` lists each choice with its `arms`; the view follows the FIRST arm of each unless `choose` ({group_id: arm}, or 'both') says otherwise, a decision with a `lock` is fixed by its caller, and `counts` are exact unless a decision is on 'both' (then min-max): never add the arms up. A step that can fail carries `canFail` [{when, error, source}] and a step of the only arm that leads to a flow carries `onlyWhen` {guard, source} (0.38.1, read from `details.can_fail` / `details.only_when`; either/or is only where both arms lead to a flow). Messages carry `key` (stable step key), `arms` (`group_id:arm`) and `dbGroup`. Fields listed in `assumed` ({what, value, basis, reason}) are defaults a harvester filled by a rule, not facts read from code; do not present them as verified.",
  inputSchema: obj({ draft: draftArg, service: { type: 'string' }, ingress: { type: 'string' }, fn: { type: 'string' }, event: { type: 'string', description: 'Start from the handler of this event type at the ingress' }, expand: { type: 'array', items: { type: 'string' }, description: 'Services to show function by function' }, scope: { enum: ['intra', 'full'] }, detail: { enum: ['external', 'full'], description: "Default external; full adds every internal call" }, choose: { type: 'object', additionalProperties: { type: 'string' }, description: "Either/or decisions: {group_id: arm}; 'both' keeps every arm; '*': 'both' makes both the default. Unlisted decisions follow their first arm" }, open: { type: 'array', items: { type: 'string' }, description: "External view: services ('svc') or functions ('svc:fn') whose internal calls to show" }, dbOpen: { type: 'array', items: { type: 'string' }, description: 'Keys of DB-op rows to leave expanded' }, env, maxMessages: { type: 'integer', description: 'Cap on counted messages. Alternatives (messages with alt) count as their largest branch.' }, frontier: { type: 'boolean', description: "Also show steps the harvester marked origin 'frontier' (call trees that reach no sink). Off by default: one 'frontier: N steps' marker per function, not counted in maxMessages" } }, ['service']),
  run: (c, a) => {
    const g = viewOf(c, a).g;
    const t = trace(g, a, { scope: a.scope, maxMessages: Math.min(a.maxMessages ?? 300, 2000), expand: a.expand, frontier: a.frontier === true })
      ?? (() => { throw new HttpError(404, 'NOT_FOUND', 'start point not found (give ingress or fn)'); })();
    let view;
    try { view = viewParams(a); } catch (e) { throw new HttpError(400, 'BAD_REQUEST', (e as Error).message); }
    const out = traceOut(c, envOf(a), a.draft || null, traceView(t, view));
    return a.ingress ? { ...out, descriptions: desc.describeFlow(c.db, g, envOf(a), a.service, a.ingress) } : out;
  },
};

export const setDescriptionTool: Tool = {
  name: 'set_description',
  description: "Save the AI description of a flow (no callee) or of one service in it (callee: the service name, 'service:handler' for one delivery, or a step key '#step:<from>><to>|<label>|<transport>' built from one message of trace_flow, for one arrow). Writes the AI record only: a human note on the same flow is never touched. Stores the model and the flow's trace hash, so the UI marks the text outdated when the flow changes. Read the flow first with trace_flow and get_service; use only facts found there.",
  inputSchema: obj({ service: { type: 'string', description: "The flow's entry service" }, ingress: { type: 'string', description: "The flow's entry ingress id" }, callee: { type: 'string', description: "Omit for the whole flow; a service name (or service:handler) for that service's part, or #step:<message.from>><message.to>|<message.label>|<message.transport> (transport empty when absent) for one arrow; a second identical arrow ends in ~2" }, text: { type: 'string', description: 'Plain text, at most 4000 characters (may be empty for a step that gets only a title)' }, title: { type: 'string', description: 'Optional, for a step (#step: callee) only: a short title for the arrow, at most 80 characters, shown on the step bar; ignored for other callees. Omit to keep the stored title, empty to clear it' }, model: { type: 'string', description: 'Your model name, for example claude-sonnet-5-5' }, env }, ['service', 'ingress', 'text', 'model']),
  run: (c, a) => {
    const extra = Object.keys(a).filter((k) => !['env', 'service', 'ingress', 'callee', 'text', 'title', 'model'].includes(k));
    if (extra.length) throw new HttpError(400, 'BAD_REQUEST', `unknown argument(s): ${extra.join(', ')}. set_description writes the AI record only`);
    return desc.putAi(c.db, c.graph(envOf(a)), envOf(a), a);
  },
};

export const eventTypesTool: Tool = {
  name: 'event_types',
  description: 'Event types in the environment: who publishes each one and which consumers (and handlers) receive it after subscription filters. Give type for one event type with its Message DTO and `flow`: per producer service its call sites and, per topic or direct send, one row per queue and consumer service with the outcome (handled, no-handler, possible, filtered, no-reader), a one-sentence summary and callouts.',
  inputSchema: obj({ draft: draftArg, env, type: { type: 'string' } }),
  run: (c, a) => {
    const { g, reader } = viewOf(c, a);
    const all = eventTypes(g);
    if (!a.type) return all;
    const t = eventView(g, a.type) ?? (() => { throw new HttpError(404, 'NOT_FOUND', `event type '${a.type}' not found`); })();
    return { ...t, flow: eventFlow(g, a.type), dto: reader.getEventDto(a.type) };
  },
};

export const getEndpointInfoTool: Tool = {
  name: 'get_endpoint_info', description: "One ingress endpoint (producers of its events carry `via` when they call through a wrapper): its handler, a link to the handler's code in the repo, its DTO slots (a queue takes one message; a GET its path/query params and a response body), and for event consumers each event type with its handler, derived/declared producers, status (ok, unhandled, never, declared-only) and Message DTO. Fields listed in `assumed` ({what, value, basis, reason}) are defaults a harvester filled by a rule, not facts read from code; do not present them as verified.",
  inputSchema: obj({ draft: draftArg, service: { type: 'string' }, ingress: { type: 'string', description: 'Ingress id' }, env }, ['service', 'ingress']),
  run: (c, a) => { const { g, reader } = viewOf(c, a); return endpointInfo(g, a.service, a.ingress, reader.endpointDtos(a.service, a.ingress), reader.listEventDtos())
    ?? (() => { throw new HttpError(404, 'NOT_FOUND', `ingress '${a.ingress}' of service '${a.service}' not found`); })(); },
};

export const getChannelTool: Tool = {
  name: 'get_channel', description: 'A topic, queue, exchange or event bus by key (for an exchange page, the publishers, bindings and callouts, use get_exchange): publishers, subscriptions/rules with event filters, consumers, event types passing through, problems, and `flow`: merged subscription rows (declarations that disagree are named), a grid of event type x destination (handled, filtered, arrives with no handler) and a one-sentence summary with callouts.',
  inputSchema: obj({ draft: draftArg, env, key: { type: 'string' } }, ['key']),
  run: (c, a) => channelView(viewOf(c, a).g, a.key) ?? (() => { throw new HttpError(404, 'NOT_FOUND', `channel '${a.key}' not found`); })(),
};

export const getExchangeTool: Tool = {
  name: 'get_exchange', description: "A RabbitMQ exchange page (0.19.0) by key `amqp:<exchange>` or bare name: type, vhost, durable, alternateExchange, `publishers` (one row per service and routing key: `reaches` the bindings that route it, `dropped` when none does, publishedIn), `bindings` (binding key to queue, consumers with handlers, `matchedBy` the published keys, `noPublisher`) and `callouts` (a published key that matches no binding is dropped or goes to the alternate exchange; a binding no harvested publisher feeds). Same data as GET /api/envs/:env/instances/amqp:<exchange>. get_channel returns the exchange's flow rows instead.",
  inputSchema: obj({ draft: draftArg, env, key: { type: 'string' } }, ['key']),
  run: (c, a) => exchangeView(viewOf(c, a).g, a.key) ?? (() => { throw new HttpError(404, 'NOT_FOUND', `exchange '${a.key}' not found`); })(),
};
