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

1. **BL-322** — `human-requested`, asked for twice. Topic opens with a bare
   `TaskStarted` instead of a summary. Pull it NEXT; it is orthogonal to BL-324
   (front-desk render path vs role lifecycle), so it does not have to wait.
2. BL-324 — in flight; finish it. Amended three times off review findings
   (TOCTOU park race, warm core, lookahead) and it KILLS PANES, so it must not
   land until QA has driven a real park/unpark cycle against a live swarm, per
   its own e2e procedure.
3. BL-101 — headless secondary swarms. Holds until the human names the next
   direction; it is the largest of the cost-themed candidates and should not be
   pulled on inertia.
