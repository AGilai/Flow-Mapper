# `about`: rich description per component and subsystem (#68, decided part, 0.30.2): build spec

From bug #68 (corev5-importer), triaged by the QA TL. The dedicated info pane is a separate, undecided UI (mockup for the
maintainer first) and is out of scope; until it ships, `about` renders in the existing component and subsystem panels.

## Data (no migration expected)
- Component: optional `about` (markdown, ≤ 20 000 characters) on the service header, next to `description`.
  `schema/manifest.schema.json` and the samples change together. Diffs like any header field (Changed mark).
- Subsystem: optional `about` on a group `{key, label, icon?, about?}` in `envs.groups` (JSON), and on plan
  `environment.groups[]` / `groups[]` entries.
- Sections by convention only (no schema): `## Capabilities`, `## Motivation`, `## Roles and responsibilities`,
  `## Owners`, `## Open questions`. Status, doc links (#54) and related flows already exist and are not duplicated.

## Write paths
- Manifest ingest (harvested and design), import plan (`manifests[].service.about`, extensions upsert of the header,
  `environment.groups[].about`), design edits (the component edit form kind and the subsystem edit kind take `about`),
  `PUT` of env settings for groups, and MCP (`edit_design` kinds, `create_env` groups). Reads return it everywhere the
  header / groups are returned (service, inventory, envs meta, draft reads).

## Rendering
- A pure `core/markdown-lite.ts` (or reuse the comments' Markdown-lite converter if it can be shared): headings
  (`##`, `###`), paragraphs, `**b**`, `*i*`, `~~s~~`, `` `code` ``, `- ` and `1. ` lists, links `[t](https://…)`,
  then sanitized by `core/rich-text.ts`. No raw HTML passthrough.
- UI: the component panel (service page / map side panel) and the subsystem panel show an "About" block with the
  rendered text, folded after ~12 lines with "Show all". Editable through the existing edit forms in a design draft
  (textarea + preview toggle).

## Tests and demo
Schema validation; ingest/plan/edit/MCP round trips; diff marks a changed `about`; sanitizer on hostile markdown
(javascript: links, HTML); sample `about` on one prod component and on sase-hld's "network" subsystem. CHANGELOG
(harvester- and importer-facing: new fields), DEMOS rows, API.md / HARVESTER-GUIDE.md / DESIGN-IMPORT.md, version 0.30.2.
