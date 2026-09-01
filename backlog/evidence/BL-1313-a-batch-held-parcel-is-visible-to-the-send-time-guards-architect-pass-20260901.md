# BL-1313: architect review — pass — 2026-09-01

Reviewed commit `d5810a475d` (merge of cleaner's `4c24a42b25`, coder's rework
commit `5008be4f0c` underneath) against
`backlog/paused/BL-1313-a-batch-held-parcel-is-visible-to-the-send-time-guards.yaml`.
This is the rework of the coder fix bounced in
`BL-1313-a-batch-held-parcel-is-visible-to-the-send-time-guards-architect-bounce-20260901.md`
(D1: vacuous property test).

## Checklist run

- Dependency gate (`node extension/out/tools/dependency-gate.js`, no-args
  full-repo scan): **PASSED, no forbidden edges.**
- Co-change (`node extension/out/tools/co-change-report.js` over all 9
  BL-1313-owned changed files): only expected coupling among the parcel's own
  files (3 co-changes each, from the 3 BL-1313 commits touching them
  together); the two unrelated carried-forward files
  (`backlog/debt/BL-1040-...yaml`, `backlog/evidence/BL-1303-cleaner-noop-...md`)
  were restored by my own prior commit `a37cd54e08` after a bounce-revert
  swept them — already accounted for, not new.
- Correctness read of the three diff hunks (`duplicate_chain_guard_lib.bb`,
  `handoff_lib.bb`, `swarm_handoff.bb` vs pre-BL-1313 base
  `913612d87a`): unchanged from my prior pass — both call-site swaps still
  scoped exactly right, matches ruled option 1 (one shared reader, no
  consolidation of the six hand-rolled walkers).
- Wiring: `bl1313BatchGuardVisibilitySteps.js` registered in
  `specs/pipeline/steps/index.js:914`; both new standing tests
  (`bl1313_handoff_files_with_batches_test_runner.bb`,
  `test_swarm_handoff_inbound_non_forwarding_batch.sh`) registered in
  `suite-manifest.tsv`.
- Acceptance: ran the feature myself — 7/7 scenarios pass, real
  `swarm_handoff.bb` CLI via subprocess.
- Shell fixture: ran `test_swarm_handoff_inbound_non_forwarding_batch.sh`
  myself — PASS.
- bb unit runner: ran `bl1313_handoff_files_with_batches_test_runner.bb`
  myself — ALL TESTS PASSED.

## D1 remediation verified (property test now non-vacuous)

Re-ran the same empirical check from my prior bounce: replaced the real
`handoff-files-with-batches` in `swarmforge/scripts/handoff_lib.bb` with
`(defn handoff-files-with-batches [dir] (handoff-files dir))` (silently
ignoring batch dirs — the exact defect this ticket fixes), then:

- `npx vitest run --config vitest.properties.config.mjs test/bl1313BatchGuardVisibilityInvariants.property.test.js`
  (run from `extension/`) → **both invariant tests correctly FAILED**
  (Invariant 1 and Invariant 2), naming the exact break
  (`blocked=false but forwardable-holder=true`). Confirms the rewritten test
  drives the real committed file — no redefinition, no hand-copy.

Restored the original file after (verified clean, no diff).

The rewrite replaced the prior `PATCH_EVAL` redefinition with: copying the
full `load-file` closure (11 files, verified exhaustively — traced every
leaf's own `load-file` calls, none reference a twelfth file) into an
isolated shared tmp dir once per test file, and pointing every subprocess's
`load-file` at the copies. Also fixed the two vacuities my prior bounce did
not need to name (they were masked by the first): the fixture layout now
matches `mailbox-dir`'s real resolution (`roles.tsv` rows +
`<worktree>/.swarmforge/handoffs/inbox/in_process[/batch_*]`, verified
against `handoff_lib.bb`'s `mailbox-base-dir`/`mailbox-dir`), and output
parsing now reads `println` lines instead of comparing against a `prn`-quoted
string that could never match.

Generator reachability floor (BL-654) present and green: flat/batch,
all three marker states, both holder roles, same-ticket mixed placement,
same-ticket mixed markers, deep (>=8 parcel) populations all asserted
reachable before the two invariant properties run.

## Decision

No defect found. Architecture compliant, both declared invariants now
non-vacuously encoded and verified against the real committed code, full
checklist green. Forwarding to hardender.
