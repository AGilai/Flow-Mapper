# Bug loop (for Flow-Mapper maintainer sessions)

While a maintainer works, the lead Claude Code session watches the event stream ([push mode](#push-mode)) and keeps a slow
`/loop 30m Follow docs/BUG-LOOP.md` as a safety net (without push mode: `/loop 15m`).
Each run is a cheap check; only when there is something to do does it start a **bug agent**
(Sonnet, in its own git worktree) to handle it. Harvesters follow up as described in
[HARVESTER-GUIDE.md](HARVESTER-GUIDE.md#reporting-problems-and-getting-fixes).

## Lead session: each run

1. `GET http://localhost:3000/api/bugs?updatedSince=<last check>` (the last check time is in
   `data/bug-loop.last`, git-ignored; first run: the last 24 hours). Write the new check time
   (taken before the request) only here, never after deploying or closing bugs.
   Also `GET /api/bugs?open=true` and add any open bug created after the seeded samples (#1–#6 are
   demo data) with no `flow-mapper` comment and no running
   agent: this catches anything a moved checkpoint skipped.
2. Drop bugs whose last comment is from `flow-mapper`, and bugs in `fixed`, `verified`, `closed`,
   `wont_fix`, `duplicate` unless the reporter moved them back to `in_progress` or asked something.
3. Nothing left: say so in one line and stop.
4. Otherwise start **one** bug agent (Agent tool, `model: sonnet`, `isolation: worktree`, in the
   background) with the brief below and the bug ids (at most three). Do not start another while
   one is running; leave the rest for the next run.
5. When it reports a pushed fix, deploy and close it: `git -C /home/ubuntu/Flow-Mapper pull --ff-only`
   (not a fast-forward: stop and tell the maintainer), stop the process whose command line is exactly
   `node --disable-warning=ExperimentalWarning server/main.ts --live-3000` (`pgrep -f -x`), start
   `setsid nohup data/serve.sh >/dev/null 2>&1 < /dev/null &`, check `GET /api/version`. Then post the
   agent's comment as `flow-mapper` and `PATCH {"status": "fixed", "fixedInVersion": "<version>",
   "resolution": {"type": "code", "ref": "<commit>"}}`.
6. Refresh the demo data (`node --disable-warning=ExperimentalWarning scripts/seed.ts`, no `--bugs`) and
   relay the outcome to the maintainer in a few lines: what was fixed (version, commit), the demo link
   (`http://localhost:3000/#/...`), what was answered or left for them, anything that failed.

## Push mode

Polling every 15 minutes is slow and mostly finds nothing. Instead, arm Claude Code's **Monitor** tool on the
event stream; each line it prints wakes the lead session at once:

```sh
curl -sN -H 'Accept: text/event-stream' 'http://localhost:3000/api/events?types=bug.created,bug.commented,bug.status' | grep --line-buffered '^data:'
```

(Add `&reporter=loader` to watch one reporter only.) Rules:

- Set the Monitor timeout to its maximum (30 minutes). When it expires or the connection drops, **re-arm it with
  `&since=<last id seen>`** (the `id` is in each `data:` line) so nothing is lost; on a fresh start use
  `GET /api/events/recent?types=bug.*&limit=20` to see what is recent.
- On each event, run steps 1-4 above for that one bug (`bugId`): fetch it, skip it if its last comment is
  from `flow-mapper`, otherwise start a bug agent. Your own comments and status changes come back as events
  (`data.author` is `flow-mapper`, or a `bug.status` you just made): ignore those.
- Keep the timed `/loop` as a slow safety net (`/loop 30m Follow docs/BUG-LOOP.md`): it catches what a dropped
  stream or a restart skipped. The stream does not replace the `updatedSince` check.
- A deploy restarts the server and drops the stream: re-arm with `since`.

## Bug agent brief

You handle bugs `<ids>` in Flow-Mapper's tracker (`http://localhost:3000/api/bugs/<id>`, with
comments). The repo is your worktree; the live checkout is `/home/ubuntu/Flow-Mapper`. Read
`CLAUDE.md`, then for each bug decide:

- **Clear and contained** (a wrong check, a crash, a missing optional field, a docs gap): fix it.
  `PATCH {"status": "in_progress"}` first.
- **A design question or a large change** (new concepts, schema redesign, anything changing how
  links resolve for everyone): do not build. Comment a concrete proposal with trade-offs,
  `PATCH {"status": "triaged"}`, and leave it for the maintainer.
- **Unclear**: comment the question, set `triaged`.
- **Already possible / not a Flow-Mapper problem**: comment how; `wont_fix` if appropriate.

Reproduce first. The reporter's data usually is not on this server. For a bug about what the map
shows or how things link:
- No manifest attached: comment asking for the evidence listed in `docs/HARVESTER-GUIDE.md`
  ("Attach the evidence"), set `triaged`, and stop there for that bug.
- Attached: load the manifest into a scratch DB (`FLOW_DATA_DIR=<tmp> PORT=3100`, never the live
  `data/`), run `POST /api/ingest?dryRun=1` and look at its `contract` section, then reproduce.
  If the manifest is what is wrong (a missing `events`, `source`, `detail`, bind key …), do not change
  code: comment exactly what to change in the manifest and set `triaged` (or `wont_fix` if nothing
  on our side). Only a problem that reproduces with their data is fixed in code.
- Contract or feature requests (a field that does not exist yet) need no reproduction.

Fixing:
- Keep schema changes additive (optional fields). Change the schema, samples,
  `docs/HARVESTER-GUIDE.md` and `docs/API.md` together. A database change goes in a new additive
  `server/db/migrations/NNN_name.sql` (new column with a default, or a new table). Never edit an
  existing migration: databases that applied it are refused. The server backs the database up
  and applies the migration at startup. Add a test that opens a database built from the older
  migrations. If the change would need a table rebuild (a changed key) or drop or rewrite data,
  stop and comment for the maintainer instead.
- Add a test that fails before the fix; `npm test` must pass. Touch nothing unrelated.
- Add a demo: a case in `samples/` (env `prod`) that shows the fix, and a row in `docs/DEMOS.md` with
  its link (e.g. `#/services/orders-svc?ep=in.get`). Your report gives that link.
- Bump the patch version in `package.json`. Commit as `Fix #<id>: …` with the line
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Ship: `git fetch origin && git rebase origin/main`, run `npm test` again, `git push origin HEAD:main`.
  Do not touch `/home/ubuntu/Flow-Mapper`, the server, or the bug's status after this: the worktree
  sandbox cannot, and the lead session deploys and closes the bug from your report.
- Leave the bug `in_progress`. In your report give: the version, the commit, and a ready-to-post comment for the reporter (what changed, exactly what to send or do now).
- If tests fail and you cannot fix them, push nothing, comment what you found, leave it `in_progress`.

Report back in under 20 lines: per bug, the decision, version and commit if fixed, the comment to
post, and anything the maintainer must decide.
