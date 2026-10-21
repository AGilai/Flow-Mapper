# Readability audit (v0.4.2, env prod, sample data)

These findings come from screenshots of the live app at 1440px. For each page, the top three
problems are ranked by how much they slow the reader down, and each has a one-line fix. Fixes
marked **[C:name]** use a shared component (listed at the end). The rules are in
`docs/UI-GUIDE.md`, and the reference mockup is `design/mockups/channel-sns.html` (screenshot:
`channel-sns.png`).

## Channel: SNS topic (`#/channels/sns:order-events`)
1. **The flow is not shown.** Publishers, subscriptions and consumers are in three stacked boxes,
   and the reader has to assemble publisher → topic → filter → queue → consumer. Fix: one
   full-width flow lane with the filter on the topic→queue connector. **[C:flow-lanes]**
2. **The same subscription appears twice.** `sqs:shipping-order-events` is declared by infra
   (OrderPlaced only, live differs from code) and by shipping-svc (all events). The page shows two
   unrelated rows with `conflict`/`drift` badges and doesn't say that the filter is what differs.
   Fix: merge into one row with an inline disagreement block, one line per source, and highlight
   the differing value. **[C:merged-declaration]**
3. **Status is away from its subject and the text is truncated.** "OrderCancelled orders-svc →
   analytics… unhandled" sits in the right column, and the truncation hides *which* consumer has no
   handler (shipping-svc). Fix: an event type × destination matrix, with "arrives, no handler · if
   shipping-svc's filter is right" in the cell. **[C:delivery-matrix]**
- Also: "Consumers 0" reads as broken (next to a red "1 Problems"). Fix: drop the tile and say
  "delivered through 3 queues" in the verdict. **[C:verdict]** The right column is cramped while the
  lower half of the page is empty. Fix: full-width sections. The provenance line floats under the
  right column. Fix: move it to the page-head meta line. **[C:page-head-meta]**

## Channel: SQS queue (`#/channels/sqs:shipping-order-events`)
1. **The upstream is duplicated.** "Published by 2" lists "fed by sns:order-events" twice, once per
   declaration. Fix: merge by key, and show the topic's filter disagreement on the incoming
   connector. **[C:merged-declaration]**
2. **There is no flow.** The topic, filter, queue and consumer handler are in separate boxes, and
   "Subscriptions 0" is meaningless for a queue. Fix: lanes upstream topic (filter) → queue →
   consumer · handler, and hide the subscriptions box for queues. **[C:flow-lanes]**
3. **"unhandled" is away from the consumer.** shipping-svc handles OrderPlaced only, but the
   unhandled OrderCancelled shows in the right column. Fix: a matrix row per event type with the
   handler or "no handler" next to the consumer. **[C:delivery-matrix]**

