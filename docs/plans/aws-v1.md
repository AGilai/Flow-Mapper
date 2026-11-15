# Flow-Mapper on AWS, v1: hosted HLD/LLD design assistant

Status: direction approved by the maintainer, 2026-11-15:
- SQLite on one EC2 instance with continuous S3 replication.
- The maintainer's own AWS account as the test bed; it may hold a copy of real data.
- Cognito accounts, so people work on their own designs and publish or share them when done.

Target 0.52.0 for the server parts. Infrastructure lives in `infra/` and ships with the same release.

## Decisions (lead, 2026-11-15)
| Topic | Decision | Why |
|---|---|---|
| Database | SQLite on EBS gp3, streamed to S3 with Litestream; nightly EBS snapshot | The DB is small (3.4 MB live). The graph is resolved in memory. The store layer is synchronous (`node:sqlite`, about 274 prepared statements), so Postgres means an async rewrite. Neptune buys nothing. |
| Later | RDS Postgres / Aurora Serverless v2 when we need more than one app server or zero-downtime failover | That needs an async store layer, a shared cache invalidation and event fan-out (LISTEN/NOTIFY) |
| Compute | One EC2 instance, t4g.small (ARM, 2 GB), Ubuntu 24.04, Node 22, systemd unit | Always on, as any web server is; there is no container runtime to manage |
| HTTPS without owning a domain | CloudFront in front of the instance (default `*.cloudfront.net` certificate). The origin is the instance on port 80, reachable only from CloudFront's managed prefix list. | Cognito needs HTTPS callback URLs. A custom domain plus ACM certificate is an option in the template. |
| Infrastructure as code | One CloudFormation template (`infra/flow-mapper.yaml`) and a deploy script that uses the AWS CLI | No new packages (the repo rule); readable; deploys with `aws cloudformation deploy` |
| Auth | Done in the app, not at the edge. The browser does an OIDC authorization code + PKCE flow against the Cognito hosted UI and gets an httpOnly session cookie. Agents (MCP, REST) use personal access tokens that a user creates in the UI. JWT checks use `node:crypto` with the Cognito JWKS. | Works behind CloudFront. One identity covers people and their agents. Changes stay in `server/identity.ts` plus a small auth module. |
| Sign-up | Admin-created users, plus optional self sign-up limited to allowed email domains (stack parameter) | A team tool, not a public one |
| Local / dev | `FLOW_AUTH=off` (the default) keeps today's behaviour, so tests, the preview and local agents are unchanged | Nothing breaks for current users |

## 1. Packaging and operations (no UI)
- `GET /healthz` returns `{ok, version}` with no database write. CloudFront and systemd watchdogs use it.
- `deploy/flow-mapper.service` is a systemd unit:
  - `User=flowmapper`
  - `EnvironmentFile=/etc/flow-mapper.env`
  - `FLOW_DATA_DIR=/var/lib/flow-mapper`
  - `Restart=always`
  - Litestream runs as its own unit, `deploy/litestream.yml`.
- `deploy/install.sh` (idempotent, run by EC2 user data or by hand):
  - installs Node 22 and Litestream (pinned versions);
  - creates the user;
  - clones or pulls the repo at a given tag;
  - restores the DB from S3 when the disk is empty (`litestream restore -if-replica-exists`);
  - runs `db:install` only if there is still no DB;
  - enables both units.
- `deploy/upgrade.sh <tag>`: pull the tag, then restart. Migrations run at startup and take their own backup.
- `docs/OPERATIONS.md` covers:
  - settings (all environment variables in `server/config.ts`, plus the auth ones);
  - install, upgrade and rollback;
  - backup and restore drills (Litestream to a point in time, and EBS snapshots);
  - logs (journald);
  - how to load an existing database file (copy, then `litestream replicate` takes over).

## 2. Infrastructure (`infra/`)
- Template resources:
  - VPC: default VPC, or given subnet IDs.
  - Security group: port 80 from the CloudFront prefix list only, no SSH. Access is through SSM Session Manager.
  - EC2 instance with IMDSv2 and a gp3 data volume.
  - IAM instance role:
    - SSM core;
    - read and write on the backup bucket only;
    - read on the Cognito JWKS (public anyway).
  - S3 bucket for Litestream and exports: versioned, encrypted, with a public access block.
  - Data Lifecycle Manager nightly snapshot policy.
  - CloudFront distribution:
    - caching disabled for `/api/*`, `/mcp` and `/auth/*`;
    - static `web/` cached;
    - SSE (`/api/events`) passes through.
  - Cognito user pool, app client (code + PKCE, callback `https://<cf-domain>/auth/callback`) and hosted UI domain prefix.
  - Optional Route 53 record and ACM certificate when `DomainName` is given.
