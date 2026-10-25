// The shapes of a trace (moved out of trace.ts in 0.37.0, #82; trace.ts re-exports them).

import type { CanFail, OnlyWhen } from './step-marks.ts';
import type { Alt } from './alt.ts';
import type { SourceLink } from './endpoint-info.ts';
import type { LinkedHop } from './via.ts';
import type { AmqpRoute, RpcInfo } from './amqp-route.ts';
import type { BlockedSite, Coverage } from './incomplete.ts';
import type { Mode, StepAlternative, StepFix, StepField, Unresolved } from './types.ts';

export interface Participant {
  id: string; label: string; kind: 'client' | 'function' | 'service' | 'channel' | 'resource' | 'missing' | 'unresolved'; service?: string;
  /** Service lifelines: function calls inside that service on this trace (what expanding would show). */
  internalCalls?: number;
  /** #87: a service lifeline of an external (third-party) service. */
  external?: true;
}
export interface Message {
  from: string; to: string; label: string; mode: Mode;
  kind: 'entry' | 'call' | 'egress' | 'deliver' | 'resource' | 'leaf' | 'frontier';
  depth: number; internal?: boolean; broken?: boolean; cycle?: boolean;
  condition?: string; loop?: boolean; alternatives?: StepAlternative[]; fixes?: StepFix[]; stepId?: string; // 0.36.1 (#82): the step's either/or groups as sent, and the id `arms[].step_ids` use (`<service>:<fn>#<seq>`)
  mark?: 'new' | 'changed'; changed?: string; over?: string[]; real?: string; returns?: { label: string; detail?: string }; self?: boolean; returnTo?: string; // 0.41.1: a return step's target; 0.33.2: what the call returns (#81); 0.33.1: a mermaid import's `%% real:` bind key, the return's label, a self-message; 0.32.2: the step's mark and its details.changed text (#75), the components a leaf note spans (#74)
  alt?: Alt;                                                 // the step is one of several alternatives (an alt frame): group, branch (1-based), number of branches; the message keeps its `condition` note?: string; fn?: string; service?: string; transport?: string; protocol?: 'tls' | 'tcp' | 'ws';
  event?: string; unhandled?: boolean; operation?: string; // operation: a call out's own words (`POST /token`); `label` is that plus the bind key
  eventFrom?: { name: string; boundAt?: string };            // the event came from a caller's bind (#42): the name, and where it was bound (`<caller fn>:<seq>`); no boundAt: nothing on this path binds it
  possible?: boolean;                                        // delivered only if the publisher's event is one of its candidates (the step names no event)
  seq?: number;                                              // step number in the calling function
  target?: { service: string; ingress: string; fn?: string }; // ingress reached, and the handler that runs
  store?: string; storeKind?: string; owner?: string; access?: 'read' | 'write' | 'read_write' | 'unknown'; // resource steps (owner, 0.30.1: the component that declares the store, for the flow view's subsystem band): data-store key; its driver (`mongodb`); read / write from the step's `access`, else its operation (0.27.1, the drawing's line weight)
  fields?: StepField[];                                      // fields a resource step touches (role, path, operator, inDdl)
  calls?: string;                                            // function called, for call steps (same service)
  egress?: string;                                           // egress id, for calls out (its call site is in `code`)
  via?: LinkedHop[];                                         // wrappers the call goes through (last one calls the SDK); display only
  handlerVia?: LinkedHop[];                                  // how the ingress resolved to its handler (registration / bind hops); display only
  origin?: 'frontier';                                       // a step the harvester marked as frontier (shown because the trace was asked to expand them)
  frontierSteps?: number;                                    // on a kind 'frontier' marker: frontier steps folded into it (this function's and those of the frontier calls below it)
  assumed?: { field: string; value: unknown; basis: string; reason: string }[]; // #47: details of a resource step the harvester filled by a rule
  keyTemplate?: string; dbIndex?: number; ttlSeconds?: number; keyUnresolved?: string[]; // #86, on a resource step: the key (details.keyTemplate, else keyPattern), db, TTL; the reasons when the key is `{unresolved:...}`
  unknown?: { field: string; reason: string }[];           // on a resource step: details the harvester could not read (`unresolved` what=detail: keyTemplate, dbIndex, ttlSeconds) and why
  gap?: Unresolved;                                          // the harvester could not resolve this call; why
  provenance?: { kind?: 'llm' };                              // #85 (reserved): a step or edge a model inferred (drawn dash-dot with a tag); nothing sends it yet
  blocked?: BlockedSite;                                     // #85: the step has an unresolved entry with `gap: true` (a call the flow could not follow)
  frontierBlocked?: number; frontierSites?: BlockedSite[];   // #85, on a kind 'frontier' marker: how many of its folded steps are blocked, and the first 20
  group?: string;                                            // SNS fan-out: id of the publish (`m<index of the publish message>`), on the publish and on each of its deliveries
  deliveries?: number;                                       // on the publish message of a fan-out: how many deliveries follow it
  matched?: string[];                                        // on deliveries of an untyped publish: the event types (its events / candidates) that the subscription's filter let through
  repeatOf?: number;                                         // a delivery already expanded earlier in this trace (#43): the 1-based step (message number) of the first one. Nothing is expanded below it; it does not count toward maxMessages
  middleware?: { fn: string; index: number };                // the message comes from this middleware function of the ingress (0-based position in `ingress.middleware`) or from a call it made; absent for the handler's own
  middlewareChain?: { fn: string; name: string }[];          // on a message that reaches an ingress (entry / egress / deliver): its middleware, in the order they run before the handler
  n?: number;                                                // #73 (additive): the 1-based message number, on a message that starts deferred work (a delivery, an async call). `of` points back at it
  of?: number;                                               // #73 (additive): this message belongs to the work started by message `n` === of (its innermost one): a consumer's steps carry their delivery's number, an async callee's its call's. Absent in the caller's own flow
  n?: number;                                                // #73 (additive): the 1-based message number, on a message that starts deferred work (a delivery, an async call); `of` points back at it
  of?: number;                                               // #73 (additive): the message belongs to the work started by message number `of` (the innermost one): a consumer's steps carry their delivery's `n`, an async callee's its call's. Absent on the caller's own flow
  delivery?: number;                                         // on the topic -> queue and queue -> consumer messages of one delivery: 1-based ordinal within the group
  amqp?: AmqpRoute;                                          // an AMQP publish through an exchange (0.18.0), on the publish and the hops after it: exchange, routing key, type, how many bindings route it and the ones that do not
  rpc?: RpcInfo;                                             // an RPC over AMQP (0.18.0; bind key `amqp-rpc:{command}`, transport amqp, mode sync): the command and the AMQP details both sides declared
  arms?: string[];                                           // 0.37.0 (#82): the either/or arms this message sits in, outermost first, each `<group_id>:<arm>` (split at the first ':'). Absent when none
  key?: string;                                              // 0.37.0: the stable step key (core/description.ts stepKeys) over the canonical trace; stamped when the trace has decisions and on every view that drops messages
  canFail?: CanFail[];                                       // 0.38.1 (#82): the step succeeds but can fail (`details.can_fail`): when, error, source. On a DB-group row: the members' entries together
  onlyWhen?: OnlyWhen;                                       // 0.38.1: the step is in the only arm that leads to a flow (`details.only_when`): the guard. On a DB-group row: the members' guards
  dbGroup?: DbGroup;                                         // 0.37.1: a run of consecutive DB operations of one store folded into this one row (viewOf); `label` reads `DB: 3 ops (users, devices)`
  filter?: HopFilter;                                        // on a hop that goes through a subscription, rule or binding (topic -> queue, bus -> target, exchange -> queue): what it declares
}
/** The subscription behind a hop: its id, the key it listens on (SNS topic, bus, `exchange/routing-key`) and the event types it lets through (absent: all). */
export interface HopFilter { id: string; service: string; from: string; events?: '*' | string[]; /** An AMQP binding: its key as written in code (`details.bindingKey`, else the part of `from` after the exchange). */ bindingKey?: string; match?: string; /** Headers exchange: the binding's headers and x-match. */ headers?: Record<string, unknown>; xMatch?: 'all' | 'any' }
/** 0.37.1: consecutive DB operations folded into one row: how many, the collections in order of first use, the access of the run, and the keys of the members (in the canonical numbering). */
export interface DbGroup { count: number; collections: string[]; access: 'read' | 'write' | 'read_write' | 'unknown'; members: string[] }
/** 0.37.0: one either/or decision of a flow. `name` is `llm_name` when there is one, else the template name (`template_name`). `parent`: the arm of another decision it sits in. `lock`: every place that reaches it fixes the same arm (`at` = the first fixing step, `<service>:<fn>#<seq>`); `lock_places` when only some places fix it. */
export interface Decision {
  group_id: string; /** 0.38.2: 'alt' on a decision made from an alt frame (altGroup, file:line or design frame); its arms are `b1..bN`. */ from?: 'alt'; name?: string; template_name?: string; llm_name?: string | null; depends_on?: 'data' | 'message'; guard?: { text?: string; file?: string; line?: number };
  parent?: { group_id: string; arm: string }; lock?: { arm: string; at: string; source?: { file?: string; line?: number }; literal?: unknown }; lock_places?: { fixed: number; of: number };
  arms: { arm: string; label?: string; guard_text?: string; steps: { min: number; max: number } }[];
  /** On a view: what is in force, an arm name or 'both'. */
  chosen?: string;
}
export interface Trace {
  start: { service: string; ingress?: string; fn: string; event?: string }; scope: 'intra' | 'full';
  participants: Participant[]; messages: Message[]; truncated: boolean;
  /** An entry point with no handler (none named, or none for the requested event) (0.25.1, #59): an empty flow (the entry participant, no messages) that can still be fetched, described and linked. */
  noHandler?: true;
  /** Code location of every function on the trace, by `${service}:${fn}`, of call sites, by `egress:${service}:${id}`, and of steps that carry a `source`, by `step:${service}:${fn}#${seq}`. */
  code: Record<string, SourceLink | null>;
  /** #85: `details.coverage` of the entry ingress (what its harvester reports about its own service), when it has one; each site carries its repository `url` when known. */
  coverage?: Coverage;
  /** 0.37.0: the either/or decisions the flow reaches, in first-seen order. Absent when there are none. */
  decisions?: Decision[];
  /** 0.37.1, on a view only (viewOf): what was applied. */
  detail?: 'external' | 'full'; choose?: Record<string, string>; warnings?: string[]; counts?: { messages: { min: number; max: number } };
}

export interface TraceOptions { scope?: 'intra' | 'full'; maxDepth?: number; maxMessages?: number; expand?: string[];
  /** Show steps marked `origin: 'frontier'`. Off by default: each function gets one collapsed marker and they do not count toward maxMessages. */
  frontier?: boolean;
  /** Perf batch 4: for callers that only count messages and decisions (the Flows list): `participants` is left in discovery order, not laid out (the lifeline order is the costly part and nothing reads it). */
  countsOnly?: boolean }
