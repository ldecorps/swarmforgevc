# BL-1019 — hardener bounce-refix pass, 20260824

## Inbound

Merged architect `86bf31f0e3` (QA bounce hitchhiker clear) into
`swarmforge-hardender`.

## Scope

BL-1019 status/session liveness unchanged. Tip clears hitchhiking BL-1101
empty-array expand under bash 3.2 `set -u` via length-guards before
`"${SURVIVORS[@]}"` / `"${SKIPPED[@]}"` in `expedite_mutation_sweep.sh`.

## Host / cooldown

| File | Decision |
|---|---|
| `swarm_status_lib.bb` | **run** |
| `expedite_mutation_sweep.sh` | **skip-cooldown** |

Surgical on hitchhiker delta; BL-1019 Gherkin soft skipped (prior stamp).

## Verification

- BL-1019 acceptance 5/5; unit ok
- BL-1101 hitchhiker acceptance 6/6

## Hand-authored surgical (length-guards)

| Mutant | Result |
|---|---|
| unguard SURVIVORS expand | killed |
| unguard SKIPPED expand | killed |
| drop fail=1 from SURVIVORS block | killed |

Tightened APS regex so SURVIVORS `fail=1` cannot be satisfied by the
SKIPPED block’s `fail=1` (non-greedy cross-`fi` false match).

Survivors: 0.

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1019-swarm-status-agrees-with-has-session`.

By hardender.
