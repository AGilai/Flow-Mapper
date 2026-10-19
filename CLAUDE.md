# Flow-Mapper — notes for agents

Service-to-service flow mapping: harvesters push manifests, the server resolves bind keys into a
graph, humans use the web UI, agents use MCP.

- Start with `docs/ARCHITECTURE.md` (where things are), then `docs/DESIGN.md` (why) and `docs/API.md` (contract).
- No dependencies. Node ≥ 22.18 runs `.ts` directly. Do not add packages without asking.
- `npm test` must pass. `npm run seed` loads samples; `npm run seed:mock` loads 100 mock services.
- `npm run dev` serves UI + API + MCP on :3000. `npm run preview` builds a static UI into `dist/preview`.
- core/ is pure and shared with the browser: no `node:` imports, `import type` for types.
- Keep files small (~250 lines) and single-purpose; read only the file you need.
- The manifest schema is `schema/manifest.schema.json`; change it and the samples together.
