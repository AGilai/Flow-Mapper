# Importing an HLD into a design environment (guide for agents)

You are an AI agent. You read a team's high-level design (HLD) documents and produce an **import plan**: one
JSON file that Flow-Mapper will later apply to a design environment as one draft. The draft write path
(increment 1b) is not built yet, so today you **build the plan and validate it read-only**. You write nothing
to any environment.

Contract files: `schema/manifest.schema.json` (manifest format), `docs/API.md` (REST + MCP),
`docs/HARVESTER-GUIDE.md` (bind keys, events, DTOs), `docs/plans/design-envs.md` (what 1b will do).
Examples use an illustrative SASE design: subsystems `agent`, `network` (POP), `platform`.
Items marked **[proposal]** are not in the schema or the server yet; use them as written, they may be renamed.

## 1. Connection

You run against **your own** Flow-Mapper instance (a clone of github.com/AGilai/Flow-Mapper), never someone
else's. Use a configurable base URL, `FLOW` (default `http://localhost:3000`).

```sh
git clone git@github.com:AGilai/Flow-Mapper.git && cd Flow-Mapper   # Node >= 22.18, no npm install needed
mkdir -p /tmp/fm && FLOW_DB=/tmp/fm/flow.db FLOW_DATA_DIR=/tmp/fm PORT=3000 npm run dev
FLOW_DB=/tmp/fm/flow.db FLOW_DATA_DIR=/tmp/fm npm run seed          # optional: sample data into env `prod`
curl -s $FLOW/api/version    # need >= 0.21.0 (groupPath, client-app, environments)
curl -s $FLOW/api/envs/meta  # environments with kind sealed | design
```

- `FLOW_DB`, `FLOW_DATA_DIR`, `PORT` are read in `server/config.ts`. Without them the server uses `data/`.
- "prod" below means the `prod` environment **of your instance**: whatever its harvesters (or `npm run seed`) put
  there. If your instance has no real prod data, reuse decisions are guesses: say so in the plan.
- REST base: `$FLOW/api`. No auth.
- MCP over HTTP: `POST $FLOW/mcp`, one JSON-RPC 2.0 message per request (no SSE; `GET /mcp` is 405).
- MCP over stdio: `FLOW_DB=/tmp/fm/flow.db node --disable-warning=ExperimentalWarning server/mcp/stdio.ts`
  (same as `npm run mcp`). It opens the database file directly: point `FLOW_DB` at the same file as the server.
- Every MCP tool takes `env`; it **defaults to `default`**, not `prod`. Always pass `env: "prod"`.
- **Never call a write tool against `prod`** (`ingest_manifest` without `dryRun: true`, `upsert_entity`,
  `delete_entity`, `load_dtos`, `load_schemas`, `set_description`, `create_env`, REST POST/PUT/PATCH/DELETE).
  `prod` is sealed, but a real ingest into it is still accepted (it is the harvester path), so the guard will not save you.

Keep the plan in your own workspace (e.g. `hld-import/plan.json`). You hand it over; Flow-Mapper applies it later.

## 2. What a design is

```
environment (kind design, copied from a sealed source such as prod)
└─ subsystem            env group {key, label}; a service points at it with service.groupPath
   └─ component         a service: kind service | gateway | lambda | infra | client-app
      ├─ endpoints      ingress: how others reach it (bindKey, transport, handler function)
      ├─ calls          egress (bindKey, transport, mode) + the function step that makes the call
      ├─ channels       topics / queues / exchanges / buses, and bindings (subscriptions) between them
      ├─ stores         resources (bindKey like mongodb:<db>/<collection>), plus store schemas
      └─ messages       endpoint DTOs (request/response) and event DTOs (one per event type)
flow = an entry endpoint (entryPoint: true) + its handler's ordered steps, followed across services by bind key
```

- **Sealed** environment: filled only by harvesters (ingest, DTOs, schemas). Manual edits are refused (409 `ENV_SEALED`).
- **Design** environment: created by copying another one (`blank`, `components`, `full`). Harvester ingest is refused
  (409 `ENV_DESIGN`). It owns its rows: nothing is shared with the source. The copied rows are frozen as its
  **baseline**, so 1b can mark items New / Changed / Removed against it.
