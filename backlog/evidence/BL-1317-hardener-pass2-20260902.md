# BL-1317 — hardener pass 2, after QA bounce + required_wiring amendment (20260902)

Received architect commit `84606ec162`. Context: QA bounced D1
("`decideAdaptEffort` has zero live callers") after my first hardener
pass. The specifier amended `required_wiring` to drop the TypeScript
requirement entirely (the outcome signal Adapt reacts to lives only on
the Babashka side, so no TS caller can ever exist). The coder deleted
`extension/src/tools/effortDialAdapt.ts` and its test outright rather
than leave unwired dead code, repointed the property test and the
ladder-parity gate at the real Babashka implementation, and added
`bl1317AdaptSingleApplierPerLanguage.test.js` as a standing guard (no
TS module may apply Adapt; the one Babashka applier must still be
wired). Cleaner and architect both re-passed clean.

## What changed for hardener's own domain since my first pass

My first pass's mutation work on `effortDialAdapt.ts` (98.82%, CRAP
extraction) is now moot — that file is deleted. The remaining production
logic is entirely Babashka (`seat_difficulty_lib.bb::adapt-effort-decision`,
already reviewed for wiring in my first pass via
`handoff_lib.bb::record-effort-adapt!`, unchanged by this rework). Since
Babashka has no Stryker coverage (BL-472), this pass's job is a
hand-authored mutation sweep of `adapt-effort-decision` itself — the ONE
function that used to have two independent implementations (TS + bb) and
now has exactly one.

## Hand-authored mutation sweep, `adapt-effort-decision`

Nine mutants, each applied directly to `seat_difficulty_lib.bb`, run
against `seat_difficulty_lib_test_runner.bb`, confirmed killed, then
restored (verified `git diff --stat` empty after every restore):

1. Streak boundary `(< streak required)` → `(<=)`: killed (3 failures).
2. `(or clean-streak-required adapt-default-clean-streak)` → `(and ...)`:
   killed (crash — most tests omit `:clean-streak-required`, so the
   default path is genuinely exercised, unlike the TS suite's analogous
   gap in my first pass).
3. Floor `(or (adapt-rank baseline-effort) prior)` → `(and ...)`: killed
   (crash, via the "absent baseline" test).
4. Bounce climb `(min (inc prior) top)` → `(min (+ prior 2) top)`: killed
   (2 failures — over-climbing caught).
5. Bounce top-of-ladder `(if (= next prior) ...)` → `(if (not= ...) ...)`:
   killed (4 failures).
6. Clean drop `(if (= next prior) ...)` (second occurrence) → `(not= ...)`:
   killed (6 failures).
7. Drop-notch `(max (dec prior) floor)` → `(max (- prior 2) floor)`:
   killed (1 failure).
8. `effort-lever-backend?` guard negation flipped: killed (12 failures).
9. **Real gaps found**: the "unknown prior effort" and "unknown signal"
   reason strings (`(str "unknown prior effort " ...)`,
   `(str "unknown signal " ...)`) both SURVIVED — the existing assertions
   checked only `:apply?`, not the reason text, the exact same
   reason-string blind spot my first pass found and closed in the TS
   version. Fixed: strengthened both assertions in
   `seat_difficulty_lib_test_runner.bb` to compare the FULL result map
   (matching the style most of this suite's other assertions already
   use). Re-verified both mutants killed, isolated to exactly the
   strengthened assertions, before restoring.

## Non-vacuity check on the new single-applier guard

Independently verified `bl1317AdaptSingleApplierPerLanguage.test.js`'s
third test (the positive wiring anchor) beyond the coder's own
demonstration for the negative halves: renamed
`record-effort-adapt!` to `record-effort-adapt-RENAMED!` in
`handoff_lib.bb`, confirmed the anchor test fails naming the missing
symbol, restored (`git diff --stat` empty).

## Verification (all green)

- `bb swarmforge/scripts/test/seat_difficulty_lib_test_runner.bb` — ALL
  PASS (was 14 assertions, now 14 with 2 strengthened, +0 net count)
- `bb swarmforge/scripts/test/handoff_lib_test_runner.bb` — ALL TESTS
  PASSED
- `npx vitest run test/bl1317AdaptSingleApplierPerLanguage.test.js` — 3/3
- `npm run test:properties -- test/bl1317AdaptEffortInvariants.property.test.js`
  — 4/4 (both declared invariants, folded through the real bb decision
  per BL-897)
- `bash swarmforge/scripts/test/test_bl1317_effort_ladder_parity.sh` —
  ALL PASS, 5/5 (repointed at `effortDial.ts`'s `EFFORT_LEVELS` since the
  TS decision module is gone)
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1317-adapt-tier-effort-from-outcome-signals.feature`
  — 3/3
- Full unit suite (`npx vitest run`, no exclusions): 571 files, 9899
  tests, 9874 passed / 25 failed — the exact same 25 pre-existing,
  already-ticketed standing reds as before (fail-list diffed line for
  line against the baseline). Zero new failures.

## CRAP / DRY

No TS production file changed (only the bb test runner) — nothing new
to measure. `effortDialAdapt.ts`'s deletion is a net negative to any
future CRAP/DRY scan, not a regression.

## Orphan check

`pgrep -fl 'node --test|stryker'` scoped to this worktree: clean.
`git status --short`: only the intended `seat_difficulty_lib_test_runner.bb`
diff plus the same two pre-existing untracked files noted throughout
this session.

## Verdict

One real gap found and closed (reason-string coverage on
`adapt-effort-decision`'s two fail-closed paths — the Babashka mirror of
the exact class my first pass already found in the now-deleted TS
version). No other defect. Forwarding to documenter.

By hardener.
