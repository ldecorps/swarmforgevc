# Kanban Steering Policy (BL-138)

The specifier owns this file. It declares ONE active strategic direction per
cycle, the classification of every backlog ticket against that direction, the
pull/WIP rules the coordinator applies when promoting work, and the review
cadence that is the only sanctioned way to change direction.

## Current direction

- **Direction:** `reliability-first`
- **Declared:** 2026-07-06
- **Horizon:** through 2026-07-20 (two weekly review intervals)
- **Rationale:** The last cycle burned significant capacity on pipeline
  failures rather than product progress: QA compile-failure bounces across
  five parcels, recurring phantom-revert diffs (BL-126), a chaser that
  over-chases busy agents (BL-135), tracer bullets going blind mid-pipeline
  (BL-136), and panes stuck with unsubmitted input (BL-137). The competing
  themes (phone app UX, multi-agent abstraction, concurrent swarms) all build
  on this substrate; investing in them while the substrate loses work is
  rework waiting to happen. Harden the pipeline first.
- **Target metric:** ≥ 80% of parcels submitted to QA pass on first attempt
  during the horizon, AND the count of open BUG-titled tickets decreases at
  each weekly review.

## Classification

Every ticket in `backlog/active/` and `backlog/paused/` carries a
`direction:` field with one of:

- `aligned` — advances the current direction; eligible for normal pull.
- `non-aligned` — valid work for a different theme; stays paused this cycle.
- `expedite` — defect or operational blocker; eligible for pull regardless
  of direction (bugs-first standing order is unchanged).

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

## First prioritized slice (next pulls under reliability-first)

In pull order (expedite/bugs first, then aligned by priority; orthogonality
still applies at promotion time):

1. BL-137 — stuck unsubmitted pane cannot be recovered (stalls the swarm)
2. BL-135 — chaser over-chases a busy agent
3. BL-126 — phantom-revert diffs root cause
4. BL-136 — tracer hops unlogged past specifier (pipeline is blind)
5. BL-125 — paneTailerScrollback test hang blocks hardening runs
6. BL-107 — coordinator bounce-all cannot work end to end
7. BL-127 — backlog row chip stage color (BUG, low; color semantics defer to BL-139)
8. BL-131 — eliminate real timers in the test suite
9. BL-115 — bounce watcher resilience
10. BL-116 — launch PATH probe + persisted launch output

Note: BL-133/BL-134 (trace-hop resolveTracesDir + PHASE_MAP) may already be
resolved by the cleaner's infrastructure fix 7e97fb3d9b now in the pipeline;
verify and close rather than re-pull.

Grandfathered in flight (finish normally): BL-108, BL-139 (non-aligned but
already pulled), BL-140, BL-141, BL-138 (this ticket).
