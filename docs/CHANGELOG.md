# Changelog for harvesters and importers

This file lists, per version, only what a harvester, importer or MCP agent needs to know: API and plan changes, new
fields, MCP tools, and anything breaking. Read it after every `git pull`. UI-only changes get one line. Details are
in [API.md](API.md), [DESIGN-IMPORT.md](DESIGN-IMPORT.md) and [HARVESTER-GUIDE.md](HARVESTER-GUIDE.md); demos are in
[DEMOS.md](DEMOS.md). **Breaking** marks a change that needs an update on your side.

## 0.30.2 (2026-10-22)
**`about`: a rich description per component and per subsystem** (bug #68, the data part; the dedicated info pane is a later, separate UI). Additive; no migration (it lives in the service header JSON and in `envs.groups` JSON).
- **Manifest (harvesters and importers):** optional **`service.about`**, a string of at most 20 000 characters, next to `description`. Markdown-lite: `##` / `###` headings, paragraphs, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, fenced code, `- ` and `1. ` lists, `[text](https://...)` links. No HTML (it is shown as text) and only `http(s)` links. By convention the sections `## Capabilities`, `## Motivation`, `## Roles and responsibilities`, `## Owners`, `## Open questions`; nothing enforces them. Status, doc links (`links`) and related flows already have their fields: do not repeat them in `about`. A changed `about` is a Changed mark on the component, like any header field. Over the limit or not a string: `422` from ingest.
- **Import plan:** `manifests[].service.about`; `extensions[].about` sets or replaces it on an existing component (`''` clears); `environment.groups[].about` (and `groups[]` of the plan) sets a subsystem's text. For a group the design already has, the plan's `about` replaces the stored one (a re-import is idempotent); its label is still kept. A too long group text is a warning and is left out.
- **Design edits (REST `edits`, MCP `edit_design`):** `{kind:'component', ..., about?}` and `{kind:'subsystem', key, about?}`; `''` (component) or `''` / `null` (subsystem) clears it, leaving it out keeps it. A text over 20 000 characters is `422 INVALID` with `field: 'about'`.
- **Subsystem lists:** `PUT /api/envs/:env/subsystems` (sealed), MCP `set_subsystem_settings` and `create_env` / `POST /api/envs` `groups[]` take `about` per group; a list item that leaves `about` out keeps the stored text, `''` or `null` clears it.
- **Reads:** `about` comes back wherever the header or the groups do: `get_service` / `GET /services/:name` (`service.about`), the system graph node, `GET .../subsystems` and `get_subsystems` (`subsystems[].about`), the subsystem map boxes, `GET /api/envs` (`groups[].about`).
- **UI:** an "About" block (folded after about 12 lines, "Show all") in the component page and map panel and in the subsystem panel; in a design draft the component form has an About field with Write / Preview, and the subsystem panel has "Edit".

## 0.30.0 (2026-10-22)
Step details: a step (one arrow of a flow) can carry a short **title** next to its description. Additive; migration `015_step_titles.sql` (`ALTER TABLE descriptions ADD COLUMN title TEXT`; backed up to `<db>.pre-015.bak` first; 014 belongs to another branch and the runner does not need contiguous numbers). Details in [API.md](API.md) "Flow descriptions".
- **Agents (MCP `set_description`):** new optional argument **`title`**, for a step (`callee` starting `#step:`) only: a short name for the arrow, at most 80 characters, trimmed; ignored for other callees. Omit it to keep the stored title, send `''` to clear it. `text` may be empty when the note carries a title (a title-only note). The human title wins over the AI title, like the text.
- **REST:** `PUT /api/envs/:env/descriptions` takes the same optional `title` (a step). Reads return `title` (string or null) in every `human` and `ai` record. An empty text with no title removes the human record. A title over 80 characters is `400`. `get_service` descriptions carry `title` when set.
- **Mermaid export:** a step with a title writes the title as the message text and the API (`POST /path`) into a `Note over` line.
- **UI:** the Step bar shows the step's title, API and description (`sb=`); the toolbar control "Step details" also puts title / description on the arrows (`sd=`; default API only); a step editor (button, pencil, right-click, key E).

## 0.29.2 (2026-10-22)
Comment importers (bug #66, first part): your own ids and times on comments, an idempotent re-import, and resolved threads. Additive; migration `014_comments_import.sql` (five new columns on `comments` and a partial unique index; the database is backed up to `<db>.pre-014.bak` first). Details in [API.md](API.md) "Comments under a flow". The users registry and @mention chips are not part of this: a mention stays plain `@Name` text.
- **`POST /api/envs/:env/comments` takes:** `createdAt` (ISO 8601, kept as that instant, stored as UTC; `400` if not a time or more than 5 minutes ahead), `externalSource` + `externalId` (both or neither, at most 200 characters each), `authorExternalId`, `parentExternalId` (instead of `parentId`; looked up by `externalSource` + that id in the same env, so send parents first; unknown is `400`), `resolved` (true/false) with `resolvedBy` / `resolvedAt`.
- **Re-import:** posting the same (`externalSource`, `externalId`) again **updates** that comment (body, author, step, `createdAt`, `authorExternalId`; `resolved` only when you send it) and answers **`200` with `updated: true`**; a new comment is **`201`** (**breaking** only if your client checked for exactly `200` on create: creating comments answered `200` before). It never duplicates. The same pair under a different flow is `409 EXTERNAL_ID_TAKEN`. A comment someone deleted comes back on re-import. `parentExternalId` of a reply is not re-parented.
- **Resolve:** `PATCH /api/envs/:env/comments/:id {actor, resolved: true|false}`: anyone may resolve or reopen a thread (top comment; a reply is `400`, its thread decides). Body edits stay author-only and cannot be sent in the same request. Reads return `externalId`, `externalSource`, `authorExternalId`, `resolved`, `resolvedBy`, `resolvedAt` per comment (replies show their thread's state), and the thread has `resolvedThreads`.
- **Counts changed:** `GET .../comments/counts` is now the number of **open top threads** per flow (resolved threads and replies are not counted).
- **Events:** `comment.resolved` and `comment.reopened` (once per change).
- **MCP:** `add_comment` takes the same fields (and returns `updated: true` on a re-import); new `resolve_comment {env, id, author, resolved}`; `list_comments` returns the new fields.
- **Copy:** a Full copy carries the importer ids and the resolved state.
- UI: "Resolve" / "Reopen" on a thread; resolved threads are hidden behind "Show resolved (n)"; an imported comment shows its given time and a small "imported" hint (tooltip: source and id).

## 0.29.1 (2026-10-22)
UI only: a Maximize button (key F) on every flow header fills the window with the flow, its action items and comments; `max=1` in the URL opens it that way.

## 0.29.0 (2026-10-22)
Action items under each flow: owner, description, status and due date, linked to comments. Additive; migration `013_action_items.sql` (two new tables, nothing existing is touched; the database is backed up to `<db>.pre-013.bak` first). Details in [API.md](API.md) "Action items under a flow".
- **REST:** `GET /api/envs/:env/action-items?anchor=flow:<s>/<i>[&draft=]` -> `{items, events, next}`; `GET .../action-items/counts` -> `{anchor: openCount}`; `POST` `{anchor, owner, description, status?, due?, step?, commentId?, actor}`; `PATCH .../:id` `{actor, owner?, description?, status?, due? (null clears), step? (null clears)}`; `DELETE .../:id?actor=`. Status is `open | progress | done | dropped`; `due` is `YYYY-MM-DD`. Numbers (`#1`, `#2`...) are per flow and never reused.
- **Rules:** anyone edits any field (the `actor` is kept in `updatedBy`); only the creator deletes (`403 NOT_CREATOR`). Validation errors are `400 VALIDATION`. Any environment takes them, sealed ones too, and `?draft=` works like comments.
- **Events (`GET /api/events`):** `action_item.created`, `action_item.updated`, `action_item.deleted`, each with `env` and `data {anchor, id, number, status, actor}`.
- **MCP:** `list_action_items {env, service, ingress, draft?}`, `add_action_item {env, service, ingress, owner, description, author, status?, due?, step?, commentId?, draft?}`, `update_action_item {env, id, author, owner?, description?, status?, due?, step?}`. What MCP writes has `source: "ai"` (a "by AI" chip in the UI). The tool list hash moved (three tools added).
- **Copy:** a Full copy carries items, their events and the comment links; Blank and Components copies do not.
- UI: an "Action items (3 open · 5)" section above Comments, "+ Action item" and "Make action item" on comments, events under a comment, and an open-actions badge per entry in the Flows list. The static preview shows them.

## 0.28.4 (2026-10-22)
Flows list in design environments, from #65. No migration.
- **Breaking (default flip):** a Components copy (`POST /api/envs {mode: "components"}`, MCP `create_env`) now defaults to `entryPoints: "none"`: copied ingress get `entryPoint: false` and are not entry points. Pass `entryPoints: "keep"` for the 0.28.3 behaviour. Full copies still default to `keep`. Existing environments are unchanged. `create_env`'s description changed (the tool list hash moved).
- UI: in a design environment the Flows list shows flows only (an entry point with a flow name, a description or `entryPoint: true`). "All endpoints" lists every endpoint as before and is kept in the URL (`endpoints=all`). A component's own list and harvested environments are unchanged.
- "Changed only" compares against the baseline, so a copied item equal to the baseline is not marked. This could not be reproduced on a fresh copy, an import or a `behaviour: true` copy; if you still see copies marked as changed, add to #65 how the environment was made.

## 0.28.3 (2026-10-21)
Two Components-copy options from the importer's bugs. Additive; no migration. Details in [API.md](API.md) (`POST /api/envs`) and [DESIGN-IMPORT.md](DESIGN-IMPORT.md).
- **`entryPoints: "keep" | "none"`** on `POST /api/envs` and MCP `create_env` (#63; default `keep`, today's behaviour). `none` sets `entryPoint: false` on every copied ingress, in the environment and in its baseline, so the copies are not entry points, show no marks and diff as unchanged; ingress added later are unaffected. Works for `components` and `full`; `422` for another value or for `blank`.
- **`infraGroupPath`** (#64; components mode, default `infra`): the synthetic `<source>-infra` service now has a `groupPath` (it had none), so it is a box in the subsystem view. Validated like any groupPath; it need not exist in `groups` (a derived box). **Behaviour change:** new Components copies carry `groupPath: "infra"` on that service. Existing copies are not migrated: set its `groupPath` with one edit.

## 0.28.2 (2026-10-21)
Flow-to-flow relations (#50). Additive; no migration (the table came with 012). Details in [API.md](API.md) "Flow relations" and [DESIGN-IMPORT.md](DESIGN-IMPORT.md).
- **Plan `links[]` between flows are applied now** (they were skipped with "flow relations land in 0.28.2"): `{from: "flow:<s>/<i>", to: "flow:<s>/<i>", type, note?}` with `type` one of `contradicts`, `variant-of`, `supersedes`, `same-topic` (`variant`, `variant_of`, `same_topic` accepted) becomes the draft item `rel:<id>`. A bad one is a warning and is skipped. The result's `links.flow` counts them, `links.skipped` / `skipped.links` only the ones not applied. **Counts that moved:** a plan with flow relations adds one op each.
- **Drafts imported before 0.28.2:** `POST .../drafts/:slug/plan/links` (MCP `apply_plan_links`) now adds their kept relations as well (`409 NO_CHANGE` when nothing is new).
- **Edits:** `{kind: 'flow-relation', from: {service, ingress}, to: {service, ingress}, type, note?, id?}` (`id` changes an existing relation); `{kind: 'delete', anchor: 'rel:<id>'}`. New codes `BAD_TYPE`, `NO_FLOW`, `SAME_FLOW`. A symmetric type (`contradicts`, `same-topic`) is stored once whichever flow is `from`. Deleting a component or endpoint deletes the relations that name it, in the same request.
- **REST:** `GET /api/envs/:env/flow-relations?service=&ingress=&type=&draft=`: `[{id, type, from, to, note?, other, direction, phrase}]`, with `phrase` written for the asking flow ("supersedes" / "is superseded by"). Design environments only (a sealed one answers `[]`).
- **MCP:** `list_flow_relations {env, draft?, service?, ingress?, type?}` (read); writes through `edit_design`. `edit_design`'s description changed (the tool list hash moved).
- **Marks:** `rel:<id>` New / Changed / Removed, counted in `counts.relations`. A Full copy of a design carries its relations.
- UI: "Related flows (n)" under the flow's description, + relation / Edit / Remove in Edit with a draft, a relation filter and a badge in the Flows list (`rel=any|<type>` in the URL). The static preview shows them.

## 0.28.1 (2026-10-21)
UI only, nothing for harvesters or importers: the subsystem level in the web UI. The 0.28.0 routes and edits are unchanged.
- **System map:** a Subsystems | Components level control (`level=subsystems` in the URL; hidden in an environment without subsystems), subsystem boxes with the rolled-up calls and the abstract links, regions round the components at component level.
- **Abstract links:** "+ link", a panel with Refine (From, Via, To), the suggestions with "Use <name>" and "Make it a call…" (the call builder). A refined link folds into its line ("includes: <name>").
- **Marks:** a subsystem's `what` now names each kind (`1 new component, 1 changed component`; a single kind reads as before).
- **Flows:** subsystem bands over the heads ("Group by subsystem", on by default) and a per-flow colour de-clash. **Settings:** `#/envs/<name>/settings` (name, icon, order, level names).

## 0.28.0 (2026-10-21)
The subsystem level (backend; the UI follows in 0.28.1). Details in [API.md](API.md) "Subsystems". Migration 012 is additive (the database is backed up to `<db>.pre-012.bak` first).
- **Breaking, plans and edits:** a component belongs to **exactly one subsystem** (maintainer decision; `alsoIn` / #51 will not be built).
  - **`422 TWO_GROUPS`**: a plan (manifest + extension), an ops request, an edit batch or `apply_import_plan` that gives one component two different subsystems is refused, nothing is written. The message names the component and both paths.
  - **`details.alsoIn` (and a top-level `alsoIn`) on a manifest header or extension is refused** with the same code ("a component belongs to one subsystem: pick one"). Remove it from your plans.
  - Changing a component's `groupPath` (edit form, ops, extension) **moves** it: the old value is replaced. A move shows on both `grp:` boxes and in the draft's changes ("subsystem: Network → Platform").
- **Breaking, small:** in the plan result `skipped.links` now counts only the links **not applied** (it counted every link before; links used to be kept and never applied). New `links: {abstract, flow, skipped}`.
  Suites that deepEqual `GET /marks` `counts` see three new keys (`subsystems`, `links`, `relations`), and marks gain `grp:` anchors (see below).
- **Plan import** now applies `links[]`: an abstract link (ends `grp:` / `svc:` / `ing:`, `egr:` as `from`, no `type`) becomes `link:<id ?? slug(name)>`; a bad link is a warning and is skipped, the rest imports; a typed flow link is skipped
  with "flow relations land in 0.28.2". `environment.groups` the design lacks become subsystems (with `icon`); a different label for a known key is a warning. **Refine, do not delete:** when a link's ends become endpoints, set its `refinedBy`
  (the `refine-link` edit) instead of deleting it; it stays and folds into its roll-up line.
- **A draft imported before 0.28** kept its links without applying them: `POST /api/envs/:env/drafts/:slug/plan/links` (MCP `apply_plan_links`, `{from?}`) re-reads them (`409 NO_CHANGE` when there is nothing new).
- **Anchors** `grp:<path>` (a subsystem's settings), `link:<id>` (abstract link), `rel:<id>` (flow relation, 0.28.2). `GET /marks` carries `grp:` and `link:` marks and `counts.subsystems` / `counts.links` / `counts.relations` (additive).
  A subsystem is New when every component in it is New, Changed when a member changed or moved or a link into it is marked; reordering never marks.
- **REST** (all take `?draft=`): `GET /api/envs/:env/subsystems`, `.../views/subsystems` (boxes, calls rolled up by subsystem, transport and mode, each counted once), `.../abstract-links[?subsystem=]`, `.../abstract-links/:id` (with `suggestions`).
  `PUT /api/envs/:env/subsystems` (sealed only; a design is `409 USE_DRAFT`) and `PUT /api/envs/:env/levels` (any environment) are annotations. `GET /api/envs/meta` groups carry `icon` (`platform agent network cloud shield database`); `POST /api/envs` `groups` accept it.
- **Edits** (`edit_design`, `POST .../edits`): `{kind: 'subsystem', key, label?, icon?, order?}`, `{kind: 'abstract-link', ...}`, `{kind: 'refine-link', id, from?, to?, use?, call?}`; `delete` accepts `grp:`, `link:`, `rel:`.
  New error codes: `BAD_KEY`, `BAD_ICON`, `GROUP_IN_USE`, `TWO_GROUPS`, `NO_END`, `BAD_END`, `SAME_END`, `NOT_INSIDE`, `REFINE_DANGLING`. `NO_GROUP` now reads the subsystems of the request's result (one added in the same request counts).
- **MCP:** `get_subsystems`, `get_subsystem_map`, `list_abstract_links`, `suggest_refinements`, `apply_plan_links`, `set_subsystem_settings` (sealed: at once; a design needs `draft`), `set_levels`. `edit_design` and `apply_import_plan` descriptions changed.
- A Full copy of a design copies its links and baseline groups; Blank and Components copies do not. Harvester ingest into a design is still `409 ENV_DESIGN`. Traces are unchanged (golden hashes identical).

## 0.27.5 (2026-10-21)
- UI: the Comments section sits under the diagram, at the bottom of the flow page (maintainer request). The diagram keeps at least 260 px; the comment pane scrolls.

## 0.27.4 (2026-10-21)
- Mermaid export and import of flows (details in [API.md](API.md) "Mermaid"). Additive; no migration.
  - Export, any environment (sealed and the static preview too): `GET /api/envs/:env/flows/mermaid?service=&ingress=&draft=` answers `text/plain`; MCP `export_mermaid {env, service, ingress, draft?}` -> `{text}`. The full trace as `sequenceDiagram`: `participant <id> as <name>` per lifeline (channels and data stores labelled by their key, the entry client an `actor`), `->>` with its `-->>` return, `-)` async, `Note over` the step description, `title` the flow name, a `%% Description:` comment.
  - Import, design environments only, always into an open draft (sealed: `409 ENV_SEALED`): `POST /api/envs/:env/drafts/:slug/mermaid/preview {text, matches?, groupPath?}` (writes nothing), `POST .../mermaid {text, matches?, groupPath?, author?}` (201), MCP `import_mermaid {env, draft, text, matches?, groupPath?, dryRun?}`.
  - Dry-run / preview shape: `{title, description, summary, participants: [{id, label, actor, match, how, candidates, source?, note?, choice, createName}], matches, components, source, creates, imports, counts {components, endpoints, calls, notes, reused}, undecided, flow {service, ingress, name?}, edits: [DesignEdit], ops, warnings: [{line?, text}]}`. An agent sends the `matches` back, corrected: participant id -> a component name, `{create: true, name?}`, `{fromSource: true}`, `{client: true}` or `{skip: true}`.
  - Matching, in order: id or `as` label equals a component name (`how` `exact` / `alias`); normalized equal (case, `-` `_` space, a trailing `-svc` / `service`); a close spelling (2 edits or fewer, only when exactly one component is that close, 4 letters or more); a name only the source environment has (`in-prod`). A name found only in the source is **never imported by itself**: the default is `create`, copying it (one level, the 2a-1 import rules, same batch) is the choice `{fromSource: true}`. A label that is a key (`sns:q`, `users-db.users`) is `infra`: skipped by default. An unmatched actor is the entry client.
  - What it makes: `component` edits for created participants; `METHOD /path` messages become `http:METHOD <callee>/<path>` endpoints, other messages `undecided` endpoints (`tbd:<callee>/<label>`, the label as the operation); `-)` messages are `mode: 'async'` calls; notes, the part after `: ` of a label and the innermost block (`[alt: cond]`) become the step's `note`; `title` is the flow name, `%% Description:` its description. New: `note` on the `call` form of `edit_design` / `POST .../edits` (the step's own text).
  - Limits and errors: a line over 2000 characters is skipped with a warning (the parser is linear); a `matches` value naming a component that is not in the design is `422 UNKNOWN_COMPONENT` (use `{create: true, name}`); on MCP, a `dryRun` that is not a boolean is a JSON-RPC `-32602` invalid-params error for every tool that takes `dryRun` (a string like `"false"` is no longer read as a real run). `%%` in exported text is written `%#37;`.
  - Re-import is idempotent: a component, endpoint (same bind key) or call (same function, bind key and occurrence) that exists is reused (`counts.reused`); nothing new answers `batch: null`.
  - Undo: each import is one batch, its ops carry `origin {kind: 'mermaid', batch}` (ops copied through `fromSource` carry `{env, version, batch}`). `DELETE /api/envs/:env/drafts/:slug/mermaid/:batch` removes them; `409 DEPENDENT_OPS` with `error.details.blocking: [{seq, op, anchor, author}]` when a later op touches what the batch made. `404` for an unknown batch.
  - UI: Export menu on a flow's header (Copy Mermaid, Download .mmd), "Edit" menu in the draft bar with "Import Mermaid…" (also on the flow header while Edit is on), a three-step dialog (paste, match, preview), and "Undo import" under the draft bar. The static preview exports; its import is refused.

## 0.27.3 (2026-10-21)
- UI: flow diagrams show the product icon of what each lifeline is: data stores and store bands (MongoDB, Redis, Postgres, DynamoDB, S3, MySQL, Elasticsearch), topics and queues (SNS, SQS, EventBridge, RabbitMQ), lambdas and gateways. Unknown kinds keep the line glyph. No API change.

## 0.27.1 (2026-10-21)
- UI: in a flow diagram each data-store collection is its own lifeline (a band names the store; more than 5 collections of one store fold into one lifeline), and every store arrow shows the operation as harvested. Reads and writes differ by line weight. Additive on the trace: a resource message also carries `storeKind` and `access` (`read` / `write` / `read_write` / `unknown`); trace hashes are unchanged (#62). Also UI: a flow with no comments starts its Comments section collapsed to one line.

## 0.27.0 (2026-10-21)
- Comments under each flow (details in [API.md](API.md) "Comments under a flow"). Additive; nothing breaks.
  - REST, any environment (sealed too, no draft needed): `GET /api/envs/:env/comments?anchor=flow:<service>/<ingress>`,
    `GET /api/envs/:env/comments/counts`, `POST` (`{anchor, step?, parentId?, author, body}`), `PATCH /:id`, `DELETE /:id?author=`.
    The anchor is `flow:<service>/<ingress>`; `?draft=` lets a flow that exists only in an open draft be discussed.
  - MCP: `list_comments {env, service, ingress, draft?, since?}` (plain `text` and sanitized `html`, replies nested; `since` is for polling)
    and `add_comment {env, service, ingress, author, body, step?, parentId?, draft?}`.
  - What an agent must know: the body is HTML limited to an allowlist (`p br b strong i em s del strike u ul ol li a table thead tbody tr th td span code pre blockquote`;
    links `http(s)` only; colours are `cc-*` classes). Everything else is stripped, text is escaped, 20 000 characters at most (`422`).
    For `add_comment` you can send plain text with Markdown-lite (`**bold**`, `~~strike~~`, `- ` lists) instead of HTML.
    A comment is by `author` (at most 80 characters); only that author can edit or delete it (naive identity, `403` otherwise).
    Replies are one level deep. A `step` is a step key (`#step:...`) of the flow's trace, else `400`.
  - A Full copy of an environment copies its comments; Blank and Components copies do not.
  - Push events `comment.created`, `comment.edited`, `comment.deleted` (`env`, `data {anchor, id, author, text}`).
  - Migration 011 (`comments` table, additive; the database is backed up to `<db>.pre-011.bak` first).

## 0.26.2 (2026-10-21)
- UI: the app icon is now option D, two lifelines.

## 0.26.1 (2026-10-21)
- UI: new app icon (favicon, touch icon, rail logo).

## 0.26.0 (2026-10-21)
- UI only (2a-2):
  - references (lock), partial-flow line, Import panel
  - edit forms, "+ call", "+ component"
  - editable flow names, component colours
  - Flows list: Subsystem/Component filters, change marks, "Changed only"; collapsible list
  - Inventory subsystem filter
- Data your plans already carry now shows in the UI: links (#54), `details.runtime` (Kubernetes icon, #49), the
  empty-flow hint (#59), and flow text in draft review (#57).

## 0.25.3 (2026-10-21)
- **#58:** `POST /api/envs` (MCP `create_env`) takes `behaviour: true` with `mode: "components"`. It copies the picked
  services' functions and steps into the env and its baseline, so they show no marks and their flows trace like the
  source. The default is false (endpoints stay references to the source).
- **#59:** a trace of an endpoint with no handler function that did not come from a source env returns an empty
  flow, `noHandler: true`, instead of 404. A reference to a source env keeps `409 NO_HANDLER`.
- **#56:** a discarded draft's slug can be reused. The old record is renamed `<slug>~<id>`.
- **#55:** ingress `entryPoint: true|false` (manifest, plan, design edits). `false` is never an entry point; `true`
  always is. When absent, the old rule applies. Set `entryPoint: false` on hop ingresses (tunnel, BGP, BFD) and keep
  their real transport.
- **#54:** `links: {main?: {label, url}, sub?: [{label, url}]}` (http(s) only, label 1–120 characters, ≤ 20 sub) on
  the service header, function and ingress (manifest, plan, edits), and on flows (`PUT /flow-names`, plan
  `flows[].links`). It is returned in the service view, in entry points (`links`, `flowLinks`), in trace
  `start.links` and in `/flow-names`. Flows with links but no name are listed with `name: null`.
- **#49:** `details.runtime` must be one of `k8s-pod | k8s-deployment | k8s-daemonset | k8s-operator | k8s-job`
  (component edit `runtime`).
- The edit form semantics: `links` absent keeps the stored value, `null` removes it, an object replaces it. There is
  a new `function` edit kind.
- Migration 009 (`flow_links`).

## 0.25.2 (2026-10-21)
- **#47:** assumed values (basis + reason) in the contract. See HARVESTER-GUIDE.md. Migration 010.

## 0.25.0 (2026-10-21)
- References and partial flows: marks carry `refs`, a trace message carries `reference`, entry points carry
  `partial`.
- One-level import into a draft: `GET …/drafts/:slug/import/preview?source=&anchor=`, `POST …/import`; MCP
  `import_preview`, `import_into_draft`.
- Design edits: `POST /api/envs/:env/drafts/:slug/edits {edit}` and MCP `edit_design`. The edit kinds are component,
  endpoint, call, flow and DTO.
- **Breaking:** the manual CRUD routes and the MCP tools `upsert_entity` / `delete_entity` are removed. In a design
  env, write through drafts. A sealed env takes harvester ingest only.
- **#52:** flow names show in plain reads too (entry points, `flows/counts`, search, trace `start.name`, MCP).
- **#53:** up to 5000 ops per plan, edits or ops request (was 500), applied in one transaction.
- Component colours: `GET /api/envs/meta` returns `colors` ({component: slot 1..8}).
- Migration 008.

## Coming next
- 0.28.1: the subsystem level in the UI (map level switch, link panel, flow bands, settings page).
