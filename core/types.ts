// Shared types for the in-memory graph model. Pure types — no runtime code.
// The model mirrors the manifest (schema/manifest.schema.json) with service/env attached.

import type { Links } from './links.ts';

export type Transport = 'http' | 'rpc' | 'grpc' | 'sns' | 'sqs' | 'amqp' | 'eventbridge' | 'cron' | 'socket' | 'event' | 'other' | 'undecided';
export type Delivery = 'unicast' | 'multicast';
export type Mode = 'sync' | 'async';
export type Match = 'exact' | 'glob' | 'amqp-topic';
export type ServiceKind = 'service' | 'gateway' | 'lambda' | 'infra' | 'client-app';
export type Details = Record<string, unknown>;

/** Where an item is defined: code or IaC file and line. `commit`/`repo` override the service's for this item's link. */
export interface Source { file?: string; line?: number; col?: number; url?: string; repo?: string; commit?: string }
/** Which harvester run produced an item, and whether it was checked against the live system. */
export interface Provenance { producer?: string; runId?: string; verified?: 'match' | 'drift' | 'code-only' }
/** Something the harvester found but could not resolve: the target (call or consumer) or the event type. */
/** what=caller (on a function): the backward walk stopped here because nothing could be resolved as its caller. */
export interface Unresolved { what: 'target' | 'event' | 'caller' | 'client' | 'instance' | 'detail'; reason: string; detail?: string; candidates?: string[];
  /** #85: false = not a real missing hop (built-in receiver, ...). Display only: nothing counts on it. */ gap?: boolean;
  /** #85: the reason in plain English. */ plain?: string }
/** A value the harvester filled by a rule (a default, a convention), not from code (#47, 0.25.2). The mirror of `Unresolved`: `what` is a first-class name or 'detail' with `detail` the field path. */
export interface Assumed { what: string; value: unknown; basis: string; reason: string; detail?: string }

export interface Service {
  name: string;
  links?: Links;
  kind: ServiceKind;
  team?: string;
  repo?: string;
  language?: string;
  description?: string;
  /** Markdown-lite, at most 20 000 characters (0.30.2). */
  about?: string;
  /** User ids of the owners (0.33.0, core/owners.ts); writers send names or external ids and the server matches them. */
  owners?: string[];
  tags?: string[];
  /** Subsystem path ("platform", later "platform/identity"); optional. */
  groupPath?: string;
  /** Free-form; in a design `doc` says where the component comes from. */
  details?: Details;
  version: number;
  harvestedAt: string;
  commit?: string;
}

export type GroupKind = 'alt' | 'opt' | 'loop' | 'par' | 'critical' | 'break';
/** One frame a step sits in: `id` unique within the function, `condition` names the branch (a section of the frame). */
export interface StepGroup { id: string; kind?: GroupKind; condition?: string }

export interface Step {
  seq: number;
  type: 'call' | 'egress' | 'resource';
  /** Absent only when `unresolved` says why (a call-graph gap), or for a classified leaf (see `isLeaf`). */
  target?: string;
  /** 'frontier': part of a call tree that reaches no sink; collapsed in traces unless asked for. Default 'path'. */
  origin?: 'path' | 'frontier';
  /** 'leaf': a step that ends the tree and has no target (its `operation` and `note` say what it is). */
  kind?: 'leaf';
  mode?: Mode;
  operation?: string;
  condition?: string;
  /** Steps of this function with the same `altGroup` are mutually exclusive alternatives, one branch per condition. */
  altGroup?: string;
  /** 0.32.2 (#72): the frames this step sits in, outermost first (nesting inside one function). Replaces `altGroup` / `condition` for the grouping of this step. */
  groups?: StepGroup[];
  /** 0.32.2 (#75): a step the design adds (`new`) or changes (`changed`); drawn as a band on its arrow; `details.changed` stays the tooltip. */
  mark?: 'new' | 'changed';
  /** 0.32.2 (#74): on a leaf step, the components (or data stores) its note spans (leftmost to rightmost). */
  over?: string[];
  /** 0.33.2 (#81): what the call returns: the label of the dashed return arrow and a longer detail for the step panel. */
  returns?: { label: string; detail?: string };
  /** 0.36.1 (#82): either/or groups of this step, stored as given (`details.alternatives` is read when this is absent, see `altsOf`). */
  alternatives?: StepAlternative[];
  /** 0.36.1 (#82): the caller's literal fixes an arm of a group; scoped to the path like `bind`. `details.fixes` is read when absent (`fixesOf`). */
  fixes?: StepFix[];
  loop?: boolean;
  note?: string;
  /** Event type this egress step publishes (one of the egress's `events`). */
  event?: string;
  /** On a `call` step: values bound for the callee (and everything below it on this path), by name. An egress step with `eventFrom` reads one. */
  bind?: Record<string, string>;
  /** On an egress step: the event type is the nearest enclosing `bind` of this name on the traced call path (#42). */
  eventFrom?: string;
  /** For a resource step: read or write, when the operation name does not make it clear. */
  access?: 'read' | 'write' | 'read_write';
  /** For a resource step: fields the call touches (names only). */
  fields?: StepField[];
  /** Free-form. On a resource step of a Redis instance: `keyTemplate` (the key it touches, #29), `dbIndex`, `ttlSeconds`. */
  details?: Details;
  unresolved?: Unresolved[];
  assumed?: Assumed[];
  /** Where the call is made (file, line, col). */
  source?: Source;
}