- A **Components** copy brings the picked services with endpoints, calls, channels, stores, DTOs and schemas, but
  **no functions or steps**: prod flows do not come along, and a copied endpoint's `handler` dangles. Your new flows
  may still call copied endpoints; the trace ends there.
- A flow only draws if every hop is wired: ingress `handler` -> function -> step (`type: egress`, `target` egress id)
  -> egress `bindKey` == callee ingress `bindKey` (or a channel key) -> callee handler -> ... Resolution matches the
  key string only. A call with no function step behind it is a map edge, not part of a flow.
- `client-app` (an agent, a mobile app) calls services and has no endpoints of its own to harvest. To start a flow
  on it, give it one entry ingress **[decided, 0.21.0]**: `transport: "other"`, `entryPoint: true`, a key nothing else
  produces (`bindKey: "client:sase-agent/tunnel-open"`; an ingress without `bindKey` is rejected), and
  `details.trigger` saying what starts it. Its handler's egress steps are the app's calls.

## 3. Classify the documentation

Read every document once end to end, then classify. Rules:

1. **One item per real-world thing.** A service named in three sections is one component. An API shown in a diagram
   and a table is one endpoint. Merge synonyms ("Policy Cache", "PPC") and record the aliases in the mapping table.
2. Map each statement to the smallest item that holds it:

| The doc says | Item |
|---|---|
| a system area, team boundary, deployment tier | subsystem (`groups[]`, `groupPath`) |
| a deployable service, lambda, gateway, agent / app | component (`service.kind`; agent = `client-app`) |
| "X exposes / serves / handles ..." | ingress on X |
| "X calls / sends to / queries Y" | egress on X + a step in the X function that does it + ingress on Y |
| "X publishes E to topic T", "Y consumes E" | egress (transport sns/amqp/..., `events`) + channel + binding + Y ingress `events` |
| "X stores / reads ... in DB" | resource on X + resource step |
| a payload, message, schema, field list | endpoint DTO or event DTO (§7e); a collection layout is a store schema |
| a sequence diagram, use case, "when the user ..." | flow (§7d): entry endpoint + ordered steps |
| "Network talks to Platform" with no component or endpoint yet | abstract link (§6), not a manifest item |

3. **Provenance on every item.** Record where it came from: document file, section heading, line (if known), and a
   short verbatim quote (at most ~200 characters). Where it goes:

| Item | Field (today) |
|---|---|
| ingress, egress, resource, channel, binding | `details.doc` **[proposal shape]** + `provenance: {producer: "hld-import", runId: "<planId>"}` |
| function step | `details.doc` **[proposal shape]**; `note` for a one-line human reading |
| service header, function | **no free field** (header and function are `additionalProperties: false`): record it in the plan's `mapping` table, keyed by anchor `svc:<name>` / `fn:<svc>/<id>` |
| endpoint / event DTO | `meta: {source: {file, line}, provenance: "hld", incomplete: "<what is missing>"}` (existing fields) |
| store schema, abstract link, flow, subsystem | the plan entry itself (`doc` field) |

Do not use `source` for documents: it is the code location, and the UI builds repo links from it. The contract
report will say `missing-source` (info) for your items; that is expected.

`details.doc` shape **[proposal]**:

```json
{ "file": "hld/03-pop.md", "section": "3.2 Tunnel setup", "line": 41,
  "quote": "pop-edge exchanges the device certificate for a session token at the platform auth service",
  "confidence": "stated", "questions": ["Q4"] }
```

4. **Confidence**: `stated` = the doc says it explicitly; `inferred` = you concluded it (a name, a direction, a
   transport, which existing endpoint is meant). Every `inferred` item that matters gets an open question (§7h).
5. Never invent detail to make the schema happy. Leave it out and say so (§6).

## 4. Reuse before you invent

