# Article 4.2 escalation — BL-1448 own-paths restore commit has no land-approval row

- **Escalation subject:** `pipeline-code-on-main-de0bde5c610ec8fc8c52be9591a04d0c8121490f`
- **Adjudicated by:** Operator, 2026-09-07T09:41Z (UTC; host is UTC+1)
- **Verdict:** FALSE POSITIVE IN SUBSTANCE / TRUE GAP IN RECORDS — the code is
  QA-approved byte-for-byte; only the land-approval row for the *second* commit
  is missing. Close-out is QA's to record (BL-1405). Not a waive case.

## What fired

`de0bde5c61 "BL-1448: restore own-paths the automated replay dropped
(BL-1446/BL-1424 shape)"` (authored `By QA.`, 2026-09-07T09:35:22Z) touches
`specs/pipeline/steps/bl1448DriftGuardSuiteOwnsItsAllowlistSteps.js`, so the
sweep's pipeline-code predicate matched, and
`is_qa_ancestor.sh de0bde5c610ec8fc8c52be9591a04d0c8121490f` exits **1**.

## Why the predicate says no

BL-1448 landed as the known two-commit hand-built shape:

| commit | what | `is_qa_ancestor.sh` |
|---|---|---|
| `6c8caf27fb` | QA-approved source tip | **0** (ancestor of `swarmforge-QA`, no bounce) |
| `31cae8ba4d` | tip-pure replay onto `origin/main` | **0** — land-approval row exists: `{"at":"2026-09-07T09:29:49.101610584Z","ticket":"BL-1448","commit":"31cae8ba4d","source":"6c8caf27fb"}` in `.swarmforge/land-approvals/2026-09.jsonl` |
| `de0bde5c61` | restore of own-paths the replay dropped | **1** — **no row naming it** |

The replay (BL-1446/BL-1424 root-cause class, both already active) dropped the
ticket's own paths; QA hand-restored them in a second commit. That second commit
is not an ancestor of `swarmforge-QA` and carries no land-approval row of its
own, so the ancestry-only predicate reads it as unapproved code on `main`.

## Content verification (operator, independent)

Every one of the 9 paths in `de0bde5c61` is **byte-identical** (same blob SHA)
to `6c8caf27fb`'s copy — i.e. the commit introduces nothing that was not already
QA-approved:

```
SAME  backlog/active/BL-1448-the-drift-guard-suite-owns-its-allowlist.yaml
SAME  backlog/evidence/BL-1448-architect-20260907.md
SAME  backlog/evidence/BL-1448-architect-bounce-20260907.md
SAME  backlog/evidence/BL-1448-cleaner-20260907.md
SAME  backlog/evidence/BL-1448-coder-pass-20260906.md
SAME  backlog/evidence/BL-1448-hardender-20260907.md
SAME  specs/features/BL-1448-the-drift-guard-suite-owns-its-allowlist.feature
SAME  specs/pipeline/steps/bl1448DriftGuardSuiteOwnsItsAllowlistSteps.js
SAME  swarmforge/scripts/test/test_property_suite_drift_guard.sh
```

## The close-out that is missing (QA's to run — not the operator's, not a waive)

```
./swarmforge/scripts/record_land_approval.bb "$(pwd)" \
  de0bde5c610ec8fc8c52be9591a04d0c8121490f 6c8caf27fb BL-1448
```

It must then print `VERDICT de0bde5c61 approved`. Until that row exists the
escalation re-fires on every sweep with the same subject. A coordinator
`babysitter_waive.bb --record` is the WRONG instrument here: this is a hand-built
QA land, so the land-approval row is the recorded close-out (and BL-1404's waive
path does not silence this channel until it lands anyway).

## State at adjudication time

Swarm healthy: 9/9 windows, 9/9 role processes (up ~1h31m), handoffd heartbeat
`2026-09-07T09:40:52Z` (current), `main` HEAD 5 min old, backlog 9 active /
84 paused. QA was mid-loop on this very close-out (pane: "write the QA evidence
file documenting the full verification and the hand-fix incident", spinner
22m) — so a mailbox note was queued rather than a pane interrupt.

## Operator actions

- ONE mailbox note to QA pointing at this file (handoffd delivery, no tmux wake).
- This write-up, so a repeat delivery of the same subject is not re-derived.
- No code edited, no commit to `main`, no waive, no promote/close, no respawn.
