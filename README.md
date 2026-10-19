# Flow-Mapper

Maps how services talk to each other — REST, gateways, SNS, SQS, RabbitMQ, databases —
and how calls flow inside each service, so you can follow any request from its entry
point to the end of its route.

- **Web UI** for humans: system view, service view, sequence view, link health, bugs
- **MCP server** for agents: search, trace flows, CRUD, link health, bugs
- **Ingest API** for per-service harvesters: full and delta manifests, versioned

Status: design phase. See [docs/DESIGN.md](docs/DESIGN.md).

## Repository layout

| Path | What |
|---|---|
| `docs/DESIGN.md` | Data model, bind keys and wildcards, versions/deltas, environments, link health, bugs, views, API/MCP, stack, phases |
| `schema/manifest.schema.json` | JSON Schema for harvester manifests (`kind: full` and `kind: delta`) |
| `samples/` | Example manifests for a small e-commerce system, plus a delta in `samples/deltas/` |
| `scripts/check-samples.mjs` | Prototype resolver: validates samples and prints links and link-health stats |

```sh
npm install
npm run check:samples
```
