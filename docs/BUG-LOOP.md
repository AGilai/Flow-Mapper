# Bug loop (for Flow-Mapper maintainer sessions)

While a maintainer works, a Claude Code session runs this every 15 minutes:
`/loop 15m Follow docs/BUG-LOOP.md`. It answers and fixes what harvesters and users report in the
bug tracker, and tells them when a fix is on `main`. Harvesters follow up as described in
[HARVESTER-GUIDE.md](HARVESTER-GUIDE.md#reporting-problems-and-getting-fixes).

## Each run

1. `GET http://localhost:3000/api/bugs?updatedSince=<last check>` (keep the time of the last check
   in `data/bug-loop.last`, which is git-ignored; first run: the last 24 hours). Skip bugs whose
   last comment is your own, and bugs in `fixed`, `verified`, `closed`, `wont_fix`, `duplicate`
   unless the reporter moved them back to `in_progress` or asked something.
2. For each remaining bug, read it with its comments and decide:
   - **Clear and contained** (a wrong check, a crash, a missing optional field, a docs gap):
     fix it. Move it to `in_progress` first.
   - **A design question or a large change** (new concepts, schema redesign, anything touching
     how links are resolved for everyone): do not build. Comment with a concrete proposal and the
     trade-offs, set `triaged`, and leave it for the maintainer.
   - **Unclear**: comment with the question, set `triaged`.
   - **Not a Flow-Mapper problem / already possible**: comment how, set `wont_fix` or answer and
     wait for the reporter.
3. Fixing:
   - Follow CLAUDE.md. Keep schema changes additive (optional fields) so existing manifests stay
     valid. Change the schema, samples, `docs/HARVESTER-GUIDE.md` and `docs/API.md` together.
   - Add a test that fails before the fix. `npm test` must pass. Do not touch unrelated code.
   - Bump the patch version in `package.json` (0.3.0 → 0.3.1).
   - Commit (`Fix #<id>: …`, with the usual co-author line) and push to `main`.
   - Restart the server so it runs the fix: stop the process whose command line is exactly
     `node --disable-warning=ExperimentalWarning server/main.ts` (match it exactly; a looser
     pattern also matches your own shell), then `setsid nohup data/serve.sh &`.
     If the DB schema (`001_init.sql`) changed, stop and leave a comment for the maintainer
     instead: reinstalling the database deletes the reporters' bugs.
   - Comment on the bug: what changed, exactly what the reporter should send or do now, the commit.
     Then `PATCH {"status": "fixed", "fixedInVersion": "<new version>", "resolution": {"type": "code", "ref": "<commit>"}}`.
4. If tests fail and you cannot fix them within the run, revert your change, comment what you
   found, and leave the bug `in_progress`.
5. Write the check time to `data/bug-loop.last`. If nothing changed, say so in one line.

At most three bugs per run; leave the rest for the next one.