## Service (`#/services/orders-svc`)
1. **The egress groups mix three axes.** Groups are titled by status ("No match", "Unresolved by
   the harvester"), by pattern ("Fan-out to 3 services"), by target ("inventory-svc") and by kind
   ("Data stores"). Fix: group by target only, and put the status as a chip in the row (a red
   connector for no match, a dashed one for unresolved). **[C:flow-lanes]**
2. **Half the page is empty.** The ingress lane ends after 2 rows, and the centre "orders-svc · 4
   functions" box only decorates. Fix: align each egress row to the function that makes the call
   (function as the middle column), so the centre column carries information.
3. **Run-on text.** "via sns:order-events, sqs:analytics-all-events, sqs:shipping-order-events,…"
   is one wrapped string, and the transport pill sits at the far right. Fix: render the fan-out as
   a mini lane (topic → 3 queues → 3 services), and put the transport chip before the key.
   **[C:flow-lanes]**

## Data store (`#/stores/mongodb:orders-db/orders`)
1. **The schema JSON overflows its card.** The toolbar shows "Collap", and enum values are cut off
   at the right edge. Fix: the JSON viewer scrolls inside the card, with a sticky toolbar.
   **[C:json-view]**
2. **Access is not drawn as flow.** "Who uses it" lists functions and operations, while "Reached
   from" lists entry points in a separate box, so the chain entry point → function → op → store is
   split in two. Fix: lanes entry point → function → read/write op → store. **[C:flow-lanes]**
3. **Zero boxes and tiles.** "Other keys in mongodb:orders-db 0 · None." and five equal tiles
   ("1 Services, 1 Readers, 1 Writers"). Fix: hide empty sections, and fold the counts into the
   verdict ("Read and written by orders-svc only"). **[C:verdict]**
- Also: the read and write pills use `--t-http` and `--t-sns` colours, which collide with the
  transport meaning.

## Event type (`#/events/OrderPlaced`)
1. **Routes and Consumers repeat each other.** The same three consumers appear in "Routes" (as an
   arrow string) and in "Consumers" (as a table in the right column). Fix: one lane block
   producer → topic → queue → consumer · handler. **[C:flow-lanes]**
2. **An arrow string is used as a flow.** "orders-svc → sns:order-events → sqs:… → analytics-svc
   ingest_event" mixes link and plain styles in one line, and the "Trace from this consumer" link
   adds a second line to every route. Fix: lane columns, with the trace action as an icon on the
   consumer node. **[C:flow-lanes]**
3. **The payload pushes the consumers below the fold.** Fix: put the message JSON in a reference
   section under the lanes, and collapse it beyond 15 lines. **[C:json-view]**
- Also: the event icon is magenta like EventBridge, although events are transport-neutral.

## Link health (`#/health`)
1. **Ten equal tiles wrap onto two rows** with orphans, mixing a percentage, counts and zeros, and
   none of them is clickable. Fix: at most 4 headline figures (resolved %, broken links, event
   problems, harvester issues) that filter the list below. **[C:figure-tiles]**
2. **The tabs are clipped** ("Subscriptions to nothing (0"), and empty categories are still tabs.
   Fix: a single problem table with a "kind" column and a filter, and hide zero categories.
3. **The "Services to look at" table is crushed.** Names wrap ("payments-\nsvc") and the "Neve"
   column is cut. Fix: move it under the problems at full width, with nowrap names and a bar
   column. **[C:table nowrap rule]**

## Flows (`#/flows`)
1. **The sequence diagram scrolls off to the right, and long empty vertical runs** hide where the
   messages go (steps 4–5 are blank on screen). Fix: fit the lifelines to the width (compress
   them, or collapse services that are not on screen), and stack the calls of collapsed services.
2. **The left gutter numbers (0 1 2 3 2 3 4…) have no label.** They are call depth, not step order.
   Fix: drop them, or label the column "depth" and show it as indentation.
3. **The entry list is noisy.** Every item repeats "http · entry point" on its own line above the
   key. Fix: one line per item (transport colour bar + method + path), with the service as the
   group header.

## System map (`#/system`)
1. **The legend does not match the drawing.** The legend shows a green diamond for queue/topic, but
   all channels are drawn as magenta AWS squares, so SNS and SQS look identical. Fix: colour the
   channel nodes by `--t-sns` and `--t-sqs` (shape = kind, colour = transport), and generate the
   legend from what is drawn.
2. **The layout has no direction.** It is force-directed, so callers and callees land anywhere and
   edges cross. Fix: a layered left-to-right layout (entry points left, data stores right), using
   the same flow-left-to-right rule as the lanes.
3. **Hairline edges and light labels.** At 1440px the 1px pale edges and the 11px channel names are
   hard to read, and broken edges are only red dashes. Fix: 1.5–2px edges, labels at `--fs-sm`, and
   a broken-edge badge on the node.

## Inventory (`#/inventory`)
1. **Redundant columns.** "Type: Event type" plus the "Kind: event type" pill say the same thing,
   and "Team" is empty for event types. Fix: merge into one Kind column with a transport chip, and
   hide empty columns per tab.
2. **Zeros read as alarms.** "1 producer, 0 consumers" is plain text, the same as healthy rows. Fix:
   tint only the abnormal part ("0 consumers" in `--warn` when a producer exists).
3. **The Problems column is at the far right** and separated from the name. Fix: put the problem
   count chip next to the name. **[C:status-inline]**

## Design environments (`#/...?env=sase-hld&draft=hld-import`, 0.24.0)
1. **The map legend and the new marks share a corner.** With the marks legend lines added, the legend takes two rows and covers the lowest nodes on a small map. Fix when the map gets regions
   (phase 3): move the legend out of the stage or let Fit leave room for it.
2. **A component's "what changed" can be long** ("message response of in.getUser: 1 new field, 1 changed field"). The map clamps it to 44 characters; the inventory and the page head show it whole.
3. **Removed items are listed, not drawn.** A call the draft removed shows in the list under the flow diagram, not faded in place (it is not in the trace of the draft). Revisit with the edit forms (2a).
4. **The strip adds two rows above every page** of a design environment (design chip and switches, then the draft bar). At 760px the buttons wrap; the review panel scrolls inside 52% of the height.

## Shared components (build once, use everywhere)
| Component | What it is | Used by |
|---|---|---|
| **flow-lanes** | column-per-hop grid with headers, transport-coloured connectors, a fan-out bracket, labels on connectors (filter, rule, operation), and dashed connectors for uncertain hops | channel (SNS, SQS, bus), event type, store, service connections |
| **merged-declaration** | groups declarations by identity; one row with a "declared by A, B" note, or an inline block that shows the disagreement field by field | channel subscriptions, queue upstream, service egress |
| **delivery-matrix** | event type × destination table whose cells say handled / filtered out / no handler, with the reason | SNS topic, bus, queue, event type |
| **verdict** | a one-sentence summary plus problem callouts that link to the row | all detail pages, replaces most figure tiles |
| **page-head-meta** | kind chip in transport colour, bind key in mono, provenance in plain words | all detail pages |
| **json-view fix** | scrolls inside the card, sticky toolbar | store, event type, channel details |
| **status-inline** | status chip placed after the subject's name in the same row | inventory, health, every list |
