// Shared types for the in-memory graph model. Pure types — no runtime code.
// The model mirrors the manifest (schema/manifest.schema.json) with service/env attached.

export type Transport = 'http' | 'rpc' | 'grpc' | 'sns' | 'sqs' | 'amqp' | 'eventbridge' | 'cron' | 'event' | 'other';
export type Delivery = 'unicast' | 'multicast';
export type Mode = 'sync' | 'async';
export type Match = 'exact' | 'glob';
export type ServiceKind = 'service' | 'gateway' | 'lambda' | 'infra';
export type Details = Record<string, unknown>;

/** Where an item is defined: code or IaC file and line. `commit`/`repo` override the service's for this item's link. */
export interface Source { file?: string; line?: number; col?: number; url?: string; repo?: string; commit?: string }
/** Which harvester run produced an item, and whether it was checked against the live system. */
export interface Provenance { producer?: string; runId?: string; verified?: 'match' | 'drift' | 'code-only' }
/** Something the harvester found but could not resolve: the target (call or consumer) or the event type. */
/** what=caller (on a function): the backward walk stopped here because nothing could be resolved as its caller. */
export interface Unresolved { what: 'target' | 'event' | 'caller'; reason: string; detail?: string; candidates?: string[] }

export interface Service {
  name: string;
  kind: ServiceKind;
  team?: string;
  repo?: string;
  language?: string;
  description?: string;
  tags?: string[];
  version: number;
  harvestedAt: string;
  commit?: string;
}

export interface Step {
  seq: number;
  type: 'call' | 'egress' | 'resource';
  /** Absent only when `unresolved` says why (a call-graph gap). */
  target: string;
  mode?: Mode;
  operation?: string;
  condition?: string;
  loop?: boolean;
  note?: string;
  /** Event type this egress step publishes (one of the egress's `events`). */
  event?: string;
  /** For a resource step: read or write, when the operation name does not make it clear. */
  access?: 'read' | 'write';
  unresolved?: Unresolved[];
  /** Where the call is made (file, line, col). */
  source?: Source;
}

export interface Fn { service: string; id: string; name: string; file?: string; line?: number; commit?: string; steps: Step[]; unresolved?: Unresolved[] }
/** An event type a consumer handles. `type` may be a glob (`Order*`, `*`); `producers` are declared, not derived. */
export interface IngressEvent { type: string; handler: string; producers?: string[] }
export interface Ingress {
  service: string; id: string; bindKey: string; match?: Match; transport: Transport;
  handler: string; entryPoint?: boolean; details?: Details;
  events?: IngressEvent[];
  /** How the handler was resolved (registration, bind): hops from the registration to the handler. `details.handlerVia` is read too (core/via.ts). */
  via?: ViaHop[];
  source?: Source; provenance?: Provenance; unresolved?: Unresolved[];
}
/** One wrapper between a call site and the real SDK call (the last hop calls the SDK). Never a node or edge. */
export interface ViaHop { function: string; file?: string; line?: number; col?: number; kind?: string; repo?: string; commit?: string }
export interface CallSite { file: string; line?: number; function?: string; via?: ViaHop[] }
export interface Egress {
  service: string; id: string; bindKey: string; transport: Transport;
  mode?: Mode; delivery?: Delivery; details?: Details;
  /** Wrapper chain; `details.via` is read too (see core/via.ts). */
  via?: ViaHop[]; callSites?: CallSite[];
  /** Event types published through this egress (literal). */
  events?: string[];
  source?: Source; provenance?: Provenance; unresolved?: Unresolved[];
}
export interface Resource { service: string; id: string; kind: string; name: string; bindKey?: string; details?: Details; source?: Source; provenance?: Provenance; unresolved?: Unresolved[] }
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
