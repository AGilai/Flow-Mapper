# Info pane for a component or subsystem (#68 part 2, 0.32.0): build spec

Design: Frame 19 in design/mockups/design-env.html (19a–19g), approved by the maintainer on 2026-10-22. Builds on
`about` (0.30.2, docs/plans/about.md) and users/@mentions (0.31.0, docs/plans/users-mentions.md), so it is built after
both.

## Approved choices
- Extend today's side panel into a right drawer (420 px, resizable 340–640, width remembered per viewer); ≤ 760 px a
  bottom sheet with peek / half / full. Jump bar: Overview · About · Flows · Connections (today's panel content becomes
  Connections). Edge, endpoint and step panels are unchanged.
- Opened by selecting a component or subsystem in the System map (both levels), a flow lifeline head or subsystem band,
  and the subsystem view. Content swaps when another item is selected. Clicking empty space closes it unless pinned;
  Esc or × always closes. `sel=` in the URL opens it.
- About rendered (Markdown-lite, sanitized at render); each `##` section a block; Open questions tinted, its count in the
  header. Status from the design diff. Edit in a design draft: Write / Preview, a section template for an empty about,
  "in draft" mark, Save to draft / Cancel, unsaved-changes prompt. Harvested envs read-only with the empty state of 19e.

## Extras approved by the maintainer
1. **Open-questions list:** every `## Open questions` section's list items (of components and subsystems, in the
   env, draft-aware) are collected into one list: a "Questions (n)" view in the design env (where: next to Mentions in
   the rail, scoped to the env) with the item, the question text, and a link that opens the pane scrolled to it. Pure
   extractor in core; `GET /api/envs/:env/open-questions[?draft=]`; MCP `list_open_questions`.
2. **@mentions in About:** the about editor gets the frame-18 "@" picker; `@[userId]` tokens render as chips in the
   pane; mentions in an about count in the Mentions page like comment mentions (source "about of <item>").
3. **Owner field per subsystem (and component):** a structured `owners: [userId]` on groups and on the service header
   (users registry from 0.31.0), shown in the Overview facts and editable as user chips; the free-text `## Owners`
   section stays allowed. Writable by manifest/plan as names or `{externalSource, externalId}` (matched to users).

## Tests and demo
Pane open/close/pin/sel= state (pure), open-questions extractor, mention tokens in about, owners matching, edit flow in a
draft, harvested read-only. Screenshots vs frame 19 light/dark/760. CHANGELOG, DEMOS, version 0.32.0.