For **every** component, endpoint, channel, event type and store the doc mentions, search prod first:

| Question | MCP (`env: "prod"`) | REST |
|---|---|---|
| does a service / endpoint / channel by this name or path exist? | `search {query}` | `GET /api/envs/prod/search?q=` |
| what does service X offer and call? | `get_service {service}` | `GET /api/envs/prod/views/service/X` |
| one endpoint: handler, DTOs, callers | `get_endpoint_info {service, ingress}` | `GET /api/envs/prod/endpoints/X/<ingress>` |
| where do flows start? what does one do? | `list_entry_points`, `trace_flow {service, ingress}` | `GET .../entry-points`, `GET .../trace?service=&ingress=` |
| which event types exist, who publishes / consumes them? | `event_types {type?}`, `get_channel {key}` | `GET .../inventory?type=event` |
| a store and its readers / writers | `get_store {key}` | `GET .../stores/<key>` |
| what a Components copy would bring | — | `GET /api/envs/prod/components`, `GET .../neighbours?services=a,b` |

Decide one of three for each item and record it in the mapping table:

- **reuse**: it exists. Reference it by its **exact** prod name and bind key (copy them from the tool output; never
  retype). The component goes into `environment.copy` (it comes in by the Components copy). Do not write a manifest for it.
- **extend**: the component exists but the doc adds an endpoint, call, store or event to it. Write an `extensions`
  entry (§7c) with only the new items. Never restate its existing items.
- **new**: nothing in prod matches. Write a full manifest (§7b).

Near misses (same purpose, different path or name) are open questions, not silent reuse. The doc saying "new token
endpoint" when prod's `POST /token` could serve is exactly the kind of thing to raise.

## 5. Bind keys and names

- Component names: lowercase, digits, `-` (`pop-edge`, `policy-compiler`). For reused ones, prod's name.
- Keys follow HARVESTER-GUIDE "Bind keys": `http:POST auth-svc/token`, `rpc:pop-policy-cache/Policy.GetTenantPolicy`,
  `amqp:telemetry/flow.log`, `sns:tenant-config-events`, `mongodb:tenant-db/policies`. Caller and callee must
  produce the identical string.
- Ids are stable and readable: ingress `in.token.exchange`, egress `out.auth.token`, function `TunnelHandler.open`.

## 6. High-level and incomplete items

**Call without parameters.** Write the egress and step; leave out DTOs and request detail. Do not write
`"params": "tbd"`. The UI shows "params not specified". Add a question if the doc implies parameters.

**Transport not decided.** The agreed value is `transport: "undecided"`, but it is **not in the schema yet**
(check `schema/manifest.schema.json` `$defs.transport`). Until it is, encode it so it validates today (**temporary**):

```json
{ "id": "out.policy.get", "transport": "other", "bindKey": "tbd:pop-policy-cache/GetTenantPolicy",
  "details": { "transport": "undecided", "doc": { "file": "hld/03-pop.md", "section": "3.4", "confidence": "stated",
    "quote": "transport to be decided (gRPC or AMQP RPC)" }, "candidates": ["grpc", "amqp"] } }
```

The callee ingress uses the same `transport: "other"`, the same `tbd:` key and `details.transport: "undecided"`.
The `tbd:<callee>/<operation>` key form is a **[proposal]**: it links the two ends without pretending to be http.
When `undecided` lands in the schema, replace `other` + `details.transport` with `transport: "undecided"`, keep the key.

**Mode unknown**: leave `mode` out; do not guess. **Callee component unknown**: do not write a dangling egress;
write an abstract link instead.

**Abstract links** (subsystem to subsystem, or component to subsystem, with no endpoints yet; phase 3). They are
**not** manifest items. Put them in the plan's `links` section, shaped like the planned `abstract_links` table:

```json
{ "id": "usage-metering", "name": "usage metering", "from": "grp:network", "to": "grp:platform",
  "mode": "async", "transport": null,
  "description": "POPs report per-tenant traffic volumes so the platform can bill and enforce quotas.",
  "doc": { "file": "hld/05-billing.md", "section": "5.1", "confidence": "stated", "quote": "..." } }
```

