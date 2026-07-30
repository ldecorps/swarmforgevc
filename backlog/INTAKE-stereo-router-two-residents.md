# Raw intake — Stereo router: two residents so one long stage cannot freeze the line

Status: new intake, not minted. Capture only (human via Let's Talk 2026-07-30).

Trigger
- Human watching mono-router: hardener (or any single resident persona) ran ~50+ minutes on mutation / Gherkin work.
- Meanwhile the whole workflow waited — only one resident path, so one slow stage pushes everything back by that wall clock.
- Idea floated as “stereo router”: roughly **two resident instances** working at once.

## Goal

Keep a lean pack (not full classic seven seats), but allow **two concurrent resident lanes** so a long hardener (or other) stage on ticket A does not idle the swarm for ticket B / other parcels.

## Problem today

- Mono-router 2-pack = coordinator + **one** rotating resident.
- That resident is one role at a time (`mono-router-active-role`).
- A one-hour mutation / Stryker / Gherkin run occupies the only lane.
- Cleaner / architect / next ticket / other mail sits until that persona finishes and rotates.
- Babysitter correctly reports “healthy / working” — so this is not a stuck-agent outage; it is **serial capacity**.

## Requested shape (stereo)

- Coordinator stays one (bookkeeping / promote / route).
- **Two residents** (two panes / two agent sessions), each able to hold a different role persona or different ticket parcel at the same time.
- Example: Resident 1 = hardener mutating ticket X for an hour; Resident 2 = cleaner or coder advancing ticket Y (or the next stage that does not conflict).
- When one resident is deep in a long tool run, the other still drains actionable mail.

## Why not “just use classic pack”

- Classic pack already parallelizes by giving every role its own seat — higher cost, more panes, more provider load.
- Stereo is the middle: **2× resident throughput** without standing up the full role zoo.
- Human framing is capacity under mono-router economics, not a return to full classic by default.

## Open design questions (must answer before mint)

1) **Isolation:** two worktrees / two git lines, or one worktree with strict non-overlapping file claims?
2) **Routing:** how does the router pick which resident takes which parcel (priority, role affinity, same-ticket forbidden)?
3) **Same ticket:** can both residents ever touch the same BL-### at once, or hard rule one ticket → one resident?
4) **Merge / QA:** who owns merge-up when two residents finish different tickets near the same time?
5) **Pack name / conf:** new `stereo-router` pack vs flag on mono-router (`residents=2`)?
6) **Ambulance / depth cap:** how do exclusive modes and `active_backlog_max_depth` interact with two lanes?
7) **Observability:** board must show two resident roles / two dwell timers so “51 minutes on hardener” does not look like the whole swarm is stuck when the other lane is fine.

## Acceptance shape to refine

1) With stereo live, a resident in a long hardener mutation does not prevent the second resident from dequeuing and working a different actionable parcel.
2) Coordinator still enforces backlog depth / promote rules; two residents do not double-promote past the cap without an explicit policy.
3) No silent double-edit of the same ticket by both residents (policy + detection).
4) Pack is selectable (conf), not forced on every swarm.
5) Cost / pane count documented vs mono-router and classic.

## Related

- Mono-router single-resident dwell / stranded detection (e.g. BL-685) — detects wrong *home role*, does not add a second lane.
- Full classic pack — maximum parallelism, different cost trade.
- Hardener long Stryker/Gherkin runs — expected slow tool work, not a crash; stereo is capacity, not a mutation-speed fix.

## Non-goals (this capture)

- Implementing stereo in this pass.
- Speeding up Gherkin mutation itself (separate concern).
- Replacing classic pack.
