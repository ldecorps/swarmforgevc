# BL-1242 — QA merge-up would delete four tickets' rebuilt work (verified)

**Reported by:** coder, note `00_20260828T112944Z_001379`, priority 00 —
"coder: merge df9899feb deletes 4 tickets' work, see BL-1227 commit 706ac5c3d".
**Verified by:** specifier, 2026-08-28, read-only. Nothing was merged.

## Reproduction (no working tree touched)

```
git merge-tree --write-tree swarmforge-coder df9899feb   -> 561f32f8f6812d749c10c4611d2aec9616640b0d
git diff --diff-filter=D --name-only swarmforge-coder 561f32f8f6
```

Seven paths removed, spanning four in-flight tickets:

| path | ticket |
|---|---|
| `backlog/active/BL-1192-pre-handoff-task-scope-gate.yaml` | BL-1192 (BL-901 covers this one) |
| `specs/pipeline/steps/bl1192TaskScopeGateSteps.js` | BL-1192 |
| `specs/pipeline/steps/lib/bl1192TaskScopeGateCli.sh` | BL-1192 |
| `swarmforge/scripts/test/task_scope_gate_lib_test_runner.bb` | BL-1192 |
| `specs/pipeline/steps/bl1207AbandonedLockLivenessSteps.js` | BL-1207 |
| `specs/pipeline/steps/bl1216DuplicateIdLiveCopyContentVerdictSteps.js` | BL-1216 |
| `extension/src/tools/recovery-filter-check.ts` | BL-1211 |

`swarmforge/scripts/task_scope_gate_lib.bb` SURVIVES while its CLI and test
runner do not — the branch would be left half-broken, not cleanly reverted.

## Blast radius at time of check

`df9899feb` was already an ancestor of `main`, `swarmforge-QA`,
`swarmforge-architect`, `swarmforge-cleaner`, `swarmforge-documenter` and
`swarmforge-hardender` — every worktree role except the coder had already
merged it. None lost anything: they did not hold the rebuilt work.

The cleaner is the interesting case and it is NOT damage. Its merge
`5bccbfccd` says so explicitly — "pick up QA bounce reverts for
BL-1192/1207/1216" — a deliberate propagation, after which it re-merged the
coder rebuilds (`7a3773c71`, `5d97948f4`, `8f125f661`, `03b18f682`). Five of
the seven paths are present on it today. That is the remedy working by hand.

## Cause, stated carefully

The coder attributed the deletions to git rename detection over criss-cross
merge bases. That is not asserted here: the same deletions are fully explained
by QA's BL-490/BL-495 bounce reverts for BL-1192/1201/1211/1216 propagating
through main into a branch that has since rebuilt them. The two explanations
do not change the remedy or the guard, so the ticket does not pick one.

## Why it needs a guard

The coder caught this only by applying engineering.prompt Guardrails ("diff
every merge against BOTH parents and read the deletions", BL-571/BL-958) by
hand. The workflow.prompt merge-up rule does not invoke that guardrail, and
`check_ticket_deletion.sh` (BL-901) — which refuses exactly this shape, with
exactly the right escape — covers `backlog/**/*.yaml` only. Six of the seven
paths are uncovered.

## Hook probe (settles the implementation site)

Throwaway repo, all three hooks echoing, `git merge --no-ff`:

```
HOOK-FIRED: pre-merge-commit
HOOK-FIRED: commit-msg
```

`pre-commit` does NOT fire on a merge. Since the message-naming escape needs
the finalized message, the enforcing call belongs in `commit-msg` — the same
place and the same reason as BL-901.
