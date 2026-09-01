# BL-1313 — QA verification PASS, 2026-09-01

## Lineage / commit cited

Merged documenter's `f175bdad96` (evidence-only, NONE found) into
`swarmforge-QA` as `4b62ba1f85` ("Merge documenter BL-1313 f175bdad96 for QA
verification. By QA."). Ancestry checked directly on the commit being
approved, not inferred from "ancestor of HEAD" (BL-336's trap):

- `git merge-base --is-ancestor ad899a0720 4b62ba1f85` — OK (hardener's merge)
- `git merge-base --is-ancestor c8cee2e2c3 4b62ba1f85` — OK (documenter's pass)

Full chain reviewed: coder (`eb32525012`, reworked after one architect bounce
at `5008be4f0c`) → cleaner (`4c24a42b25`, NONE) → architect (`ae95433f6d`,
NONE) → hardener (`00d71dd9d9`, coverage gap found+closed, no defect) →
documenter (`c8cee2e2c3` + `f175bdad96`, NONE).

## Housekeeping before merge

Two untracked files at the same paths as the incoming commit's own
(`swarmforge/scripts/test/bl1313_handoff_files_with_batches_test_runner.bb`,
`swarmforge/scripts/test/test_swarm_handoff_inbound_non_forwarding_batch.sh`)
blocked the merge. Backed both up to `tmp/pre-merge-backup-BL-1313/`,
removed, merged, then diffed the merge result against the backups: the `.bb`
file was byte-identical; the `.sh` file's only local addition was 3
non-functional comment lines never present anywhere in this ticket's git
history (confirmed via `git diff eb32525012 5008be4f0c` and `git diff
5008be4f0c f175bdad96` on that path — both empty). No content lost, nothing
carried forward. Backup removed after confirming.

## Wiring correctness — verified by hand

Both send-time guards call the new batch-aware reader, not merely unit-tested
in isolation:

- `swarm_handoff.bb:806` — `inbound-non-forwarding?` now folds
  `handoff-lib/non-forwarding?` over `handoff-lib/my-handoff-files-with-batches`
  (was `my-handoff-files`).
- `duplicate_chain_guard_lib.bb:46-52` — `live-parcel-for-ticket` now calls
  `handoff-lib/handoff-files-with-batches` for `:in_process` state reads
  specifically (unchanged `handoff-files` for other states).

## Unit suite (bb/shell, this ticket's own)

- `bb swarmforge/scripts/test/bl1313_handoff_files_with_batches_test_runner.bb`
  → ALL TESTS PASSED
- `bash swarmforge/scripts/test/test_swarm_handoff_inbound_non_forwarding_batch.sh`
  → ALL PASS
- `bash swarmforge/scripts/test/test_swarm_handoff_inbound_non_forwarding.sh`
  (adjacent flat-case suite, unchanged behaviour) → ALL PASS
- `bb swarmforge/scripts/test/handoff_lib_test_runner.bb` → ALL TESTS PASSED
- `bb swarmforge/scripts/test/duplicate_chain_guard_lib_test_runner.bb` → ALL PASS

## Property suite — this ticket's own file

`npx vitest run --config vitest.properties.config.mjs
test/bl1313BatchGuardVisibilityInvariants.property.test.js` (from
`extension/`) → 3/3 pass (both invariants + generator-reachability floor).

## Acceptance (`run_acceptance.sh`)

`specs/features/BL-1313-a-batch-held-parcel-is-visible-to-the-send-time-guards.feature`
— 9/9 scenarios pass (includes hardener's own added scenario 05, 2 examples,
closing the `some`-vs-`every?` fold coverage gap). Real `swarm_handoff.bb`
CLI exercised via subprocess, not a mock.

## qa_e2e_procedure

Satisfied by the acceptance suite's 9/9 (scenarios map directly onto
qa_e2e_procedure steps 1-5; step 6 is the bb/shell fixture run, above).

## Full unit suite (`npm test`, from `extension/`)

23 files / 212 tests failed. Cross-checked against BL-1313's own changed
paths (backlog/*, docs/reference/Specification.MD,
extension/test/bl1313BatchGuardVisibilityInvariants.property.test.js,
specs/features/BL-1313-*, specs/pipeline/steps/bl1313*,
specs/pipeline/steps/index.js, swarmforge/scripts/duplicate_chain_guard_lib.bb,
swarmforge/scripts/handoff_lib.bb, swarmforge/scripts/swarm_handoff.bb,
swarmforge/scripts/test/*): zero overlap.

15 of the 23 failing files are the SAME standing-red set BL-1315's QA pass
recorded on 2026-08-31 (`backlog/evidence/BL-1315-qa-pass-20260831.md`,
itself citing BL-1297's pass one day earlier): `checkOrphanedAuthoredDocs is
not a function` (BL-1221) across crossFileDuplicationCheck,
multiBranchParserCoverageCheck, perHatRolePromptEvidenceCheck,
pilotAcceptanceGate, pilotScopedCrapCheck, shellEntryPointDriveCheck,
unreachableStepHandlerCheck; repo-hygiene reds (constitutionDocCitations,
tempDirTrapGuard, socketFixtureShortRootGuard, liveRepoDerivationGuard,
specifier disposition note `specifier-disposition-qa-standing-red-note-20260828.md`);
operatorRuntimeBbFixtureClosure (BL-1265); backendSwitch/telegramClient/
telegramCursorOperatorExec (BL-1263).

**8 NEW failing files not in that baseline** — bridgeServer, epicMakeTopBridge,
epicReorderBridge, pausedPagerBridge, specTreeBridge, startBridgeHeadlessCli,
telegramCursorBridgeCli, topicMakeTopBridge — contributing the remaining
~187 failing tests. All trace to the same root symptom: `Error: CURSOR_API_KEY
is not set for the headless bridge` thrown from
`cursorBridgeAgentSession.ts:229` (`resolveCursorApiKey`), reached via
`bridgeServer.ts:2026` (`createLiveCursorBridgeAgentSession(targetPath)` as
the unconditional default for `options.letsTalk?.agentSession` inside
`startBridge`). This fires even for fixtures that never exercise cursor/
"let's talk" routing (e.g. epicMakeTopBridge, pausedPagerBridge), so any test
using the shared `startBridge` helper without explicitly stubbing
`options.letsTalk.agentSession` now fails at bridge startup, not at the
point cursor routing is actually used. `grep -rli CURSOR_API_KEY|swarm.env
backlog/active backlog/paused backlog/hold backlog/debt` returned nothing —
genuinely untracked per BL-1063 doctrine. Reported to specifier separately
(priority-00 note) for ticketing; not bounced, not blocking this approval —
zero overlap with BL-1313's own changed paths, and this exact "report,
don't bounce, when zero overlap" handling matches BL-1315's own precedent
for its 15-file baseline.

## Property suite (`npm run test:properties`, from `extension/`)

25 files / 14 tests failed, plus the one allowlisted benign unhandled error
(`[vitest-worker]: Timeout calling "onTaskUpdate"`, BL-871). All 25 failing
files confirmed present in `swarmforge/scripts/property_suite_standing_allowlist.tsv`
with `disposition=allowlist` (checked programmatically against the log, all
25 matched by exact `test/<file>` key). This ticket's own property file
passes clean (see above) and is not in this failing set.

## Orphaned process check

`pgrep -fl 'node --test|stryker'` clean before and after every run in this
pass; no stragglers reaped (none found).

## Non-blocking items already on file, not re-raised

- Hardener's coverage-gap fix (scenario 05) — already landed in this
  ticket's own diff, re-verified above as part of the 9/9 acceptance run.
- Specifier's scope-boundary note (four other `in_process` reads
  deliberately out of scope) — unchanged, not re-litigated.

## Verdict

PASS. No defects found in this ticket's own scope. Approved commit: `4b62ba1f85`.

By QA.