`from` / `to` are anchors: `grp:<groupKey>`, `svc:<component>` or `ing:<component>/<ingressId>`. `transport` is null
or a transport value. Refine one end to a component when the doc names it; when both ends are endpoints, it is a
call: move it into the manifests and delete the link.

## 7. The import plan

One JSON file (`plan.json`), or a folder with `plan.json` plus `manifests/<component>.json` that it references by
path. Keep keys in this order; never rename them; bump `planVersion` only when this guide changes the format.

```json
{
  "planVersion": 1,
  "planId": "sase-hld-2026-10-21",
  "createdAt": "2026-10-21T12:00:00Z",
  "createdBy": "agent:<model>",
  "sources": [{ "file": "hld/03-pop.md", "title": "POP architecture", "revision": "v0.4 / 2026-10-12" }],
  "environment": { ... },   "manifests": [ ... ],  "extensions": [ ... ],
  "flows": [ ... ],         "dtos": [ ... ],       "schemas": [ ... ],
  "links": [ ... ],         "mapping": [ ... ],    "questions": [ ... ]
}
```

**(a) environment**: the body of `POST /api/envs` / MCP `create_env`, plus a `doc` per group:

```json
{ "name": "sase-hld", "source": "prod", "mode": "components",
  "groups": [ { "key": "agent", "label": "Agent" }, { "key": "network", "label": "Network (POP)" },
              { "key": "platform", "label": "Platform" } ],
  "levels": ["Subsystem", "Component"],
  "services": [ { "name": "auth-svc", "groupPath": "platform" }, { "name": "users-svc", "groupPath": "platform" } ] }
```

`services` = the prod components to copy (every **reuse** and **extend** decision). Groups are listed in display order;
a key is a path (`platform`, later `platform/identity`).

**(b) manifests**: one **full** manifest per **new** component, valid against the schema:

```json
{ "schemaVersion": "1.0", "kind": "full", "env": "sase-hld", "version": 1, "harvestedAt": "2026-10-21T12:00:00Z",
  "service": { "name": "pop-edge", "kind": "service", "team": "network", "groupPath": "network",
               "description": "Terminates agent tunnels at the POP" },
  "functions": [ { "id": "TunnelHandler.open", "name": "TunnelHandler.open", "steps": [
      { "seq": 1, "type": "egress", "target": "out.auth.token", "operation": "POST /token",
        "details": { "doc": { "file": "hld/03-pop.md", "section": "3.2", "confidence": "stated", "quote": "..." } } },
      { "seq": 2, "type": "egress", "target": "out.policy.get", "note": "fetch the tenant policy bundle" } ] } ],
  "ingress": [ { "id": "in.tunnel.open", "transport": "socket", "bindKey": "socket:tls/pop-edge/tunnel-open",
      "handler": "TunnelHandler.open", "details": { "protocol": "tls", "event": "tunnel.open" },
      "provenance": { "producer": "hld-import", "runId": "sase-hld-2026-10-21" } } ],
  "egress": [ { "id": "out.auth.token", "transport": "http", "mode": "sync", "bindKey": "http:POST auth-svc/token" },
              { "id": "out.policy.get", "transport": "other", "bindKey": "tbd:pop-policy-cache/GetTenantPolicy",
                "details": { "transport": "undecided" } } ]
}
```

- `env` is the design name; `version: 1`; `harvestedAt` = plan time. Leave out `repo` and `commit` unless the doc gives them.
- Every ingress `handler` and every step `target` must exist in the same manifest (else 422). Give each new
  endpoint a handler function, even if its only step is a leaf: `{ "seq": 1, "type": "call", "kind": "leaf", "note": "validates and stores" }`.
- Channels and bindings of new topics/queues go in the manifest of the component that owns them (or a new `infra`
  component when the doc describes shared messaging).

**(c) extensions**: new items on a **reused** prod component. One entry per component; whole items only:

