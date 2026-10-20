# Build brief: Flows with activation bars, flow tabs, drill-down and descriptions

Approved mockup: `design/mockups/flow-activation.html` (rev 4, commit 4ef371a). The mockup's decision
lists and frame labels are the spec. This brief splits the build into three parts; each part is
its own branch, QA agent and designer review, merged before the next starts.

Decisions made after rev 4 (not drawn in the mockup):
- Closing a sub-flow tab keeps the tabs opened from it open.
- Every flow needs a whole-flow description, and each service sub-flow has its own. "Generate…"
  offers two prompts: the whole flow with all its services, and one service only.
- Panels squeeze the page and never overlay it (docs/UI-GUIDE.md, section 9).
- Every tab has the same two parts: the flow's own diagram, and under it the list of its async
  sub-flows. A row in that list is collapsed by default but expands IN PLACE into a card that
  shows the sub-flow's diagram and its own nested list (card styling: mockup commit c564ad5,
  frame 1). "Open in tab" stays on each row/card. "↩ seen in N" rows jump to card N.

## Part 1: diagram (0.11.0)
- One activation bar per call into a service, spanning the whole call; a service called twice gets
  two bars. Bar colour = the transport that entered it.
- Internal calls are not drawn: an "N internal calls ▸" pill on the bar (warn tint if some are
  unresolved). The "Internal calls" checkbox goes away.
- Sync calls: request arrow plus dashed return (status if known, else "return"). Unresolved / no
  match: red dashed arrow to an "unresolved" lifeline, no return.
- Data stores are stubs on the bar (verb over store name), hidden by "Data stores".
- Publishes end at the "published events" rail on the right: topic chip and "↓ N flows" badge
  (amber "no consumers"). The diagram stops there; async work is not drawn in the lane.
  Topics and queues get no bar. "Queues and topics" adds queue/topic lifelines inside sub-flows.
- No arrow crosses an unrelated bar.
- Under the diagram: the async index (one 40px row per consumer flow, grouped by publish / alt
  branch; repeats as "↩ seen in N" rows; "suspect" chip when one publish reaches the same
  consumer+handler twice; "Open all distinct (N)"). In part 1 a row opens the consumer's flow
  (today's navigation); part 2 turns it into a tab.
- Drill-down: double-click a bar or right-click → "Show inside X": 380px panel on the right that
  squeezes the diagram; lists only the functions this flow runs (handler + chain, steps, code
  links, stores, alt frames with condition headings) and "All N functions of X ›". Esc closes.
- "Inside the service": root bar, arrows out, callees as plain lifelines, publish badge one leg.
- Keep alt frames (#41), repeats (#43), frontier markers (#34), counts, MCP and the API trace
  shape; the new layout is a rendering of the same trace. Put layout rules in pure helpers with
  tests (bar spans, which messages fold into a bar, async index rows, suspect detection).

## Part 2: tabs (0.12.0)
- Every flow is a tab, all equal and closable: picking an entry point opens a tab (never replaces);
  async rows, rail badges and "Start a full flow from here" open tabs. Labels, icons, overflow
  list, keyboard ([ ] 1–9 Alt+W Alt+Shift+T, ARIA tablist; Esc never closes a tab), URL state
  (`tabs=` with stable keys, `tab=`; old `service=&ingress=` links open one tab), tab memory,
  breadcrumbs on sub-flow tabs, empty state "Pick an entry point", 280 ms open animation with a
  reduced-motion fallback — all as in the mockup.

## Part 3: descriptions (0.13.0)
- Two records per key, `source` human | ai. Key: env + service + ingress (flow), plus callee for a
  service sub-flow. New migration (next free number), REST endpoints (read with the trace; human
  write via REST/UI), MCP tool `set_description(env, service, ingress, callee?, text, model)`
  writing the AI record only, with model, generated_at and trace hash ("outdated" flag).
- UI: Human box (edit / add a note) first, collapsible AI box (no edit, "Generate…" dialog with the
  two copyable prompts). Places: top of an entry-point tab, one-line under a sub-flow tab's
  breadcrumb, drill-down header, bar hover popover.
- Docs: docs/API.md, MCP section, HARVESTER-GUIDE if relevant.
