# Flow-Mapper

## What it is
Service-to-service mapping visualizer. UI for humans, MCP server for agents.
Has its own DB/schema with full CRUD. Harvesting of service data is done
separately on each system; harvesters push data into Flow-Mapper.

## Key decisions
- Harvested data is treated as the source of truth (no second-guessing it).
- Harvesters supply the bind keys used to link services.
- Must support versioning and delta ingest (not just full replace).
- DB: SQLite now, designed so we can move to Postgres later.
- Language: TypeScript (UI, server and MCP in one language).
