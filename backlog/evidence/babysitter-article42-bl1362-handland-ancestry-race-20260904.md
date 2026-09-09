# Article 4.2 false positive — BL-1362 QA hand-land ancestry race (2026-09-04)

Operator run, event `BABYSITTER_ESCALATION`
subject `pipeline-code-on-main-0dab987fac1284482cef7771c201a7b929877d1e`.
All times UTC (git author dates below CONVERTED from the host's +01:00, not relabelled).

## Verdict: FALSE POSITIVE — no revert, no ticket, no nudge.

## The commit

- `0dab987fac1284482cef7771c201a7b929877d1e`
  "BL-1362: tip-pure hand-built replay onto origin/main (BL-1241 remedy)"
- Author `t <t@t>`, **17:36:37Z**. Single parent `485fd43bce` (itself the BL-1358
  hand-land recorded in `babysitter-article42-bl1358-handland-ancestry-race-20260904.md`).
- Trailer: **`By QA.`** — this is QA's own hand-built replay, the BL-1376 recipe.
- Ticket `backlog/active/BL-1362-a-review-pass-records-its-evidence-by-tool.yaml`.

## The swarm's own predicate now clears it

- `swarmforge/scripts/is_qa_ancestor.sh 0dab987fac…` → **exit 0** (IS a QA ancestor).
- `git merge-base --is-ancestor 0dab987fac swarmforge-QA` → **YES**.
- The coordinator independently reached the same verdict in its own pane
  ("is_qa_ancestor.sh exit 1, origin/main only, By QA. trailer, tip-pure
  hand-build pattern. No revert, no new ticket needed") and went back to idle.

## Root cause: the SAME ~6-minute ancestry race as BL-1358, 42 minutes later

| time (UTC) | event |
|---|---|
| 17:36:37Z | QA pushes the tip-pure replay to `origin/main` (`0dab987fac`) |
| ~17:42:55Z | babysitter sweep fires Article 4.2 — QA branch does **not** yet contain it → `is_qa_ancestor.sh` exit 1 |
| 17:43:29Z | QA merges `origin/main` back and commits `91c405dcc5` "BL-1362: land-success evidence" → ancestry closes |
| 17:44Z | operator re-checks: `is_qa_ancestor.sh` exit **0** |

Article 4.2's predicate is **ancestry-only**. On the QA hand-land route the push
to `origin/main` necessarily precedes QA's merge-back, so there is a window of
several minutes in which every such land is indistinguishable from pipeline code
landing outside QA. The escalation here fired **~40 seconds before** the
merge-back that would have silenced it.

## Why this occurrence matters

This is the **second** instance of this exact race today (BL-1358 at 16:54:32Z →
17:02:59Z, an ~8min window; BL-1362 at 17:36:37Z → 17:43:29Z, an ~6min window).
It is not a one-off: it now reproduces on every ticket landed by the BL-1241
tip-pure hand-build remedy. The standing-false-positive notes
(`babysitter-article42-expedite-lane-land-false-positive-20260904.md`,
`babysitter-article42-qa-handland-on-main-false-positive-20260904.md`) describe
the class; this pair pins the mechanism to a *timing* window rather than a
permanent mis-attribution, so the fix is a settle/grace period (or a
`By QA.`-trailer check) before Article 4.2 escalates — not a change to the
hand-land route.

## Operator actions

Diagnosis and this record only. No revert, no nudge (QA was mid-work sending its
merge-up notes; the coordinator had already resolved it and was correctly idle),
no commit/merge/push to `main`, no code edited, no backlog state changed.
