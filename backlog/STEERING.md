# Kanban Steering Policy (BL-138)

The specifier owns this file. It declares ONE active strategic direction per
cycle, the classification of every backlog ticket against that direction, the
pull/WIP rules the coordinator applies when promoting work, and the review
cadence that is the only sanctioned way to change direction.

## Current direction

- **Direction:** NONE — `reliability-first` was RETIRED at the 2026-07-13 review,
  having met its target. No direction is currently declared, pending the human's
  choice of the next one (see "Awaiting the human" below).
- **Effect while no direction is declared:** the Direction lane imposes NO
  restriction. Every ticket is eligible for pull on the ordinary rules —
  bugs/expedite first, then by priority, with orthogonality and the hard WIP cap
  unchanged. A retired direction must never keep silently vetoing work: an
  expired policy is not a policy.

### Retired: `reliability-first` (2026-07-06 → 2026-07-13) — target MET

- **Was:** harden the pipeline before building on it; the competing themes (phone
  UX, multi-agent abstraction, concurrent swarms) all sit on that substrate, and
  investing in them while the substrate loses work is rework waiting to happen.
- **Target metric was:** ≥ 80% of parcels passing QA first attempt, AND the count
  of open BUG-titled tickets decreasing at each weekly review.
- **Outcome:** all TEN tickets in its declared prioritized slice are closed
  (BL-107, BL-115, BL-116, BL-125, BL-126, BL-127, BL-131, BL-135, BL-136,
  BL-137) — open declared-bug count 7 → 0. The reliability backlog is drained:
  at review time there were ZERO `aligned` and ZERO `expedite` candidates left
  anywhere in `active/` or `paused/`. The direction had nothing left to prefer,
  and its only remaining effect was to block the work the human was asking for.

## Awaiting the human — the next direction

The specifier does not pick the strategic theme unilaterally when the human is
present and the choice is genuinely discretionary. The evidence from this cycle
points at two candidate themes, and the human has pushed on BOTH:

- **cost-control** — "we have to reduce costs" (2026-07-13). Agent COUNT is the
  dominant lever: BL-324 (park unneeded roles), BL-318 (make auto-hibernate
  reachable), BL-319 (cheaper coordinator backend), BL-101 (headless secondary
  swarms).
- **human-in-the-loop / front-desk trust** — the swarm asked for approval, threw
  the question away, could not hear the answer, and proceeded without the human
  (BL-325); a topic still opens with a bare `TaskStarted` (BL-322, asked for
  twice).

Until the human declares one, no direction is in force and nothing is gated by
this file.

## Classification

Every ticket in `backlog/active/` and `backlog/paused/` carries a
`direction:` field with one of:

- `aligned` — advances the current direction; eligible for normal pull.
- `non-aligned` — valid work for a different theme; stays paused this cycle.
- `expedite` — defect or operational blocker; eligible for pull regardless
  of direction (bugs-first standing order is unchanged).
- `human-requested` — the human explicitly asked for this ticket. Eligible for
  pull regardless of direction, ranked alongside `expedite`. **STEERING may
  order the work the human has not prioritized; it may never veto the work the
  human HAS.** (Added at the 2026-07-13 review. BL-322 was asked for TWICE and
  could not be pulled: it was `non-aligned`, the single non-aligned lane slot
  was held by BL-324, and so the policy silently starved an explicit human
  request. Reclassifying it as `expedite` would have been the easy escape — and
  a lie, since it is a UX feature and not a defect. The honest fix is that the
  policy was missing a value, not that the ticket was mislabelled. Do not
  launder a human request through `expedite`; tag it for what it is.)
- If the human has to ask for the same ticket twice, treat that as a DEFECT IN
  THIS FILE, not as a queue working as intended. Escalate it as a steering
  review, not as a promotion decision.

Rules:

1. The specifier tags every new spec with `direction:` at spec time, judged
   against the direction current at that moment.
2. Non-aligned tickets are not promoted while the direction holds, unless
   reclassified as expedite (a defect/blocker discovered in them).
