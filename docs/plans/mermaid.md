# Mermaid import and export for flows (0.27.2): build spec

Maintainer request (2026-10-21): "import and export to mermaid - allow to both on flows - for import try to match
existing components or ask user to match or warn that it will create unknown components". The layout is decided by
the lead. Frame 14 (import dialog) is drawn by the designer and built without waiting for approval, at the
maintainer's request for night work; they override with a bug.

## Export (every env, prod included)
- Pure `core/mermaid-export.ts`: trace → `sequenceDiagram` text.
  - Participants: in lifeline order, `participant <id> as <label>`. The id is sanitized; the label is the component
    name, or a store/collection, or a client-app. Folded lifelines are not exported; the full trace is.
  - Sync call: `A->>B: <label>`. Its return: `B-->>A: <return label or "return">`.
  - Async (queue/topic/event): `A-)B: <label>`, with the channel as a participant labelled by its bindKey.
  - The step description (human, else AI) becomes `Note over A,B: <text>`, single line, escaped.
  - The flow name and description go into a `%%` header comment, plus `title <flow name>`.
  - Undecided transport is labelled as is.
- UI: an "Export" menu on the flow header with "Copy Mermaid" and "Download .mmd". The toast confirms.
- REST: `GET /api/envs/:env/flows/mermaid?service=&ingress=&draft=` returns `text/plain`.
- MCP: `export_mermaid`.
- Tests: golden exports for 3 sample flows (sync, async, with stores). Round-trip parse(export(x)) keeps the
  participants and arrows.

## Import (design envs only, always into a draft)
- Pure `core/mermaid-parse.ts`, a tolerant parser for `sequenceDiagram`:
  - `participant`/`actor` with `as` aliases
  - arrows `->> -->> -) --) -x --x -> -->`
  - `activate`/`deactivate`, and `+`/`-` on arrows
  - `Note`, `alt/else/opt/loop/par/critical/break ... end` blocks, `autonumber`, `title`, `%%` comments
  - Unknown lines become warnings with a line number, never a throw.
  - Output is `{participants, messages[{from, to, label, kind: sync|return|async, block?}], notes, warnings}`.
- Pure `core/mermaid-match.ts` matches each participant against the env's components (and the source env's, for
  "exists in prod: import it" hints). Match order:
  1. exact name
  2. alias/label equal to the name
  3. normalized equal (case, `-`/`_`/space, `-svc`/`service` suffix)
  4. close spelling (Levenshtein ≤ 2, only if unique)
  5. name exists in the source env
  Output per participant is `{participant, match: name|null, how, candidates[]}`.
- Mapping to DesignEdits (2a-1 kinds):
  - An unmatched participant chosen as "create" becomes a component edit. The subsystem is asked once for all new
    ones (optional).
  - A sync message to a component becomes a call edit.
    - A label `METHOD /path` gives an http endpoint `http:METHOD <callee>/<path>`.
    - Otherwise the endpoint is `undecided` with the label as the operation name.
  - The caller function is the handler of the incoming call that lifeline was activated by, else a new function
    `<label>` on the entry endpoint.
  - The first message from an actor/client becomes the entry point (client-app if the actor isn't a component).
  - Async messages map to calls with transport `undecided` and an async flag (if the DesignEdit has none, a note in
    `details`).
  - Return messages map to the response label only.
  - Notes become step descriptions.
  - Blocks become a step-description prefix (`[alt: condition]`).
  - The flow name comes from `title`.
  - Only new things are written: calls and endpoints that already exist are reused, not duplicated.
- Server:
  - `POST /api/envs/:env/drafts/:slug/mermaid/preview {text, matches?}` returns
    `{parsed summary, matches, edits[], creates: [names], warnings}`.
  - `POST …/mermaid {text, matches}` appends the edits as ops in one transaction and returns the draft changes.
  - Sealed envs refuse with 409 ENV_SEALED.
- MCP: `import_mermaid {env, draft, text, matches?, dryRun}`. A dry run returns the proposed matches so an agent can
  pass its own back.
- UI (frame 14):
  - "Import Mermaid" in the draft's Edit menu on the Flows page, and on the flow header when Edit is on. It opens a
    dialog:
    1. Paste box or .mmd file.
    2. Matching table: participant, then a component select pre-filled with the match and a "how" chip (exact /
       alias / similar / in prod), or "＋ create new". Unmatched rows default to "create new" with a warning. Above the
       table, a warning bar reads "3 components will be created: x, y, z".
    3. Preview: counts of components, endpoints, calls and steps, plus the warnings list.
    4. "Import into draft <slug>".
  - After import, the Flows page opens the imported flow.
- Tests:
  - parser corpus: every arrow kind, aliases, blocks, notes, malformed lines
  - matcher cases
  - mapping to edits
  - API preview/import, the sealed guard, and idempotency (re-import adds nothing new)
  - export → import round-trip into a blank design gives the same participants and calls

## Constraints
No dependencies. Files ≤ 250 lines. core/ pure. No migration expected. Preview: export works in the static preview;
import is refused there like apply. DEMOS rows with a sample `.mmd` in `samples/mermaid/agent-tunnel.mmd`, imported
into sase-hld. Version 0.27.2.

## Lead decisions after frame 14 (2026-10-21)
- **Undo import is in scope.** Each Mermaid import is one batch: its ops carry `origin {kind: 'mermaid', batch: <id>}`.
  `DELETE …/drafts/:slug/mermaid/:batch` removes that batch's ops if no later op depends on them; otherwise it
  answers 409 and lists the blocking ops. The info line after an import shows "Undo import".
- **Rename draft is out of scope**, so the Edit menu holds only "Import Mermaid…".
- **"in prod" never imports by itself.** The default is "＋ create new", and "Import from prod (one level)" is an
  explicit choice in the select. The import then goes through the 2a-1 one-level import into the same draft.
- **Step descriptions** come from Mermaid notes, and from message labels longer than the operation text (the part
  after `: ` when it isn't a method/path).
