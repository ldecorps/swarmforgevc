# Raw intake — Lean-aware coordinator: ticket lifecycle record → specifier

Status: **URGENT** — new intake, not minted. Capture only (human via Cursor
2026-08-05 ~09:55 CEST). Drain ahead of ordinary feature intakes. Specifier:
mint with expedite posture (`type: defect` is wrong for a capability add —
prefer `type: feature` with **`priority: 0` or `1`** and
`direction: human-requested`, or the highest priority the schema allows;
surface `human_approval: pending` so the human can approve same-shift). Do
**not** bury this behind Bubble / console polish.

Related
- Existing coordinator duty **"Swarm Optimizer"** in
  `swarmforge/roles/coordinator.prompt` — observes stage-dwell, chase/cost,
  recommends to the **human** via briefing. This intake is **not** a duplicate
  of that: it adds a **lean / continuous-improvement loop aimed at the
  specifier**, fed by a **durable per-ticket lifecycle record**, so process
  specs and pipeline rules can be optimized from recent evidence.
- Already-built instruments the lean loop should **reuse, not reinvent**:
  stage-dwell (`stage-dwell-report.js` / `GET /stage-dwell`), rework
  observatory + diagnosis (BL-430/431/635), bounce_history on tickets,
  handoff audit headers (`enqueued_at` / `dequeued_at` / `completed_at`),
  ticket holding windows, daily briefing optimizer notes. Gap is the
  **lifecycle ledger + specifier feed**, not more raw metrics CLIs.
- Specifier owns process/requirements altitude — they are the right consumer
  for "what just happened to tickets so we can change how we specify /
  route / gate." Coordinator must not rewrite specs itself.
- Model-steward is a different altitude (model lifecycle knowledge); do not
  conflate.

## Goal

Make the coordinator **lean-aware**:

1. **Keep a durable record of each ticket's lifecycle** while it is live and
   after it closes — stages entered/left, dwell, bounces (who/why/class),
   skips, stalls/chases, close outcome, and enough ids/timestamps to
   reconstruct the path without scraping chat.
2. **Pass recent lifecycle results to the specifier** on a reliable cadence
   (and on notable events), so the specifier can **optimize the forge
   process** (specs, gates, stage-skip policy, intake shape, acceptance
   contracts) from evidence rather than impressions.
3. Keep the coordinator at meta altitude: it **records and reports**; it does
   not author domain specs or silently change constitution. Specifier (and
   human) decide process changes; coordinator may still act within existing
   Swarm Optimizer powers (promotion order, throttle) unchanged.

## Problem

- Ticket fate is scattered across topic JSON, bounce evidence markdown,
  handoff files, briefings, and mailboxes. No single lifecycle ledger the
  coordinator owns and the specifier can consume.
- Swarm Optimizer notes go to the **human briefing**, not into the
  specifier's work loop — so process debt (false-positive QA bounces,
  missing review commits, flaky gates, repeated stage skips) does not
  systematically become better specs.
- Continuous 3-shift operation produces a lot of lifecycle signal that is
  currently underused for lean improvement.

## Why this matters (urgency)

- Without a closed lean loop, the swarm rediscovers the same process
  failures (e.g. review-role no-op forwards, red unit suite waved through,
  babysitter false CRITs) as one-off incidents instead of feeding the
  specifier's next process tickets.
- Human asked for this **as urgent** — treat drain/promotion priority
  accordingly.

## Human decisions locked in this conversation (2026-08-05)

Specifier may challenge or refine; do not silently drop these without asking.

1. **New rôle for the coordinator** — meaning a first-class **duty / mode**
   of the existing coordinator (prompt + machinery), **not** a ninth
   standing pipeline agent unless the specifier can prove a separate seat
   is required. Default: extend coordinator + durable store + handoff to
   specifier.
2. **Lifecycle record is durable and queryable** — machine-local under
   `.swarmforge/` is fine for live state; anything the specifier must act
   on across hosts should be committed or otherwise durable per existing
   live-data rules. Specifier pins the schema.
3. **Feed the specifier, not only the briefing.** Cadence default proposal:
   (a) a short digest `note` to specifier after each ticket close / QA
   bounce wave, and (b) a periodic rollup (e.g. with the daily briefing
   window or when rotating resident to specifier for root drain). Specifier
   may tighten.
4. **Content of the feed** — recent lifecycle results: path taken, dwell
   hotspots, bounce classes, skip reasons, stalls, and 1–3 concrete
   process hypotheses worth a ticket — never a dump of raw logs.
5. **Lean scope** — optimize the **forge process** (how work is specified,
   gated, routed, evidenced). Out of band: changing product features of the
   domain under build except when the domain *is* the forge (dogfood) and
   the evidence demands a process ticket.
6. **Reuse before invent.** Prefer composing existing metrics/bounce/dwell
   sources into one lifecycle view over a parallel telemetry stack.
7. **Urgency.** Specifier drains this before non-urgent Bubble/console
   intakes still sitting at backlog root; coordinator should treat the
   minted ticket as high promotion priority once approved.

## Requested outcome

1. Specifier mints paused epic and/or slice(s) with prose + Gherkin:
   lifecycle record written/updated across ticket life; recent results
   delivered to specifier; coordinator prompt documents the lean-aware
   duty and its boundary vs Swarm Optimizer / human briefing.
2. Acceptance proves the specifier actually receives usable recent
   lifecycle evidence (not merely that a file exists).
3. Docs: how the lean feed works, where the ledger lives, how the
   specifier is expected to turn it into process tickets.

## Open questions (defaults OK if human is quiet)

- Ledger format: JSONL append-only vs per-ticket JSON. Default: **JSONL
  append + per-ticket latest snapshot** if both are cheap; specifier picks
  one if dual-write is waste.
- Whether the first slice is **prompt+manual compose from existing CLIs**
  (thin) or **automated ledger writers at handoff/close** (thick). Default
  proposal: **thick enough that a close always appends a lifecycle summary
  without the LLM inventing the numbers** — LLM may narrate hypotheses on
  top of recorded facts.
- Epic id: new `lean-aware-coordinator` vs fold under an existing
  swarm-reliability / console epic. Default: **new epic**.

## Out of scope

- Replacing QA, hardener, or babysitterd.
- Auto-amending constitution without human/specifier.
- Host queue poll / unit-suite intakes (separate, already filed).