3. Classification applies at PULL time. Work already in `backlog/active/` or
   in flight when a direction is declared is grandfathered: it finishes
   normally and is never yanked mid-pipeline.
4. Reclassification outside a review happens only when facts change (e.g. a
   ticket turns out to be a defect); the specifier commits the retag with a
   one-line reason.

## Pull policy (coordinator applies at promotion time)

- **Hard cap:** `active_backlog_max_depth` in `swarmforge.conf` (read the
  current value each time) remains the absolute WIP ceiling.
- **Direction lane:** at most ONE active slot may hold a `non-aligned`
  ticket, and only when no orthogonal `aligned`/`expedite` candidate exists.
  All other slots pull `expedite` first (bugs-first), then `aligned`, by
  priority.
- **Orthogonality:** the Concurrent Work Orthogonality rule (constitution,
  workflow article) is unchanged and applies within the lane.
- **Definition of Ready** (a ticket may not be promoted unless all hold):
  1. `id`, `milestone`, `priority` present;
  2. prose `description:` stating what/why/constraints;
  3. Gherkin `acceptance:` scenarios;
  4. `direction:` tag present;
  5. scope orthogonal to everything currently in flight.

## Review cadence

- The direction is reviewed WEEKLY by the specifier (next review:
  2026-07-13), or immediately on an explicit operator request.
- Each review records a row in the log below: keep or change, plus the
  evidence consulted (metric readings, bounce counts, open-bug delta).
- If the decision is **change**, every active/paused ticket is reclassified
  against the new direction in the same pass, and the new direction block
  above replaces the old one.

| Review date | Decision | Evidence |
|---|---|---|
| 2026-07-06 | declare `reliability-first` | 5-parcel QA compile bounce (2026-07-06); open BUG tickets: BL-107, BL-125, BL-126, BL-127, BL-135, BL-136, BL-137 |
| 2026-07-13 | **retire `reliability-first` (target met); declare NONE pending the human; add `human-requested` class; reclass BL-322** | Triggered by an explicit operator request (the human asked for BL-322 TWICE) and by the scheduled weekly review falling due. All 10 tickets of the declared prioritized slice are closed (BL-107/115/116/125/126/127/131/135/136/137) — declared open-bug count 7 → 0. At review time `active/` + `paused/` held ZERO `aligned` and ZERO `expedite` candidates: every remaining ticket (BL-324, BL-101, BL-322) was `non-aligned`, so the one-slot non-aligned lane (held by BL-324) made BL-322 structurally unpullable. The direction had nothing left to prefer and was purely blocking. |

## Next pulls (as of the 2026-07-13 review)

All ten tickets of the previous prioritized slice are CLOSED; that list is
retired. With no direction in force, pull on the ordinary rules (bugs/expedite
and `human-requested` first, then by priority; orthogonality and the WIP cap
still apply at promotion time):

**Pull these two NOW, in parallel — they are genuinely orthogonal** (verified by
file scope, 2026-07-13):

1. **BL-328** — `expedite`, pri 0. Merged code never reaches the running daemons;
   it DEFEATS QA (a fix can be built, approved, merged, closed and still inert).
   Touches build/health/supervisor-restart — disjoint from everything below.
2. **BL-322** — `human-requested`, asked for TWICE. Touches `swarmEventStream.ts`
   (the `TaskStarted` payload) and the topic render.

**Then the topic-serialisation chain, STRICTLY IN ORDER.** It is serial BY DESIGN,
not by scheduling failure — do not try to parallelise it:

3. BL-329 — serialise topic content into the repo. Overlaps BL-322 on the bot's
   message path, so it follows BL-322 rather than running beside it.
4. BL-330 — state-based reconciliation. Overlaps BL-322 on `swarmEventStream.ts`
   (BL-322 edits `diffTaskStarted`, BL-330 edits `diffTaskCompleted`), so it waits
   for BL-322 to clear that file.
