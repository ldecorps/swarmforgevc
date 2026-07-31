# Raw intake — Bubble Pipeline board (in-flight grid + short blurbs + detail popup)

Status: new intake, not minted. Capture only (human via Let's Talk / Cursor
2026-07-31). Human asked for intake so the specifier can weigh in — not a
pre-minted ticket. Human said this is the **last** Bubble screen in this
batch of intakes.

Related
- BL-452 / BL-464 / BL-467 — standing Telegram Pipeline Board (agents ×
  in-flight tickets grid, coordinator-fed active rows, pin). Bridge also
  serves `/pipeline-board` Mini App-style UI. Bubble should reuse the same
  read model, not invent a second board.
- Sibling Bubble pager intakes from the same evening:
  Notes, Control, Live (coordinator+resident), clarification blink.
- Mini App ports (Live, Pipeline board, and any other surface we port):
  **once the functionality lands on Bubble, Mini App copy may be removed.**
  Human explicitly said cutover / removal can be **dealt with later** — do
  not block version-one Bubble ship on Mini App deletion. Dual-run OK until
  a later deprecation slice.

## Goal

A Bubble screen that shows the in-flight pipeline board: agents as rows,
tickets as columns, mark where each ticket sits. On the main screen, short
descriptions for those in-flight tickets so the human need not open details
to know what each is about. Tap a ticket → popup with fuller detail (spec /
ticket body / Gherkins).

## Problem

- Pipeline board today is Telegram / Mini App; Bubble is the phone home
  surface and lacks this glanceable grid.
- Ticket ids alone are not enough on a small screen; short blurbs on the
  main view matter.
- Detail (YAML/spec, Gherkins) should be one tap away, not a laptop dig.

## Why this matters

- Answers “what is in flight and with whom?” at a glance.
- Short descriptions reduce tap fatigue.
- Detail popup supports real judgment without leaving Bubble.

## Human decisions locked in this conversation (2026-07-31)

Specifier may challenge or refine; do not silently drop these without asking.

1. **Navigation.** Pipeline board is another expanded-Bubble pager page
   (same family as Talk / Notes / Control / Live).
2. **Grid.** Agents as **rows** (lines). In-flight tickets as **columns**.
   Mark at the cell where that ticket currently sits (which agent). Roughly
   today’s board semantics.
3. **Main screen blurbs.** Below (or with) the grid, still on the main
   Pipeline view: a **short description** for each in-flight ticket shown.
   Human must not need the popup to know what the ticket is about.
4. **Detail popup.** Tap a ticket (cell or blurb) → popup / sheet with
   fuller detail: ticket spec / body (YAML-ish substance), and Gherkins /
   acceptance features as available. “Hyperlink” in the human’s words =
   tappable ticket → detail, not a raw URL dump.
5. **Mini App retirement (ports policy, this batch).** For surfaces we port
   to Bubble (including Pipeline and Live): **remove from Mini App once
   Bubble has the functionality.** Sequencing of that removal is **later** —
   not a gate on landing Bubble. Specifier may note a follow-up deprecation
   slice; do not over-scope v1.
6. **Out of version one.** Redesigning the whole backlog dashboard; editing
   tickets in place; replacing Telegram board pin on day one.

## Requested outcome

1. Bubble Pipeline page rendering the in-flight agent × ticket grid from the
   existing board read model.
2. Short description list (or captions) for those tickets on the same main
   screen.
3. Tap → detail sheet with spec/body + Gherkins when present.
4. Honest empty state when nothing is in flight.
5. How-to line when shipped; Mini App removal tracked separately later.

## Acceptance shape to refine

1) Open Pipeline on Bubble → see agent rows and in-flight ticket columns with
   correct marks vs live swarm state (same source as today’s board).
2) Each in-flight ticket has a short description visible without opening
   detail.
3) Tap ticket → detail shows spec/body and Gherkin/feature text when those
   artifacts exist for the ticket.
4) No in-flight work → clear empty state, not a stale grid.
5) Completing watch of in-flight work does not require Mini App Pipeline
   (Bubble sufficient). Mini App may still exist until a later cutover.

## Out of scope

- Immediate Mini App deletion (later).
- Control / Notes / Live / clarification blink (separate intakes).
- Minting without specifier disposition.

## Suggested type / priority hint for mint

- type: feature (Bubble UX + existing pipeline-board read model + detail
  fetch for spec/Gherkin)
- mutation_cost: medium (Android grid + blurb list + detail sheet + bridge
  reuse; Android acceptance-seam / BL-761 sequencing applies)
- Pair or sequence with Live Mini App port on deprecation later.
- Not offline expeditor unless the human asks.

## Specifier: please weigh in

Open questions the human did not fully lock:
- Pager order among Talk / Notes / Control / Live / Pipeline.
- Blurb source: first paragraph of `notes:`, title only, or a dedicated
  summary field.
- Detail sheet: native render of YAML vs prettified markdown; how to load
  linked `.feature` files.
- Mono-router vs full classic column set on Bubble’s small width (horizontal
  scroll OK?).
- Whether Telegram board stays forever as mirror or eventually Bubble-only
  for phone (human: Mini App removal later; Telegram pin not decided).
