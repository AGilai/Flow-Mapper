# Flow-Mapper — notes for agents

Service-to-service flow mapping: harvesters push manifests, the server resolves bind keys into a
graph, humans use the web UI, agents use MCP.

## Key decisions
- Harvested data is treated as the source of truth (no second-guessing it).
- Harvesters supply the bind keys used to link services.
- Must support versioning and delta ingest (not just full replace).
- DB: SQLite now, designed so we can move to Postgres later.
- Language: TypeScript (UI, server and MCP in one language).

## Working here
- Start with `docs/ARCHITECTURE.md` (where things are), then `docs/DESIGN.md` (why) and `docs/API.md` (contract).
- No dependencies. Node ≥ 22.18 runs `.ts` directly. Do not add packages without asking.
- Schema changes add a new `server/db/migrations/NNN_name.sql`; applied migrations (`001_init.sql` included) are frozen, and an edited one is refused. Databases upgrade in place at startup and are backed up first to `<db>.pre-NNN.bak`. A migration that rebuilds a table starts with `-- migrate: foreign_keys=off`. Test an upgrade on a copy of the live DB, never on `data/`.
- `npm test` must pass. `npm run seed` loads samples; `npm run seed:mock` loads 100 mock services.
- One suite: `node --disable-warning=ExperimentalWarning --test tests/core.test.ts`; add
  `--test-name-pattern='<regex>'` for one test. API tests use `startApp()` in `tests/helpers.ts`
  (random port, temp DB), so they never touch `data/`.
- CI runs `npm test` and `npm run preview`, so the static preview build has to keep working too.
- Scratch server without touching `data/`: set `FLOW_DB` / `FLOW_DATA_DIR` and `PORT` (see `server/config.ts`).
- Commits fixing a harvester bug are titled `Fix #<bug id>: …`; user-visible fixes bump `version` in `package.json`.
- `npm run dev` serves UI + API + MCP on :3000. `npm run preview` builds a static UI into `dist/preview`.
- core/ is pure and shared with the browser: no `node:` imports, `import type` for types.
- Keep files small (~250 lines) and single-purpose; read only the file you need.
- The manifest schema is `schema/manifest.schema.json`; change it and the samples together.

## Operating the shared instance
- `data/` on the shared server is production data: harvesters' bugs live in its database. Never
  `npm run db:install -- --force` there without a backup; refresh samples with
  `node --disable-warning=ExperimentalWarning scripts/seed.ts` (no `--bugs`).
- Restart the server by stopping the process whose command line is exactly
  `node --disable-warning=ExperimentalWarning server/main.ts` (`pgrep -f -x`; a loose pattern
  matches your own shell), then `setsid nohup data/serve.sh &`. Its output goes to `data/server.log`.
- Bugs from harvesters are handled by `docs/BUG-LOOP.md`. CI (`.github/workflows/test.yml`) runs
  the tests on every push.

## How work is split
- Non-trivial features: the lead session writes a self-contained brief; an implementer agent works
  in its own git worktree; a separate QA agent runs the tests, reviews the diff and checks the UI
  with the headless browser in `/home/ubuntu/tools/qa-browser` before merge. Small fixes stay inline.
- UI work: design before code. Follow `docs/UI-GUIDE.md` and the frontend-design skill
  (`~/.claude/plugins/cache/claude-plugins-official/frontend-design/*/skills/frontend-design/SKILL.md`).
  New or reworked pages start as a static mockup in `design/mockups/` that the maintainer approves;
  the implementer builds to it and a designer agent compares screenshots with the mockup before merge.
  `design/AUDIT.md` lists the known readability problems per page.
- Every fix and feature ships with a demo: a case in `samples/` (env `prod`) and a row with its link in
  `docs/DEMOS.md`. After deploying, re-seed the samples and give the maintainer the link.
