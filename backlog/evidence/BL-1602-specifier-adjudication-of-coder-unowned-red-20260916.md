# Coder unowned-red note (BL-1192 acceptance 5/9 red) - specifier adjudication and census (2026-09-16 16:50Z)

Inbound: `00_20260916T162707Z_001995_from_coder_to_specifier` (recipients specifier, coordinator), "unowned-red: BL-1192-pre-handoff-task-scope-gate.feature 5/9 red, AUDIT_REQUIRED".

## Reproduced on main at 968338296b

`bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1192-pre-handoff-task-scope-gate.feature` -> exit 1, five scenarios failed at "Then the send is accepted": the driver (`specs/pipeline/steps/lib/bl1192TaskScopeGateCli.sh`) invokes the real `swarm_handoff.bb` once and reports `{"exitCode":1,"delivered":false,"stderr":"... AUDIT_REQUIRED\nHANDOFF_NOT_QUEUED ..."}`. BL-1529 (7115aa7595, 2026-09-12) made the first valid invocation of a git_handoff draft a challenge; the driver never answers it.

## Census (the population, counted, not assumed)

Grep: every file under `specs/pipeline/steps` and `specs/pipeline/steps/lib` that executes `swarm_handoff.bb|.sh` (a non-comment line with spawnSync/execFileSync/bash/bb/\$SWARM_HANDOFF), contains a `git_handoff` draft, and contains none of `AUDIT_REQUIRED|queue-git-handoff|HANDOFF_NOT_QUEUED`. Eleven drivers. Each feature run with the real runner, 240 s timeout:

```
bl1001DifficultyAwareSeatRouting | BL-1001-difficulty-aware-coder-seat-routing.feature | exit=1 failed_steps=6 audit_hits=6
bl1004ReworkClaim | BL-1004-a-rework-is-claimed-only-by-a-seat-that-can-wor | exit=1 failed_steps=5 audit_hits=5
bl1167SameModelSeatRouting | BL-1167-same-model-coder-seats-bypass-tier-routing.feat | exit=1 failed_steps=3 audit_hits=3
bl1185WorkNoteMissingTaskHeader | BL-1185-work-note-missing-task-header-defers-hard-seat. | exit=1 failed_steps=1 audit_hits=0
bl1317AdaptEffort | BL-1317-adapt-tier-effort-from-outcome-signals.feature | exit=1 failed_steps=3 audit_hits=3
bl606RequiredStagesRouting | BL-606-specifier-declared-required-stages-routing.featu | exit=1 failed_steps=13 audit_hits=13
bl623RoutingSkipTrail | BL-623-routing-skip-trail-records-actual-hop.feature | exit=1 failed_steps=6 audit_hits=6
bl983StageQueue | BL-983-stage-mailbox-delivers-to-one-idle-seat.feature | exit=1 failed_steps=5 audit_hits=5
corruptHandoffNeverDispatched | BL-365-corrupt-handoff-never-dispatched.feature | exit=0 failed_steps=0 audit_hits=0
bl1192TaskScopeGate | BL-1192-pre-handoff-task-scope-gate.feature | exit=1 failed_steps=5 audit_hits=5
bl1276AcceptanceExemption | BL-1276-a-tickets-own-declared-paths-are-not-foreign.fe | exit=1 failed_steps=2 audit_hits=2
```

Ten red, 49 failing steps. BL-365 green: its corrupt draft is refused before the audit. bl1185's one failure asserts the claim (`out=NO_TASK`) rather than the send, so no AUDIT_REQUIRED text surfaces; same class by structure, to be confirmed by the sweep. BL-1530 swept shell tests, BL-1541 the bb runners (`backlog/evidence/BL-1538-BL-1541-specifier-unowned-red-census-20260911.md`); acceptance drivers were in neither population. No evidence file between 2026-09-12 and today records any of these ten red: nothing runs the acceptance corpus routinely, so ten shipped contracts gated nothing for four days.

## Outcome

Minted **BL-1602** (`type: defect`, `severity: high`, epic code-quality-gates): one shared JavaScript two-call helper, the nine JavaScript drivers through it, the two bash drivers on the bl1240 idiom, the population pinned by name (BL-1445), no feature file touched (invariant 2). Ten register rows (lane acceptance, first_seen 2026-09-16, the first recording; the reds date from 2026-09-12). Register now 16 rows, all owned; BL-1429's throttle stays engaged by design. Coordinator sent the paused-ready note; coder the owner note.

## Recorded, not ticketed

- Nothing runs the full acceptance corpus on a cadence; QA runs each parcel's own feature. A ten-feature red went unseen for four days. Candidate for the lean pass: a nightly corpus run whose reds become unowned-red notes.
- Eight of the specifier's own tickets from 2026-09-13 to 2026-09-16 cited `swarmforge/scripts/run_acceptance.sh` in their e2e steps; the runner is `specs/pipeline/scripts/run_acceptance.sh`. Corrected in this commit (nine YAMLs, bookkeeping only).
