# Changelog for harvesters and importers

This file lists, per version, only what a harvester, importer or MCP agent needs to know: API and plan changes, new
fields, MCP tools, and anything breaking. Read it after every `git pull`. UI-only changes get one line. Details are
in [API.md](API.md), [DESIGN-IMPORT.md](DESIGN-IMPORT.md) and [HARVESTER-GUIDE.md](HARVESTER-GUIDE.md); demos are in
[DEMOS.md](DEMOS.md). **Breaking** marks a change that needs an update on your side.

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
- 0.27.0: comments under each flow. REST `…/comments` and MCP `list_comments` / `add_comment`.
- 0.27.1: DB collections as their own lifelines (#62).
- 0.27.2: Mermaid export/import of flows. MCP `export_mermaid`, `import_mermaid` (dry run with proposed matches).
- 0.28.x: the subsystem level.
  - **Breaking for plans:** a component in two subsystems, or one carrying `details.alsoIn`, is refused with
    `422 TWO_GROUPS`, because a component has exactly one subsystem (#51 won't be built).
  - Also: abstract subsystem links (`grp:` / `link:` anchors) and flow-to-flow relations (#50).
