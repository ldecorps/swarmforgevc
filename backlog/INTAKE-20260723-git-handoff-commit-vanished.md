# Swarm-surfaced defect — a validated git_handoff's commit no longer existed by delivery time

**From:** coordinator, surfaced by documenter
**Date:** 2026-07-23
**Authority:** swarm-surfaced, high severity — flag for human awareness

## What happened (facts, verified directly)

A `git_handoff` from **QA to documenter**, task `BL-910`, commit `acbdc07f0e`:

```
id: 20260723T213022Z_000775_from_QA
from: QA
to: documenter
type: git_handoff
role: QA
commit: acbdc07f0e
created_at: 2026-07-23T21:30:22.548240809Z
enqueued_at: 2026-07-23T21:30:24.231496932Z
task: BL-910
dequeued_at: 2026-07-23T22:22:12.174931412Z
completed_at: 2026-07-23T22:22:43.894237207Z
```

- **Went through the real send path**, not a direct mailbox write:
  `.swarmforge/daemon/handoffd.log:22993-22994` shows the daemon delivering it
  from `QA`'s outbox to documenter's `inbox/new/` at 21:30:24Z, matching
  `.worktrees/QA/.swarmforge/handoffs/sent/00_20260723T213022Z_000775_from_QA_to_documenter.handoff`.
  `swarm_handoff.bb`'s `canonical-commit` (~line 173-186) requires a `commit`
  header to resolve to EXACTLY ONE real git object of type `commit`
  (`git rev-parse --disambiguate=<commit>` + `git cat-file -t`) before a send
  is even accepted — so `acbdc07f0e` almost certainly existed as a real
  commit object in the shared repo at 21:30:22Z send time.
- **By the time documenter dequeued it, ~52 minutes later (22:22:12Z),
  `acbdc07f0e` no longer resolves to anything**: `git cat-file -e acbdc07f0e`
  fails with "Not a valid object name" from the main checkout.
- **No ticket `BL-910` exists anywhere** in `backlog/` (active, paused, done,
  or hold) — current ticket numbering is in the ~560-610 range, so `BL-910` is
  also anomalous on its own, independent of the missing commit.
- **QA's own reflog shows no activity in that window at all** — a large gap
  from `0c3704d29` at 17:16:55Z straight to `67ccf421e` at 23:31:42Z, nothing
  in between. Root cause is NOT conclusively established — filing this as a
  confirmed symptom for investigation, not asserting a specific mechanism.

**Documenter handled this correctly**: it did not attempt to process the
malformed parcel, marked it completed without action (equivalent to a
no-op per the constitution's No-Op Rule — there was no real work to forward),
flagged it to the coordinator, and moved on to its actual queued work
(BL-532). No swarm behavior needs correcting on documenter's side.

## Why this matters

The `canonical-commit` check is send-time-only. If a commit can become
unreachable between send and delivery — whatever the exact mechanism turns
out to be (worktree reset, rebase, prune, or something else) — a role can
receive a `git_handoff` it is structurally unable to process, with no
documented recovery path (`merge_and_process` on a non-existent commit simply
fails). Given this project's shared-checkout, multi-worktree, frequently-reset
model (hard-reset broadcasts, phantom-revert history, stash contamination all
already on record), this is plausibly not a one-off.

## Open questions for whoever investigates

- Can the actual mechanism be reproduced or traced further (e.g. via
  `.swarmforge/daemon/handoffd.log` around 21:30-22:22 for any reset/gc/prune
  signal, or asking whichever session was QA around 21:30 what it was doing)?
- Should the receiving role's `merge_and_process` re-validate the commit and,
  on failure, bounce/report rather than silently fail or hang?
- Is `BL-910`'s nonexistence as a ticket a separate symptom of the same
  incident (e.g. a QA session hallucinating both a task name and a commit
  hash that happened to pass send-time validation by coincidence — unlikely
  but worth ruling out) or unrelated?

## Proposed ticket

Specifier: drain this intake into a properly-scoped defect ticket in
`backlog/paused/`, severity high given it represents a structurally
unrecoverable parcel with an unclear root cause. `human_approval` required
before promotion given the investigative/unclear nature.
