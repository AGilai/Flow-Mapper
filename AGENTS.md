# AGENTS.md: designing with Flow-Mapper

You are an AI agent that designs a system (HLD, then LLD) in Flow-Mapper through its MCP tools. This file is the
single entry point. A person reviews your design in the web UI; you never need the UI.

## 1. Connect

**Hosted.** A person signs in, opens **Tokens** in the user menu and creates a personal access token (`fm_...`; the
page shows it once). The same page prints this MCP config; paste it into your client (Claude Code: `.mcp.json`):

```json
{ "mcpServers": { "flow-mapper": { "type": "http", "url": "https://<host>/mcp", "headers": { "Authorization": "Bearer fm_<token>" } } } }
```

The tools then act as the token's owner: you see and change what they may. Call `whoami` first to confirm it.

**Local.** Needs Node >= 22.18, no install:

```sh
git clone git@github.com:AGilai/Flow-Mapper.git && cd Flow-Mapper
mkdir -p /tmp/fm && FLOW_DB=/tmp/fm/flow.db FLOW_DATA_DIR=/tmp/fm PORT=3000 npm run dev   # FLOW_AUTH=off by default
```

Same config with `"url": "http://localhost:3000/mcp"` and no `headers`. `whoami` answers `{auth: "off"}`. A stdio server
is `npm run mcp` (it opens the database file `FLOW_DB` directly). One JSON-RPC message per POST; there is no SSE.

## 2. The design loop

Tools in order. `*` = required argument; **every tool that takes `env` requires it**.

1. `create_env {name*, mode*: "blank", groups: [{key, label, about}]}` makes a private design environment with its
   subsystems. (`mode: "components"` / `"full"` copy parts of `source` instead; see [MCP-TOOLS.md](docs/MCP-TOOLS.md).)
2. `open_draft {env*, name, slug}` opens a draft. All edits go into a draft; nothing touches the env until step 6.
3. Put the design into the draft, one of:
   - **From scratch:** `edit_in_draft {env*, draft*, ops*}` with whole-item ops `{op: "upsert"|"delete", anchor, service?, data?}`
     (anchors `svc:`, `ing:`, `egr:`, `res:`, `fn:`, `dto:`, `evt:`...; shapes in [DESIGN-FROM-SCRATCH.md](docs/DESIGN-FROM-SCRATCH.md)).
   - **From documents:** `apply_import_plan {env*, draft*, plan*}` (HLD documents, see [DESIGN-IMPORT.md](docs/DESIGN-IMPORT.md)) or
     `import_mermaid {env*, draft*, text*, dryRun}` (a `sequenceDiagram`).
4. `draft_changes {env*, draft*}` lists what the draft adds, changes and removes. Read the draft back with the `draft`
   argument of any read tool (`trace_flow`, `link_health`, `get_marks`, `list_open_questions`...).
5. `export_mermaid {env*, service*, ingress*, draft}` renders one flow as a sequence diagram: a cheap review for you and
   for the person.
6. `apply_draft {env*, draft*, dryRun}` writes the draft to the env (run with `dryRun: true` first, it rolls back).
7. Share: `share_env {env*, members: [{user, role: "viewer"|"editor"}], published}` (owner or admin; designs start
   private). `list_users` finds people; `whoami` says who you act as.

Design in passes: subsystems and components first, then channels and flows, then the LLD. Record what you do not know
with `set_notes` / `add_comment` / `add_action_item` instead of guessing. Check yourself with `link_health` (dangling
calls, orphan endpoints) and `list_open_questions`.

## 3. Rules

- **Always pass `env`.** There is no default: a missing `env` fails and lists your environments (`list_envs` too).
- **Never write to a sealed env.** Sealed (harvested) envs are read-only for design work; a write answers `403 SEALED`
  (or `409 ENV_SEALED`). Design only in `kind: "design"` envs. Never call `ingest_manifest`, `load_dtos` or `load_schemas`
  without `dryRun` unless you are a harvester.
- **Prefer dry runs:** `apply_draft`, `import_mermaid`, `ingest_manifest`, `apply_import_plan` take `dryRun: true` and write nothing.
- **Hidden things answer 404**: an env, draft or bug you may not see looks absent. Do not retry with other spellings;
  ask the owner to `share_env`. A read-only share answers `403 FORBIDDEN` on writes.
- Read-only role cannot `open_draft`; drafts are private to their author until shared.
- You are recorded as an AI author on your edits; say what you assumed (`set_notes`) so the reviewer can check it.
- Found a Flow-Mapper bug? `report_bug {title, steps, severity}`.

## 4. Where to read more

| Need | Read |
|---|---|
| A full design from nothing, with a tested example | [docs/DESIGN-FROM-SCRATCH.md](docs/DESIGN-FROM-SCRATCH.md) |
| Every tool, grouped by task (generated) | [docs/MCP-TOOLS.md](docs/MCP-TOOLS.md) |
| Turning HLD documents into an import plan | [docs/DESIGN-IMPORT.md](docs/DESIGN-IMPORT.md) |
| REST and DTO contract, drafts, marks | [docs/API.md](docs/API.md) |
| Bind keys, manifests (what harvesters send) | [docs/HARVESTER-GUIDE.md](docs/HARVESTER-GUIDE.md), `schema/manifest.schema.json` |
| What changed for agents | [docs/CHANGELOG.md](docs/CHANGELOG.md) (read after every `git pull`) |
| Accounts, tokens, hosting | [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| Why it works this way | [docs/DESIGN.md](docs/DESIGN.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
