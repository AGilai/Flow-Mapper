# Planned phase: data versions and a replayable log of human changes (#129)

Status: planned, not scheduled. Owner decision (Asaf, 2026-11-17): "make it as a phase".

## Why
Production data is reloaded as the harvesters improve; each load replaces it. Human work on top of
that data (names, descriptions, notes, comments, action items, drafts) must survive a reload, and an
instance (local :3200, the AWS playground) must be able to say which data it holds.

## Items
1. **Data version.** Every production load gets a version id (load time + manifest hash). The UI
   footer and `/api/version` show it, so two instances can be compared.
2. **Human-change log.** Every change made by a person (UI or API, not a harvester) is appended to
   one ordered log: who, when, env, the stable anchor it targets (`svc:` / `ing:` / `call:` /
   `flow:` / `res:` …, the grammar in docs/API.md), and the operation with its payload.
3. **Replay.** When a data version replaces another, the log is replayed onto it in order. A change
   whose anchor no longer resolves is listed in a replay report (not dropped silently) and can be
   re-targeted or discarded by a person.

## Building blocks already there
- `changelog` per env, draft ops keyed by anchors, `flow_notes` with versions, comments and action
  items keyed by env + anchor.
- Env export/import (0.59.0, `server/env-transfer/`) already enumerates every env table.

## Open questions (for when it is scheduled)
- One log table vs. deriving the log from the existing per-table history.
- Anchor stability across harvester renames (a rename map from the harvester?).
- Replay conflicts: a human edit on an item the new data also changed.