```json
{ "service": "auth-svc", "baseVersion": 7,
  "upsert": { "ingress": [ { "id": "in.token.device", "transport": "http", "bindKey": "http:POST auth-svc/token/device",
      "handler": "TokenController.device", "details": { "method": "POST", "path": "/token/device", "doc": { "...": "..." } } } ],
    "functions": [ { "id": "TokenController.device", "name": "TokenController.device", "steps": [] } ] },
  "groupPath": "platform" }
```

`baseVersion` = the prod version you read (`get_service` -> version), for the record. Each upserted item becomes one
draft op at apply time. Do not delete prod items in an extension; if the doc removes something, ask (§7h).

**(d) flows**: one per use case / sequence diagram. Refer to the entry by component and ingress id:

```json
{ "entry": { "service": "sase-agent", "ingress": "in.tunnel.open" }, "name": "Agent connects to POP",
  "description": "The agent opens a TLS tunnel to the nearest POP; the POP authenticates the device and applies the tenant policy.",
  "steps": [ { "n": 1, "from": "sase-agent", "to": "pop-edge", "text": "Agent opens the tunnel with its device certificate." },
             { "n": 2, "from": "pop-edge", "to": "auth-svc", "text": "Trades the certificate for a session token." } ],
  "doc": { "file": "hld/03-pop.md", "section": "3.2 Tunnel setup", "confidence": "stated" } }
```

Steps are plain text in trace order (each arrow, returns excluded). After apply, Flow-Mapper turns each into a step key
`#step:<from>><to>|<label>|<transport>` (docs/API.md "Step keys"); you cannot compute it reliably before the flow
traces, so add `stepKey` only if you checked it against a trace. Each `from -> to` must be a call the manifests wire.

**(e) dtos**: the `load_dtos` body shape, unchanged:
`{service, ingress, role: "request" | "response", status?, content, meta}` for endpoints and `{event, content, meta}`
for event types. `content` is an example or a JSON Schema; partial shapes set `meta.incomplete`. Allowed roles depend
on the endpoint (HARVESTER-GUIDE "DTOs"): a consumer with `events` takes event DTOs only, a cron none.
**(e2) schemas**: `{key, source: "manual", content}` per new or changed collection.

**(f) links**: abstract links (§6).

**(g) mapping**: every doc section you used, and what came of it. This is the reviewer's main table:

```json
{ "doc": { "file": "hld/03-pop.md", "section": "3.2 Tunnel setup", "line": 41 },
  "items": [ { "anchor": "svc:pop-edge", "decision": "new", "confidence": "stated", "aliases": ["Edge Gateway"] },
             { "anchor": "ing:auth-svc/in.token", "decision": "reuse", "confidence": "inferred", "questions": ["Q4"] } ] }
```

Anchors: `svc:<s>`, `ing:<s>/<id>`, `egr:<s>/<id>`, `fn:<s>/<id>`, `res:<s>/<id>`, `ch:<key>`, `evt:<type>`,
`dto:<s>/<ingress>/<role>`, `flow:<s>/<ingress>`, `grp:<key>`, `link:<id>`. Also list sections that produced
nothing, with `"items": []` and a reason, so nothing reads as skipped.

**(h) questions**: `{ "id": "Q4", "text": "Should pop-edge use prod's POST /token with a device_cert grant instead of a
new /token/exchange?", "about": ["egr:pop-edge/out.auth.token"], "options": ["reuse POST /token", "new endpoint"],
"default": "reuse POST /token", "blocking": false }`. `blocking: true` only when the plan cannot be applied without an answer.

## 8. Validate today (read-only)

There is no dry run against a design environment: ingest into a design env is refused with 409 `ENV_DESIGN`, and
the guard runs before the dry run rolls back. So validate against the **source** env (`prod`) with `dryRun`:

1. Copy each manifest and set its `env` to `"prod"`. For each extension build a delta:
   `{schemaVersion: "1.0", kind: "delta", env: "prod", service: <prod header from get_service>, version: baseVersion + 1,
   baseVersion, harvestedAt, upsert}`.
