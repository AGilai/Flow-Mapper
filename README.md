# Flow-Mapper

Maps how services talk to each other — REST, gateways, SNS, SQS, RabbitMQ, databases — and how
calls flow inside each service, so you can follow any request from its entry point to the end
of its route.

- **Web UI** for people: system map, services, service view, flows (sequence diagrams), link health, bugs
- **MCP server** for agents: search, trace flows, find paths, link health, CRUD, bugs
- **Ingest API** for per-service harvesters: versioned full and delta manifests

## Run it

Needs Node 22.18 or newer. There are no dependencies to install.

```sh
npm run db:install  # create the database (data/flow-mapper.db); --force rebuilds it, deleting data
npm run seed        # load the sample system (env "prod"), endpoint DTOs and example bugs
npm run seed:mock   # optional: 100 generated services (env "scale-test")
npm run dev         # UI, API and MCP on http://localhost:3000
npm test
```

Static preview of the UI with bundled data (no server): `npm run preview`, then serve `dist/preview/`.

## Connect an agent

- HTTP: point an MCP client at `http://localhost:3000/mcp`
- stdio: `npm run mcp`

## Repository

| Path | What |
|---|---|
| `docs/HARVESTER-GUIDE.md` | **Start here if you write a harvester:** what to extract, bind keys, events, DTOs, how to push and check |
| `docs/DESIGN.md` | Model, bind keys and wildcards, versions/deltas, environments, link health, bugs, views |
| `docs/API.md` | REST, ingest error codes, bug workflow, MCP tools |
| `docs/ARCHITECTURE.md` | Code map, request path, conventions |
| `schema/manifest.schema.json` | Harvester manifest (full and delta) |
| `samples/` | Example manifests with planted problems, plus a delta |
| `core/` `server/` `web/` | Shared graph logic, server, UI |
