# BL-952 architect pass (round 2, post QA-bounce fix) — 2026-08-19

Reviewed: coder's `40c442ea6b` ("fix QA-bounced D1 - acceptance
subprocesses neutralize the runner's SWARMFORGE_ROLE"), merged by cleaner
in `869dca948a`. This is a re-entry after QA bounced the parcel my first
pass (`c2bd4a2aac`, see `BL-952-architect-pass-20260819.md`) approved and
forwarded; hardener and documenter had already added their own passes
(`df57ebec8`, `aeee53446`, both unaffected by the bounce) before QA found
D1 and reverted the bounced content out of the QA branch (`ccd94e3eb`,
per BL-490/BL-495).

## What QA bounced

`backlog/evidence/BL-952-qa-bounce-20260819.md`: acceptance scenario 10
("every consumer of the predicate gets the same answer") failed
deterministically only under `SWARMFORGE_ROLE=QA` — the one environment
this suite will always actually run in. Root cause: the scenario's
Consumer 2 subprocess spawn passed `{ ...process.env }` unmodified, so it
inherited the invoking QA session's own `SWARMFORGE_ROLE=QA`, which made
`check_pipeline_code_on_main.sh`'s own deliberate role-QA early exit fire
*before* the merge-head/bounce logic under test ever ran — a test-harness
defect (environment leakage into a simulated-caller subprocess), not a
production-code defect.

## Fix reviewed

`neutralizedEnv()` helper deletes `SWARMFORGE_ROLE` from the two
subprocess spawns that inherit it accidentally (`askPredicate`, and the
Consumer 2 guard spawn) before applying any per-call override.
`is_qa_ancestor.sh` itself never reads the var (confirmed: `grep -n
SWARMFORGE_ROLE swarmforge/scripts/is_qa_ancestor.sh` returns nothing),
which is exactly why only the second assertion in scenario 10 flipped, not
the first.

Cross-checked the commit message's claim about `sendFromQa` "keeping its
explicit SWARMFORGE_ROLE=QA, set deliberately over an allowlist" — that
function does not exist in this file (`bl952BouncedParcelNeverApprovedSteps.js`
has no `sendFromQa`); it is a different ticket's step file
(`bl950QaApprovalEvidenceCommitSteps.js:107`). Read that file directly:
confirmed the analogy holds — it uses `{ ...processEnvAllowlist(),
SWARMFORGE_ROLE: 'QA' }`, an explicit allowlist plus a deliberate override,
which is the established codebase convention for "role is the scenario's
subject" vs this bug's accidental raw `process.env` inheritance. The
cross-reference is accurate, just to a sibling file — not a defect, and
worth flagging only so a future reader isn't confused searching this file
for `sendFromQa`.

## Non-vacuity — independently reproduced, not taken on the commit message

1. Reverted `bl952BouncedParcelNeverApprovedSteps.js` in this worktree to
   documenter's pre-fix version (`git show aeee53446:...`) and ran the
   feature under `SWARMFORGE_ROLE=QA`: scenario 10 fails
   deterministically (`not ok 10`, 9/10 overall) — reproduces QA's exact
   bounce.
2. Restored the fix (`git status` clean after) and reran under
   `SWARMFORGE_ROLE=QA`: 10/10.
3. Reran with no role var set at all: 10/10 (after one earlier run hit the
   pre-existing `ENOTEMPTY` daemon-fixture teardown race documented in
   both the coder's and my own round-1 evidence — reran clean, confirming
   it is not a new regression).

## Dependency-rule gate (BL-259, hard gate)

This delta touches only `specs/pipeline/steps/bl952BouncedParcelNeverApprovedSteps.js`
— no `extension/src`/`media` file. `node extension/out/tools/dependency-gate.js`
against that file errors ("can't open") because it does not resolve under
`extension/` — confirmed, not assumed; the gate is not applicable to this
delta, consistent with round 1's finding.

## Co-change report (informational)

Against the same file alone: every co-change is at frequency 1 (`index.js`,
`handoffd.bb`, `is_qa_ancestor.sh`, `push_sweep_lib.bb`, both
`push_sweep_lib_*_runner.bb`) — all below the suspected-coupling threshold.
Nothing flagged.

## Rest of the parcel (hardener/documenter work, unaffected by the bounce)

`test_is_qa_ancestor_yaml_store.sh` (hardener's coverage-gap closure from
round 1) still passes clean at this commit (4/4 checks). Documentation
(`docs/reference/Specification.MD`, `swarmforge/handoff-protocol.md`,
`docs/reference/BL-632-commit-time-guard-refuses-pipeline-code-on-main.md`)
is unchanged since documenter's own pass, which QA had already reviewed
before bouncing on D1 alone — no re-review needed beyond confirming the D1
fix commit did not touch them (confirmed via `git show 40c442ea6b --stat`).

## Verdict

COMPLIANT. QA's D1 bounce is correctly and non-vacuously fixed. No new
architecture violation, no new correctness defect. Forwarding to hardener.

By architect.
