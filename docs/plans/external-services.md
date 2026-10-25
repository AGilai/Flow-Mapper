# External services (#87) — build spec

Status: approved by the lead (on behalf of the maintainer), 2026-10-25. Target 0.43.1, after #86 (0.43.0).
Source: bug #87 and its triage comment (QA TL).

## Data
- A harvested service whose header carries `details.external: true` is an **external service**. These are
  third-party hosts the Loader models as `ext-*` services, such as checkpoint-cloud and connectwise.
- Any other value, or no value, means internal, as today. Only the boolean `true` counts.
- No schema change and no migration: `details` is free-form and already stored. Check that the manifest
  schema accepts it, and add it to docs/HARVESTER-GUIDE.md ("Service header").

## Rules
1. **API and MCP:** every place that returns a service row returns `external: true` on external
   services, and omits the field otherwise. That covers the system map, the inventory, the service view,
   `entry-points`, trace lifeline/participant info, and the MCP `list_services` / `get_service` /
   `trace_flow` equivalents. The field is additive; document it in docs/API.md.
   - Changing the MCP tool descriptions changes the tool-list hash. Update the hash test only if a
     description really changed.
2. **Links:** a call whose target resolves to an external service is a normal resolved link.
   - It is never a gap, never a broken link and never "no match" in Link health.
   - The resolver already links it when the bind key matches. The work is to make sure nothing
     downstream flags it, for example a heuristic that treats services with no ingress or no
     functions as missing.
3. **Counts:** component counts list external services separately.
   - Where the UI shows "N services" or "N components" (Flows list counts, the trace header
     "N services", inventory totals, the system map summary), show "N services · M external".
     M is omitted when it is 0. Internal N excludes the external ones.
   - `/flows/counts` and other count APIs gain an `external` number alongside the existing ones
     (additive).
4. **Drawing.** The same look everywhere; reuse the existing component-box code paths with a modifier
   class:
   - **Look:** a dashed outline in a neutral grey, a muted fill, and a small "external" tag (text, not
     colour alone) on the box or head. Use existing grey tokens only, no new palette. It must stay
     distinct from the 0.42.0 amber "incomplete" and from the dash-dot "inferred (LLM)" style: use an
     even dash on the box border only, never on arrows.
   - **System map:** the external node uses that look. It has no "look inside" or double-click into
     internals, and its context menu omits inside actions.
   - **Flow lifelines:** the participant head uses that look. Arrows to it are drawn like any resolved
     call (no amber, no red). It has no inside view, no bar expansion and no internal-call pill.
   - **Lists:** service lists in Inventory, the component filter on Flows and the store/service pickers
     show the "external" tag after the name. Add an "External" facet or filter option only where
     there is already a type facet.
   - **Service page:** an external service's page shows a one-line note: "External service — a
     third-party host. Its internals are not mapped." It has no functions or flows sections, or shows
     them empty without warnings.
5. **Accessibility:** the tag is real text, read as "<name>, external". Contrast must meet 4.5:1 for the
   tag text and 3:1 for the dashed border in light and dark.

## Demo and tests
- Sample (env `prod`): add an `ext-payments-gateway` service with `details.external: true` and one
  ingress, and have an existing sample flow call it over http.
  - Show it as an external lifeline in a flow, as an external node on the map, counted as "· 1 external",
    and absent from Link health problems.
  - Add a docs/DEMOS.md row and a CHANGELOG entry.
- Tests: a pure test for the classification and the counts split; API tests for the `external` field
  on map, inventory, service and entry points; the MCP field; a Link-health test that an external
  target is not a problem; and render tests for the modifier class on map, lane head and list row.
- Browser screenshots (light and dark) of the map, a flow and the inventory, for QA's comparison with
  this spec. There is no mockup frame: this is a style modifier on existing boxes, not a new page.

## Decided questions
- No mockup frame. The style is spelled out above, and QA compares the screenshots with this spec.
- Is a service with `details.external` but with functions or steps still external? Yes: the flag wins,
  and no inside view is shown even if behaviour exists.
- An external service has no Flows-list entry points of its own. Its ingress are targets, not flows to
  open. Hide them from the entry list unless "All endpoints" is ticked.
