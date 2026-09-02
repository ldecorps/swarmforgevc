# BL-1317 — coder rework on the 2026-09-02 required_wiring amendment

Inbound: specifier `note` (priority 00), "BL-1317 amended on main
(required_wiring); merge main and re-read". Merged `main` into the coder
worktree first (`e27b3f5b8f`), re-read the amended ticket, then reworked.

## What the amendment changed

`required_wiring` item 1 no longer names a TypeScript module. The pure Adapt
decision belongs beside BL-1316's in `seat_difficulty_lib.bb`, because the
outcome signal Adapt reacts to is recorded on the Babashka side and no caller
can exist at the adapt moment on the TS side. No scenario, invariant or
acceptance criterion moved.

## What I did

- **Removed the unwired TypeScript half** — `extension/src/tools/effortDialAdapt.ts`
  and `extension/test/effortDialAdapt.test.js`. This module had no production
  caller anywhere (only its own tests), which is exactly the defect QA bounced
  as D1 ("decideAdaptEffort unwired"). Under the amended wiring it cannot
  acquire one, so it is deleted rather than left in place.
- **Property test now drives the real Babashka decision.**
  `bl1317AdaptEffortInvariants.property.test.js` invariant 2 previously ran
  in-process against the TS module. It now folds each generated sequence
  through `seat_difficulty_lib.bb::adapt-effort-decision` in ONE bb process,
  which reports per step both the inputs it used and the decision it made; the
  JS loop replays against those decisions and asserts the inputs agree, so a
  divergence between the two folds fails loudly instead of hiding. The ladder
  and clean-streak constants are read out of the bb lib rather than restated
  in JS (BL-897 — no second copy).
- **Parity gate repointed.** `test_bl1317_effort_ladder_parity.sh` compared the
  bb ladder against the deleted TS module. The real remaining cross-language
  literal is BL-236's `EFFORT_LEVELS` in `extension/src/swarm/effortDial.ts`,
  which the bb ladder mirrors, so the gate now reads and compares those two.
  The clean-streak default now exists only in bb; its cross-language check is
  dropped, its `> 1` sanity check kept.
- **Single-applier gate narrowed.** `bl1317AdaptSingleApplierPerLanguage.test.js`
  now asserts NO TypeScript module applies Adapt at all, plus a positive
  anchor that the one Babashka applier is still wired (decision, IO edge, and
  the `done_with_current_task.bb` consumer) — so the negative half cannot pass
  in a tree where Adapt was deleted outright.
- **Docs corrected** where they described the two-language decision
  (`docs/how-to/BL-1317-…md`, `docs/reference/Specification.MD`).

## Verification (run, not assumed)

- `npx vitest run --config vitest.properties.config.mjs test/bl1317AdaptEffortInvariants.property.test.js` — 4 passed.
- **Non-vacuity, shown not claimed**: temporarily changed the bb climb to
  `(+ prior 2)`; invariant 2 FAILED. Restored (`git diff` on
  `seat_difficulty_lib.bb` empty), re-ran — 4 passed.
- `npx vitest run test/bl1317AdaptSingleApplierPerLanguage.test.js` — 3 passed.
- `bash swarmforge/scripts/test/test_bl1317_effort_ladder_parity.sh` — ALL PASS.
- `bb swarmforge/scripts/test/handoff_lib_test_runner.bb` — ALL TESTS PASSED.
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1317-…feature` — 3/3 pass.
- `npx tsc -p . --noEmit` — clean.
- `npx vitest run` (full unit suite) — 9868 passed, 25 failed in 15 files.
  **Those 25 are pre-existing standing reds inherited from `main`, not mine**:
  none of the failing files is a path this parcel touches, and their
  violations name files (`local_coder_battery.sh`, `bl1121`/`bl1122`/`bl1134`/
  `bl1137`/`bl1138` runners, `pilotAcceptanceGate.ts`) that predate this
  worktree's merge — confirmed with `git merge-base --is-ancestor` against
  `d5ed022fd7`.

## Merge conflict resolution (recorded)

`main` conflicted on two files; both resolved by KEEPING BOTH sides, nothing
dropped:
- the ticket YAML — QA's `bounce_history` entry alongside the specifier's
  amendment `notes:` block;
- `handoff_lib_test_runner.bb` — this parcel's `record-effort-adapt!` block
  alongside main's outbox-race `read-envelope-if-present` block.

The `backlog/paused/` deletions the merge carried in are main-side promotions
(BL-1056, BL-1338 both now live under `backlog/active/` on main), not
retirements; named in the merge commit message so the deletion guard could
see they were deliberate.
