# BL-977 — pre-QA ancestry block adjudicated as a BL-972 false positive

**Recorded by**: documenter, 2026-08-20, at the documenter→QA forward.
**Audience**: QA at BL-977's gate.

## The block

`swarm_handoff.sh` refused the forward (exit 2), after a first stranded
candidate (`5f77b02f3a`, a genuine BL-977 fixture-leak fix — see below) was
merged in and cleared:

```
PRE_QA_GATE_FAIL ancestry BL-977 20e315ceb1 stranded on swarm/coder
PRE_QA_GATE_FAIL ancestry BL-977 c3218df421 stranded on swarmforge-architect
PRE_QA_GATE_FAIL ancestry BL-977 20e315ceb1 stranded on swarmforge-architect
PRE_QA_GATE_FAIL ancestry BL-977 20e315ceb1 stranded on swarmforge-cleaner
```

Two candidates, both BL-968 commits.

## Why they are false positives

`20e315ceb1` is BL-968's own landing commit (materialized-tree step-registry
loadability fix). `c3218df421` is the straight revert of that same commit
(`git revert`, subject "Revert \"BL-968: ...\""). Neither is BL-977 work; both
merely **name** BL-977 in passing prose, inside a much longer commit body:

> "...tempDirTrapGuard: the BL-977 property runner's missing cleanup hook,
> fixed in the preceding commit, runner re-run ALL PROPERTIES HOLD exit 0..."

That sentence is BL-968's own full-npm-test summary noting that a *different*,
already-merged commit (`5f77b02f3a`, the actual BL-977 fixture-leak fix, its
own commit) fixed a guard trip found while running BL-968's suite. It is a
cross-reference, not carried work. The gate's candidacy filter is a
subject/body token match, so any commit whose prose mentions "BL-977" becomes
a dropped-work candidate — the exact BL-972 failure mode already adjudicated
once today for BL-967 (`backlog/evidence/BL-967-pre-qa-gate-false-positive-
20260820.md`).

**Path evidence — neither commit touches any BL-977 file:**

| touches | `20e315ceb1` | `c3218df421` | in BL-977's parcel? |
|---|---|---|---|
| `backlog/evidence/BL-968-blind-window-and-guard-20260820.md` | yes | yes (revert) | no |
| `extension/test/bl968MaterializedGuardSensitivity.property.test.js` | yes | yes (revert) | no |
| `extension/test/bl968StepRegistryMaterializedTreeGuard.test.js` | yes | yes (revert) | no |
| `extension/test/helpers/materializedRegistryGuard.js` | yes | yes (revert) | no |
| `specs/pipeline/steps/bl936Bl805PropertyLaneExercisesTheParcelGateSteps.js` | yes | yes (revert) | no |
| `specs/pipeline/steps/bl968StepRegistryMaterializedTreeSteps.js` | yes | yes (revert) | no |
| `specs/pipeline/steps/devHostLauncherSteps.js` | yes | yes (revert) | no |
| `specs/pipeline/steps/headlessDarkEmitterAuditSteps.js` | yes | yes (revert) | no |
| `specs/pipeline/steps/index.js` | yes | yes (revert) | **yes** — the append-only step registry, touched by every ticket |
| `specs/pipeline/steps/routingBreakEvenSteps.js` | yes | yes (revert) | no |
| `specs/pipeline/steps/standingRuleViolationsSteps.js` | yes | yes (revert) | no |

Neither touches `swarmforge/scripts/daemon_cycle_guard_lib.bb`,
`swarmforge/scripts/handoffd_supervisor.bb`, `swarmforge/scripts/handoffd.bb`,
`swarmforge/scripts/test/bl977_supervisor_progress_property_runner.bb`, or
`specs/pipeline/steps/bl977SupervisorProgressSteps.js` — every file BL-977's
own parcel actually changed. There is no BL-977 content in either to drop.

## Distinguish from the genuine stranded commit already merged

Before these two, the gate correctly flagged `5f77b02f3a` ("BL-977
follow-up: the property runner's fixture root is reclaimed on EVERY exit
path") as stranded on `swarmforge-cleaner`/`swarmforge-architect` and absent
from `swarmforge-hardender`'s tip (`753047700`). That one WAS real, isolated
BL-977 work (one file, 6 lines, the `bl977_supervisor_progress_property_
runner.bb` fixture-leak shutdown-hook fix) that never reached the hardener→
documenter lineage — genuine dropped-work evidence, not a text match. It was
merged into this worktree (documenter commit `5a759e2bd1`) rather than
abandoned. Only the two BL-968-prose-mention commits below are being
declared abandoned; the real fix is landed, not suppressed.

## The governing rule

`engineering.prompt` (landed 2026-08-20):

> A gate blocks on dropped-work EVIDENCE (touched paths/diff content), never on
> a ticket id merely named in a commit subject (4 QA blocks in one day;
> BL-972).

BL-972 is minted for the enforcement fix and is `paused` pending human
approval; the coordinator's hold note records that the accepted rule is
binding while enforcement is unbuilt. Under that rule this block is invalid,
and the path evidence above is exactly the evidence the rule asks for.

## What was done

`20e315ceb1` and `c3218df421` are declared in BL-977's `abandoned_commits` —
the only declared escape the gate offers (BL-972 names it as the working
workaround) — in **flow style** (`abandoned_commits: ["...", "..."]`), with
the rationale in a separate `abandoned_commits_rationale:` field rather than
inline, because a comment line inside a block list voids the field and reads
to the gate as absent (BL-935's own two-commit fix).

Read that declaration as *suppressing two known-false candidates*, **not** as
a claim that BL-977 work was dropped. Both are live, correct BL-968 work (one
commit and its own revert) in flight on their own parcel; nothing about
either should be reverted or re-merged on BL-977's account, and QA needs no
action beyond not blocking on them.

— By documenter (BL-977), 2026-08-20.