2. Send them **in one batch**, so links between new components resolve:
   - MCP: `ingest_manifest { "manifests": [ ... ], "dryRun": true }`
   - REST: `POST $FLOW/api/ingest?dryRun=1` with `{"manifests": [ ... ]}`

   The response is `{dryRun: true, results: [{env, service, fromVersion, toVersion, changes, contract}]}` and nothing
   is written (the transaction is rolled back). **Check `dryRun: true` is in the response.** If it is missing, you
   wrote to prod: stop and tell the maintainer.
3. Read the errors (whole batch rejected, nothing applied):
   - `422 INVALID`: schema or internal reference; `details` gives JSON paths (prefixed `manifests[i]`). Fix and resend.
   - `409 VERSION_NOT_NEWER` on a full manifest: a "new" component already exists in prod. Reclassify it as reuse/extend.
   - `409 VERSION_MISMATCH` / `404 NOT_FOUND` on a delta: wrong `baseVersion`, or the component is not in prod.
4. Read each `contract`: `dangling-egress` means a bind key matches nothing in prod + your batch: fix the spelling
   against the callee, or it is a real gap (question or abstract link). `egress-no-events`, `binding-empty-events`,
   `filter-matches-nothing`: fix events. `missing-source` (info): expected for docs.
5. DTOs and schemas: there is no dry run. Check roles against the table in HARVESTER-GUIDE and that `content` is
   valid JSON. Do **not** call `load_dtos` / `load_schemas` on prod.
6. Optional, closest to the real result: on a **scratch instance** (own `FLOW_DB`), `npm run seed`, create the
   design with `create_env` (the seed already makes a demo `sase-hld`: pick another name), then in that scratch copy only you may add your items through the entity routes
   (`POST /api/envs/sase-hld/services`, `PUT .../services/<s>/<list>/<id>`) and look at the map and `trace_flow`.
   Throw that database away afterwards; the plan file stays the deliverable.

## 9. How the plan will be applied (after 1b)

1. `create_env` with `environment` (Components copy of the reused / extended prod components into subsystems).
   The copied rows become the frozen baseline.
2. Open a draft (MCP `open_draft`), named after the plan.
3. Convert the plan to whole-item ops (`edit_in_draft`): `header` + `entity` upserts per new manifest,
   `entity` upserts per extension item, `dto` / `event_dto` / `schema` upserts, `link` upserts (phase 3).
4. Review: marks show New / Changed against the baseline; the mapping table and questions go to the reviewer.
5. `apply_draft`. Then flow names and descriptions (`set_description`, step keys from the trace).

Not now: do not create design environments on a shared instance, do not ingest (without `dryRun`) anywhere, do not
write DTOs, schemas or descriptions, do not report bugs about missing design features. Produce the file.

## 10. Checklist

- [ ] Own instance running, version >= 0.21.0, `FLOW` set; every MCP call passes `env: "prod"`.
- [ ] All HLD documents listed in `sources` with revision.
- [ ] Subsystems listed in order with labels; every component has a `groupPath` from them.
- [ ] Each component, endpoint, channel, event type, store searched in prod; decision reuse / extend / new recorded.
- [ ] Reused items referenced by exact prod name and bind key; reused components listed in `environment.services`.
- [ ] One full manifest per new component; one extension entry per extended component, whole items only.
- [ ] Every ingress has a handler function; every step target exists; every flow hop is wired by bind key.
- [ ] Undecided transports use `other` + `details.transport: "undecided"` + `tbd:` key (temporary).
- [ ] Links without endpoints are in `links`, not in manifests.
- [ ] Provenance on every item (`details.doc`, `mapping`, DTO `meta`); confidence `stated` / `inferred`.
- [ ] Flows have name, description and per-step text in order.
- [ ] Every doc section appears in `mapping`; every `inferred` decision that matters has a question.
- [ ] Dry run of all manifests + extensions in one batch returned `dryRun: true`, no 4xx, and every
      `dangling-egress` is fixed or explained by a question.
- [ ] Nothing written to `prod`.