- Parameters:
  - `RepoTag`
  - `InstanceType`
  - `AllowedEmailDomains`
  - `AdminEmail` (the first admin user)
  - `DomainName`
  - `HostedZoneId`
- `infra/deploy.sh` is a wrapper around `aws cloudformation deploy`. It prints the URL, the Cognito domain and the commands for the first admin's password.
- Cost note in `OPERATIONS.md`: t4g.small, 20 GB gp3, S3, CloudFront and Cognito come to roughly US$20–25 a month at team scale (verify against current prices at deploy time).

## 3. Accounts, ownership, sharing (server + UI)
Model, migration `020_ownership.sql`:
- `envs.owner_user_id` and `envs.visibility`:
  - `private`: the owner and editors only.
  - `shared`: plus the people listed.
  - `published`: everyone can read.
- `env_members(env, user_id, role: viewer|editor)`.
- `drafts.owner_user_id` and `drafts.visibility` (`private` | `shared`).
- `api_tokens(id, user_id, name, hash, created_at, last_used_at, revoked_at)`. The token is shown once and stored as a SHA-256 hash.
- `users.is_admin`.

Rules, enforced in one place (`server/access.ts`, pure checks in `core/access.ts`):
- Sealed envs (harvested, for example `prod`):
  - everyone signed in can read them;
  - only tokens with the `harvester` scope can ingest;
  - admins manage them.
- Design envs:
  - The creator becomes the owner, and the env starts `private`.
  - The owner can share with named users (viewer or editor), publish it to everyone (read), or unpublish.
  - Editors can open drafts.
  - Only the owner (or an admin) can delete, publish, or apply a draft to the env.
- Drafts are private to their author until shared. Applying a draft needs editor rights on the env.
- Everything a user cannot read is absent from:
  - lists: envs, search, entry points, mentions, notifications, comments, action items;
  - SSE events;
  - MCP results.
- Asking for a hidden item by id returns 404, never 403.
- Comments, notes, action items and open questions inherit the env's visibility.
- MCP and REST act as the token's user, with the same rules. `create_env` makes a private design env owned by the caller. A write to a sealed env without the harvester scope is `403 SEALED`.
- Audit: the existing changelog rows get the acting user id.

UI (needs a mockup approved first, under `design/mockups/`):
- Sign-in and sign-out, plus a user menu.
- "My designs" and "Shared with me" sections in the env picker. Published designs are listed too.
- A Share dialog on a design env: add people (viewer or editor), publish to everyone, and a copy-link action.
- Visibility badges: Private, Shared, Published.
- A "Tokens" page under the user menu: create (name, optional harvester scope for admins), list with last used, revoke. It shows the MCP config snippet with the token.

## 4. Agent onboarding docs
- `AGENTS.md` at the repo root, as the single entry point:
  1. Connect: hosted URL plus token, or local.
  2. The design loop, with tools in order: `create_env` (design), `open_draft`, then either `edit_in_draft` (from scratch) or `apply_import_plan` / `import_mermaid` (from documents), then `draft_changes`, `export_mermaid`, then `apply_draft`, then share or publish.
  3. Rules: always pass `env`; never write to sealed envs; use dry runs.
  4. Where to read more.
- `docs/DESIGN-FROM-SCRATCH.md`:
  - HLD: subsystems, components, channels, flows, open questions.
  - LLD: endpoints with DTOs, store schemas and keys, per-function steps, how much detail is enough.
  - A worked example.
- An MCP tool catalogue grouped by task (generated from the tool list into `docs/MCP-TOOLS.md`, with a test that it is current).
- Rewrite the MCP `initialize` instructions to point design agents at `AGENTS.md`.
- Every tool's `env` gets an explicit default policy: no silent `default`; a missing `env` is an error listing the caller's envs.

## Order of work
1. **A. Packaging + infra + OPERATIONS.md.** No UI; can start now. Test the template with `aws cloudformation validate-template` and a cfn-lint-free manual review. Do not create stacks.
2. **B. Mockup** for accounts, sharing and tokens. The maintainer approves it.
3. **C. Auth + ownership** server and UI, built to the mockup.
4. **D. Agent docs.** These can start with A.
5. **E. Deploy to the maintainer's account.** Only after the maintainer confirms the account, region and that the current DB may be copied there.
