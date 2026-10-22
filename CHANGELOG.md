# Changelog

## Unreleased
- The step walker starts at step 0 (no step selected): a flow, tab or sub-flow opened without `step=` shows no highlighted step and the bar reads "Step 0 of N". Next goes to step 1, Previous from step 1 returns to 0 (no `step=` in the URL). An explicit `step=N` still selects that step.
- A tab of another environment, maximized, shows "read-only · Switch" next to the env chip (the full note is hidden there).
- Clicking a capped "Tab" button again no longer stacks identical toasts: the one showing stays and its timer restarts.
- On touch screens the Flows list "Tab" button has a 44px tall hit area.
