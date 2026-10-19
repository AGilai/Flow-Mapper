# Bug loop (for Flow-Mapper maintainer sessions)

While a maintainer works, the lead Claude Code session runs `/loop 15m Follow docs/BUG-LOOP.md`.
Each run is a cheap check; only when there is something to do does it start a **bug agent**
(Sonnet, in its own git worktree) to handle it. Harvesters follow up as described in
[HARVESTER-GUIDE.md](HARVESTER-GUIDE.md#reporting-problems-and-getting-fixes).

## Lead session: each run

1. `GET http://localhost:3000/api/bugs?updatedSince=<last check>` (the last check time is in
   `data/bug-loop.last`, git-ignored; first run: the last 24 hours). Write the new check time.
2. Drop bugs whose last comment is from `flow-mapper`, and bugs in `fixed`, `verified`, `closed`,
   `wont_fix`, `duplicate` unless the reporter moved them back to `in_progress` or asked something.
3. Nothing left: say so in one line and stop.
4. Otherwise start **one** bug agent (Agent tool, `model: sonnet`, `isolation: worktree`, in the
   background) with the brief below and the bug ids (at most three). Do not start another while
   one is running; leave the rest for the next run.
5. When it reports, relay the outcome to the maintainer in a few lines: what was fixed (version,
   commit), what was answered or left for them, anything that failed.

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

Fixing:
- Keep schema changes additive (optional fields). Change the schema, samples,
  `docs/HARVESTER-GUIDE.md` and `docs/API.md` together. If `server/db/migrations/001_init.sql`
  would change, stop and comment for the maintainer instead (reinstalling the DB deletes the
  reporters' bugs).
- Add a test that fails before the fix; `npm test` must pass. Touch nothing unrelated.
- Bump the patch version in `package.json`. Commit as `Fix #<id>: …` with the line
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Ship: `git fetch origin && git rebase origin/main`, run `npm test` again, `git push origin HEAD:main`,
  then `git -C /home/ubuntu/Flow-Mapper pull --ff-only` and restart the server: stop the process
  whose command line is exactly `node --disable-warning=ExperimentalWarning server/main.ts`
  (`kill $(pgrep -f -x '<that command>')`; a looser pattern matches your own shell), then
  `cd /home/ubuntu/Flow-Mapper && setsid nohup data/serve.sh >/dev/null 2>&1 < /dev/null &`.
  Check `GET /api/version` shows the new version. If the pull is not a fast-forward, stop and report.
- On the bug: comment what changed, exactly what the reporter should send or do now, and the
  commit (author `flow-mapper`), then `PATCH {"status": "fixed", "fixedInVersion": "<version>",
  "resolution": {"type": "code", "ref": "<commit>"}}` (move through `in_progress` first).
- If tests fail and you cannot fix them, push nothing, comment what you found, leave it `in_progress`.

Report back in under 15 lines: per bug, the decision, version and commit if fixed, and anything the
maintainer must decide.