5. BL-331 — delete only after a VERIFIED record. HARD-gated on BL-329 + BL-330:
   building it early destroys un-serialised transcripts, including the human's own
   messages. `depends_on` here is a data-loss gate, not a preference.
6. BL-332 — recreate by replaying the record. Gated on BL-329 + BL-331. The round
   trip it proves is the acceptance test of the whole chain; until it passes,
   "deletion is safe" is a claim rather than a fact.

Also in flight:

- BL-324 — amended three times off review findings (TOCTOU park race, warm core,
  lookahead), and it KILLS PANES. It must not land until QA has driven a real
  park/unpark cycle against a live swarm, per its own e2e procedure.
- BL-101 — headless secondary swarms. Holds until the human names the next
  direction; it is the largest of the cost-themed candidates and should not be
  pulled on inertia.

---

## 2026-07-13 — the INTAKE drain (BL-333..BL-344)

Nine operator INTAKE docs were drained into twelve tickets. Most originate from
the human's own Telegram messages, which went **unread for two days**. Read the
starvation pair first; everything else in this batch is downstream of it.

**Pull these first — the front desk is deaf while they are open.**

1. **BL-333** — `expedite`, pri 2. Alarm when the front desk is starved. Ships
   REGARDLESS of any other decision; it is what converts a silent, indefinite
   failure into a visible one. Small.
2. **BL-334** — `expedite`, pri 3. The restricted front-desk Operator — **the
   human's own chosen fix**, picked from three options he was explicitly asked
   to decide between. `depends_on: [BL-333]`: both change `operator_runtime.bb`'s
   tick and its status output, and this project has been bitten by two roles
   editing one file at once. Serial, deliberately.

An interactive Operator holds the single-Operator slot **permanently** — it is
instructed never to exit — so no disposable Operator is ever spawned to read
Telegram. This is not a discipline lapse to be reminded away; it is structural.
Until BL-334 lands, ANY message the human sends may sit unread indefinitely,
including the ones that created this batch.

**Then the verification pair — "done" does not currently mean "he can see it".**

3. **BL-335** — pri 3. Three features shipped, closed, and STILL INVISIBLE to
   him. Verify against his REAL email and the REAL deployed PWA. A passing test
   is what all three already had; evidence from a test is a bounce.
4. **BL-336** — pri 4. The one-pass headless audit he prefixed **"Action this:"**.
   Its verdict must come from a real headless run, not a code reading — reasoning
   from code is the exact mistake that created this bug class.

**Then, independent — pull as capacity allows (no ordering constraint):**

- BL-340 (pri 4) role benchmarking slice 1 — his own hand-written spec, sliced.
- BL-341 (pri 5) epics as data + epic topics.
- BL-343 (pri 5) does dynamic routing actually save money? A **negative answer is
  a valid, valuable result** — four slices have already shipped on the assumption.
- BL-337 / BL-338 (pri 6) rule-violation observable; cost per ticket.
- BL-344 (pri 6) onboarding negotiation loop.
- BL-339 / BL-342 (pri 7) recert notify+deep-link; topic icons.

**A note on BL-343 and BL-344.** Both were remaining slices that existed ONLY as
prose inside tickets already marked `done`. Both epics therefore READ AS COMPLETE
while their key slice was missing. That is not a bookkeeping slip — it is the
blindness BL-341 exists to remove, and it is why BL-341 must state remaining
slices that have **no ticket yet**. An epic view that can only see tickets cannot
see the omission, which is the one thing it is needed for.

**Decisions the human made, not the swarm (do not re-litigate):**

- Front-desk starvation → restricted 2nd Operator + alarm. Options "interactive
  Operator drains the queue" and "alarm only" were offered and REJECTED.
- Recert via Telegram → notify + deep-link. Verdicts stay in the PWA. In-thread
  verdicts and "both" were offered and REJECTED. Do not build a verdict grammar.

**Still open: the direction itself.** No direction is in force. The two live
candidates remain cost-control and human-in-the-loop/front-desk-trust — and this
batch is heavy with the latter, because the human kept asking and nobody heard.
BL-101 still holds pending that choice.
