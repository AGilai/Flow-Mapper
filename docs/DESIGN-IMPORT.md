# Importing an HLD into a design environment (guide for agents)

You are an AI agent. You read a team's high-level design (HLD) documents and produce an **import plan**: one
JSON file that Flow-Mapper applies to a design environment as one draft (`apply_import_plan`). You **build the plan and
check it with a dry run** (§8): a dry run adds the ops to a draft, applies them, reports and rolls everything back, so you
write nothing to any environment. A person reviews the draft and applies it.

Contract files: `schema/manifest.schema.json` (manifest format), `docs/API.md` (REST + MCP, Drafts and Marks),
`docs/HARVESTER-GUIDE.md` (bind keys, events, DTOs), `docs/plans/design-envs.md` (decisions).
Examples use an illustrative SASE design: subsystems `agent`, `network` (POP), `platform`.
Items marked **[proposal]** are conventions the server does not check (the shape of `details.doc`); use them as written, they may be renamed.

## 1. Connection

You run against **your own** Flow-Mapper instance (a clone of github.com/AGilai/Flow-Mapper), never someone
else's. Use a configurable base URL, `FLOW` (default `http://localhost:3000`).

```sh
git clone git@github.com:AGilai/Flow-Mapper.git && cd Flow-Mapper   # Node >= 22.18, no npm install needed
mkdir -p /tmp/fm && FLOW_DB=/tmp/fm/flow.db FLOW_DATA_DIR=/tmp/fm PORT=3000 npm run dev
FLOW_DB=/tmp/fm/flow.db FLOW_DATA_DIR=/tmp/fm npm run seed          # optional: sample data into env `prod`
curl -s $FLOW/api/version    # need >= 0.23.0 (drafts, marks, undecided, plan import)
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
- **Never call a write tool against `prod`** (`ingest_manifest` without `dryRun: true`,
  `load_dtos`, `load_schemas`, `set_description`, `create_env`, REST POST/PUT/PATCH/DELETE).
  `prod` is sealed, but a real ingest into it is still accepted (it is the harvester path), so the guard will not save you. Dry runs and drafts are safe: they never write the environment.

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
  **baseline**: marks show items New / Changed / Removed against it.
- A **Components** copy brings the picked services with endpoints, calls, channels, stores, DTOs and schemas, but
  **no functions or steps**: prod flows do not come along, and a copied endpoint's `handler` dangles. Your new flows
  may still call copied endpoints; the trace ends there. Pass `behaviour: true` to `create_env` (0.25.1) to bring the
  picked services' functions and steps too: their flows trace as in prod, they show no marks and are not references.
  Use it for components the design keeps as they are; leave it off for ones you mean to redesign.
- A flow only draws if every hop is wired: ingress `handler` -> function -> step (`type: egress`, `target` egress id)
  -> egress `bindKey` == callee ingress `bindKey` (or a channel key) -> callee handler -> ... Resolution matches the
  key string only. A call with no function step behind it is a map edge, not part of a flow.
- `client-app` (an agent, a mobile app) calls services and has no endpoints of its own to harvest. To start a flow
  on it, give it one entry ingress **[decided, 0.21.0]**: `transport: "other"`, `entryPoint: true`, a key nothing else
  produces (`bindKey: "client:sase-agent/tunnel-open"`; an ingress without `bindKey` is rejected), and
  `details.trigger` saying what starts it. Its handler's egress steps are the app's calls. It is listed by `list_entry_points` and its flow traces through those steps into the called components.

- **Entry points: `entryPoint` on an ingress** (0.25.1). `true`: always an entry point. `false`: never one. Absent: the default rule
  (an ingress nothing reaches, an RPC command, and every `socket` ingress is listed). A **hop** (a tunnel, a BGP or BFD session: something
  a flow passes through, not where one starts) keeps its real transport (`socket`, ...) and sets `entryPoint: false`, so it is not listed as
  a flow of its own. A flow's real start (an agent, a cron, a public API) sets `entryPoint: true`. In `edit_design`, `entryPoint: null` clears
  the flag back to the default rule.

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
| service header, function | `details.doc` **[proposal shape]** (free-form `details` is accepted on both since 0.23.0); also the plan's `mapping` table, keyed by anchor `svc:<name>` / `fn:<svc>/<id>` |
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

**Transport not decided.** Use `transport: "undecided"` (0.23.0) on both ends, with a `tbd:<callee>/<operation>` key that links them without pretending to be http:

```json
{ "id": "out.policy.get", "transport": "undecided", "bindKey": "tbd:pop-policy-cache/GetTenantPolicy",
  "details": { "doc": { "file": "hld/03-pop.md", "section": "3.4", "confidence": "stated",
    "quote": "transport to be decided (gRPC or AMQP RPC)" }, "candidates": ["grpc", "amqp"] } }
