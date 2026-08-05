# Raw intake — Lean-aware coordinator: ticket lifecycle record → specifier

Status: **URGENT** — new intake, not minted. Capture only (human via Cursor
2026-08-05 ~09:55 CEST; amended ~09:58 for shift-closing ceremony). Drain
ahead of ordinary feature intakes. Specifier: mint with expedite posture
(`type: defect` is wrong for a capability add — prefer `type: feature` with
**`priority: 0` or `1`** and `direction: human-requested`, or the highest
priority the schema allows; surface `human_approval: pending` so the human
can approve same-shift). Do **not** bury this behind Bubble / console polish.

Related
- Existing coordinator duty **"Swarm Optimizer"** in
  `swarmforge/roles/coordinator.prompt` — observes stage-dwell, chase/cost,
  recommends to the **human** via briefing. This intake is **not** a duplicate
  of that: it adds a **lean / continuous-improvement loop aimed at the
  specifier**, fed by a **durable per-ticket lifecycle record**, so process
  specs and pipeline rules can be optimized from recent evidence.
- **Shift closing ceremony** — the natural home for this optimisation pass.
  Related schedule / ceremony work: BL-658 (briefing trigger from closure
  schedule), BL-660 (three-shift packs; closing ceremony follows the active
  shift), BL-762 (finish-shift bedtime verb). Wire the lean review into
  whatever the live closing-ceremony path is (or extend it), not invent a
  second end-of-shift ritual.
- Already-built instruments the lean loop should **reuse, not reinvent**:
  stage-dwell (`stage-dwell-report.js` / `GET /stage-dwell`), rework
  observatory + diagnosis (BL-430/431/635), bounce_history on tickets,
  handoff audit headers (`enqueued_at` / `dequeued_at` / `completed_at`),
  ticket holding windows, daily briefing optimizer notes. Gap is the
  **lifecycle ledger + specifier+coordinator closing-ceremony feed**, not
  more raw metrics CLIs.
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
3. **Primary cadence = shift closing ceremony.** At end of shift, coordinator
   and specifier jointly use the data accumulated during that shift to make
   tentative process adjustments (intake priorities, stage-skip / gate
   hypotheses, follow-up process tickets, throttle / promotion posture
   within existing powers). This lean optimisation pass is a **named step of
   the closing ceremony**, not an optional afterthought or briefing-only note.
4. Keep the coordinator at meta altitude: it **records and reports**; it does
   not author domain specs or silently change constitution. Specifier (and
   human) decide lasting process changes; coordinator may still act within
   existing Swarm Optimizer powers (promotion order, throttle) unchanged.

## Problem

- Ticket fate is scattered across topic JSON, bounce evidence markdown,
  handoff files, briefings, and mailboxes. No single lifecycle ledger the
  coordinator owns and the specifier can consume.
- Swarm Optimizer notes go to the **human briefing**, not into the
  specifier's work loop — so process debt (false-positive QA bounces,
  missing review commits, flaky gates, repeated stage skips) does not
  systematically become better specs.
- Continuous 3-shift operation produces a lot of lifecycle signal that is
  currently underused for lean improvement; shift close already exists as
  ceremony/schedule surface but has no lean adjustment step for
  coordinator + specifier.

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
3. **Shift closing ceremony is the main optimisation window (locked
   2026-08-05 ~09:58).** Coordinator and specifier use the shift's
   accumulated lifecycle / lean data to make **tentative adjustments**
   before the shift fully winds down (finish-shift / pack boundary /
   ceremony handoff — specifier pins the exact hook to BL-658/660/762).
   Mid-shift close/bounce digests may still exist as secondary signals;
   they do not replace the end-of-shift pass.
4. **Both roles act in the ceremony.** Coordinator brings the ledger /
   numbers and any within-power adjustments (promotion order, throttle
   posture). Specifier turns evidence into process tickets, spec/gate
   tweaks, or explicit "no change" — a silent ceremony is a failed
   ceremony.
5. **Feed the specifier, not only the briefing.** Closing-ceremony packet
   is mandatory; optional extras: short `note` after a harsh bounce wave,
   and human-visible summary in the briefing. Specifier may tighten.
6. **Content of the feed** — shift-scoped lifecycle results: path taken,
   dwell hotspots, bounce classes, skip reasons, stalls, and 1–3 concrete
   process hypotheses / tentative adjustments — never a dump of raw logs.
7. **Lean scope** — optimize the **forge process** (how work is specified,
   gated, routed, evidenced). Out of band: changing product features of the
   domain under build except when the domain *is* the forge (dogfood) and
   the evidence demands a process ticket. "Tentative" means reversible /
   ticketed / noted — not silent constitution edits.
8. **Reuse before invent.** Prefer composing existing metrics/bounce/dwell
   sources into one lifecycle view over a parallel telemetry stack.
9. **Urgency.** Specifier drains this before non-urgent Bubble/console
   intakes still sitting at backlog root; coordinator should treat the
   minted ticket as high promotion priority once approved.

## Requested outcome

1. Specifier mints paused epic and/or slice(s) with prose + Gherkin:
   lifecycle record written/updated across ticket life; recent results
   delivered to specifier; **closing-ceremony lean pass** for coordinator
   + specifier is wired and acceptance-backed; coordinator (and specifier)
   prompts document the lean-aware duty and its boundary vs Swarm Optimizer
   / human briefing.
2. Acceptance proves (a) usable shift-scoped lifecycle evidence exists at
   ceremony time, and (b) the closing ceremony actually invokes the
   coordinator+specifier optimisation step (not merely that a file exists).
3. Docs: how the lean feed works, where the ledger lives, how closing
   ceremony runs the pass, how the specifier turns it into process tickets
   or explicit no-ops.

## Open questions (defaults OK if human is quiet)

- Ledger format: JSONL append-only vs per-ticket JSON. Default: **JSONL
  append + per-ticket latest snapshot** if both are cheap; specifier picks
  one if dual-write is waste.
- Whether the first slice is **prompt+manual compose from existing CLIs**
  (thin) or **automated ledger writers at handoff/close** (thick). Default
  proposal: **thick enough that a close always appends a lifecycle summary
  without the LLM inventing the numbers** — LLM may narrate hypotheses on
  top of recorded facts.
- Exact ceremony hook: finish-shift script, handoffd closing-ceremony
  sweep (BL-658), or resident rotate-to-specifier at shift boundary
  (BL-660). Default: **whatever already runs at shift close; add one
  lean step there** — do not invent a fourth stop verb.
- Epic id: new `lean-aware-coordinator` vs fold under an existing
  swarm-reliability / console epic. Default: **new epic**.

## Out of scope

- Replacing QA, hardener, or babysitterd.
- Auto-amending constitution without human/specifier.
- Host queue poll / unit-suite intakes (separate, already filed).