/** A step with no target that the harvester classified: `kind: 'leaf'`, or a call with an operation or note. */
export const isLeaf = (st: Pick<Step, 'type' | 'target' | 'kind' | 'operation' | 'note'>) =>
  !st.target && (st.kind === 'leaf' || (st.type === 'call' && !!(st.operation || st.note)));

/** An either/or group (#82). Extra fields are kept and returned as they came. */
export interface StepAlternative { group_id: string; arms: { arm: string; label?: string; guard_text?: string; step_ids: string[]; [k: string]: unknown }[]; name?: string; name_source?: string; llm_name?: string | null; llm_provenance?: object | null; depends_on?: 'data' | 'message'; guard?: { text?: string; file?: string; line?: number }; [k: string]: unknown }

export interface StepFix { group_id: string; arm: string; source?: { file?: string; line?: number; [k: string]: unknown }; literal?: unknown; [k: string]: unknown }

export interface StepField { role: 'filter' | 'projection' | 'update' | 'sort'; path: string; operator?: string; inDdl?: boolean; ddlRef?: string; flag?: string }

export interface Fn { service: string; id: string; name: string; links?: Links; file?: string; line?: number; commit?: string; details?: Details; steps: Step[]; unresolved?: Unresolved[]; assumed?: Assumed[] }
/** An event type a consumer handles. `type` may be a glob (`Order*`, `*`); `producers` are declared, not derived. */
export interface IngressEvent { type: string; handler: string; producers?: string[] }
export interface Ingress {
  service: string; id: string; bindKey: string; match?: Match; transport: Transport;
  handler: string; entryPoint?: boolean; details?: Details; links?: Links;
  /** Middleware functions that run before the handler, in order (ids of functions of the same service). Traced as ordinary function visits. */
  middleware?: string[];
  events?: IngressEvent[];
  /** How the handler was resolved (registration, bind): hops from the registration to the handler. `details.handlerVia` is read too (core/via.ts). */
  via?: ViaHop[];
  source?: Source; provenance?: Provenance; unresolved?: Unresolved[]; assumed?: Assumed[];
}
/** One wrapper between a call site and the real SDK call (the last hop calls the SDK). Never a node or edge. */
export interface ViaHop { function: string; file?: string; line?: number; col?: number; kind?: string; repo?: string; commit?: string }
/** A driver package as the harvester found it. `versionSource` says where the version came from (lockfile, package.json…). */
export interface DriverRef { package: string; version?: string; versionSource?: string }
/** The wrapper library a service reaches a store through, and the driver bundled inside it. */
export interface LibRef extends DriverRef { kind?: 'in_house' | 'third_party'; driver?: DriverRef | null }
export type AccessMode = 'direct_driver' | 'shared_lib' | 'self_implemented_wrapper' | 'third_party_lib';
/** How a service reaches a data store (on a resource) or a non-store target (on an egress). Missing values go in `unresolved` (what 'client'). */
export interface ClientInfo { accessMode?: AccessMode; accessId?: string; /** Redis: the database indexes this client selects. */ databases?: number[]; driver?: DriverRef | null; lib?: LibRef | null; via?: ViaHop[] }
export interface CallSite { file: string; line?: number; function?: string; via?: ViaHop[] }
export interface Egress {
  service: string; id: string; bindKey: string; transport: Transport;
  mode?: Mode; delivery?: Delivery; details?: Details;
  /** Wrapper chain; `details.via` is read too (see core/via.ts). */
  via?: ViaHop[]; callSites?: CallSite[];
  /** How this call reaches a non-store target (driver, wrapper lib). */
  client?: ClientInfo;
  /** Event types published through this egress (literal). */
  events?: string[];
  source?: Source; provenance?: Provenance; unresolved?: Unresolved[]; assumed?: Assumed[];
}
export interface Resource { service: string; id: string; kind: string; name: string; bindKey?: string; details?: Details; client?: ClientInfo; source?: Source; provenance?: Provenance; unresolved?: Unresolved[]; assumed?: Assumed[] }
export interface Channel {
  service: string; bindKey: string; kind: 'sns-topic' | 'sqs-queue' | 'amqp-exchange' | 'amqp-queue' | 'eventbridge-bus' | 'other';
  name?: string; delivery?: Delivery; details?: Details;
  source?: Source; provenance?: Provenance;
}
export interface Binding {
  service: string; id: string; from: string; match?: Match; to: string;
  filter?: Details; details?: Details;
  /** Event types this subscription lets through: '*' or a list of names/globs. Absent means all. */
  events?: '*' | string[];
  source?: Source; provenance?: Provenance;
}

/** Everything known about one environment. */
export interface Model {
  env: string;
  services: Service[];
  functions: Fn[];
  ingress: Ingress[];
  egress: Egress[];
  resources: Resource[];
  channels: Channel[];
  bindings: Binding[];
}

/** Reference to an endpoint in the graph. */
export type Ref =
  | { type: 'ingress'; service: string; id: string }
  | { type: 'egress'; service: string; id: string }
  | { type: 'channel'; key: string }
  | { type: 'binding'; service: string; id: string };

/** A resolved hop. `via` says why it exists. */
export interface Link {
  from: Ref;
  to: Ref;
  via: 'key' | 'pattern' | 'binding';
  mode: Mode;
  transport: Transport;
  /** The subscription this hop goes through, when via = 'binding'. */
  binding?: { service: string; id: string };
}

export interface Resolution {
  links: Link[];
  dangling: Egress[];            // egress matching nothing
  orphans: Ingress[];            // non-entry ingress nothing reaches
  unbound: { channel: Channel; reason: string }[];
  brokenBindings: Binding[];     // binding whose target matches nothing
  ambiguous: { egress: Egress; candidates: Ingress[] }[];
}