```

The callee ingress uses the same `transport: "undecided"` and the same `tbd:` key. It resolves by key like any transport, reads as sync, and counts as linked
when the keys match; with no callee yet it is a dangling call in the contract report, which is the honest state (add a question). The earlier encoding
(`transport: "other"` + `details.transport: "undecided"`) is still accepted in a plan and converted, with a warning; do not write it any more.
Harvesters never send `undecided`.

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
`dto:<s>/<role>/<status or ->/<ingress>` (status `-` for the success response; the ingress is last because ids may hold `/`), `schema:<source>/<storeKey>`, `flow:<s>/<ingress>`, `grp:<key>`, `link:<id>`. The anchors of the mapping table are informational; the server's grammar is in docs/API.md. Also list sections that produced
nothing, with `"items": []` and a reason, so nothing reads as skipped.

**(h) questions**: `{ "id": "Q4", "text": "Should pop-edge use prod's POST /token with a device_cert grant instead of a
new /token/exchange?", "about": ["egr:pop-edge/out.auth.token"], "options": ["reuse POST /token", "new endpoint"],
"default": "reuse POST /token", "blocking": false }`. `blocking: true` only when the plan cannot be applied without an answer.

## 8. Validate (dry run, nothing is written)

Check the plan against a design environment with a **dry run**: it adds the plan's ops to a draft, applies them, returns the contract reports, and rolls everything back.

1. Make sure the design environment exists and a draft is open (a person or a script: `POST /api/envs`, `open_draft`). You write only into drafts.
2. `apply_import_plan { env, draft, plan, dryRun: true }` (MCP) or `POST $FLOW/api/envs/<env>/drafts/<slug>/plan?dryRun=1` with the plan as the body.
   The response has `dryRun: true`, `ops`, `counts`, `warnings`, `skipped`, `questions` and `results: [{env, service, fromVersion, toVersion, changes, contract}]`.
   **Check `dryRun: true` is in the response.** Without `dryRun` the call adds the ops to the draft (still not to the environment).
3. Read the errors (the whole plan is rejected, nothing is added):
   - `422 PLAN_VERSION`: `planVersion` is not 1. `PLAN_ENV`: `environment.name` is not this environment.
   - `422 PLAN_EXISTS`: a manifest for a component the environment (or the draft) already has: reclassify it as an extension. `PLAN_NO_SERVICE`: an extension of a component that is not there: add it to `environment.services` (copy) or write a manifest.
   - `422 INVALID`: `details` lists `{path, message}` with paths like `manifests[1].ingress[0].transport` (a file reference in `manifests`, a schema error, an extension with `delete`, a bad op).
   - `409 DRAFT_CLOSED` (the draft is applied or discarded), `409 ENV_SEALED` (that environment takes no drafts).
4. Read each `contract`: `dangling-egress` means a bind key matches nothing in the environment + your plan: fix the spelling against the callee, or it is a real gap (question; an `undecided` call with no callee yet reads like this). `egress-no-events`, `binding-empty-events`,
   `filter-matches-nothing`: fix events. `missing-source` (info): expected for docs.
5. DTOs and schemas are validated with the plan (roles against the endpoint's slots, a schema's store must be a resource of some component). To check DTOs on their own against the environment: `POST /api/envs/<env>/dtos?dryRun=1` (MCP `load_dtos` with `dryRun: true`), optionally `&draft=<slug>`.
6. Look at what the draft would mark: `GET /api/envs/<env>/marks?draft=<slug>` (MCP `get_marks`): the new components, the `+1 endpoint` phrases and the changed fields are what the reviewer will see. Not what you meant? Fix the plan and send it to a fresh draft.

You may also dry-run single manifests: `POST $FLOW/api/ingest?dryRun=1&draft=<slug>` (MCP `ingest_manifest` with `dryRun` and `draft`) checks them against the design environment as the draft leaves it.

## 9. How the plan is applied

1. A design environment exists (`create_env` with the plan's `environment`: a Components copy of the reused / extended prod components into subsystems). The copied rows are its frozen baseline.
2. A draft is open, named after the plan (MCP `open_draft`).
3. `apply_import_plan { env, draft, plan }` turns the plan into whole-item ops, recorded as AI edits: a header op (with `groupPath`) and one op per item for each manifest, one op per item of each extension, `flow:` / `dto:` / `evt:` / `schema:` ops.
   Links and questions are kept on the draft (`drafts.plan`) and reported (`skipped.links`, `questions.blocking`); a blocking question is shown to the reviewer, not enforced.
4. Review: marks show New / Changed against the baseline (`get_marks`, or the draft's changes); the mapping table and questions go to the reviewer. Edit the draft with `edit_in_draft` if needed.
5. `apply_draft` (a person decides): one delta per touched component, a full manifest per new one, in one transaction; DTOs, schemas, flow names and flow descriptions with it. Newer edit wins: whatever changed in the environment since the draft touched it is overwritten and listed.
   Per-step descriptions (`set_description`, step keys from the trace) come after.

6. **Bring prod's behaviour into the design instead of describing it again** (0.25.0). When the design copied a prod component without its functions, its endpoints are references (`get_marks` `refs`, a lock in the UI).
   If your plan needs to change or extend one, `import_preview {env, draft, source: "prod", anchor: "ing:<service>/<id>"}` says what would come along, `import_into_draft` brings it (one level: the endpoint, its flow inside the component and what it uses;
   what it calls in other components stays a reference, listed with its own anchor). Imported items start unchanged against prod. `svc:<service>` brings a component's endpoints as references. Both are AI edits and write the draft only.
7. **Edit with forms instead of raw ops** (0.25.0). `edit_design {env, draft, edit}` takes one of: component, endpoint, call, delete-call, flow (name, entry point, step order), dto, event-dto, delete. A call is an arrow that traces:
   `{kind: 'call', from: {service, fn}, to: {service, ingress} | {endpoint: {...}} | {bindKey, transport}}` makes the egress and the step; `{bindKey, transport: 'undecided'}` ends are fine. `set_flow_name` names a flow (with `draft`: in the draft).
   `edit_in_draft` stays for anything else. `get_call` says which side of a call is a reference. Errors name the form field (`BAD_NAME`, `NO_GROUP`, `NO_TARGET`...).

Not now: do not create design environments on a shared instance, do not ingest (without `dryRun`) anywhere, do not call `apply_draft`, do not write DTOs, schemas or descriptions outside a draft, do not report bugs about missing design features. Produce the file.

## 10. Checklist

- [ ] Own instance running, version >= 0.23.0, `FLOW` set; every MCP call passes `env: "prod"`.
- [ ] All HLD documents listed in `sources` with revision.
- [ ] Subsystems listed in order with labels; every component has a `groupPath` from them.
- [ ] Each component, endpoint, channel, event type, store searched in prod; decision reuse / extend / new recorded.
- [ ] Reused items referenced by exact prod name and bind key; reused components listed in `environment.services`.
- [ ] One full manifest per new component; one extension entry per extended component, whole items only.
- [ ] Every ingress has a handler function; every step target exists; every flow hop is wired by bind key.
- [ ] Undecided transports use `transport: "undecided"` + a `tbd:` key on both ends.
- [ ] Links without endpoints are in `links`, not in manifests.
- [ ] Provenance on every item (`details.doc`, `mapping`, DTO `meta`); confidence `stated` / `inferred`.
- [ ] Flows have name, description and per-step text in order.
- [ ] Every doc section appears in `mapping`; every `inferred` decision that matters has a question.
- [ ] Dry run of the whole plan (`apply_import_plan` with `dryRun: true`) returned `dryRun: true`, no 4xx, and every
      `dangling-egress` is fixed or explained by a question.
- [ ] Nothing written to `prod`.
