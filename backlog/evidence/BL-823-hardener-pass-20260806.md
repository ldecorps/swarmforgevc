# BL-823 — hardener pass, 2026-08-06

Reviewed commit: `6a116b27d7` (BL-823: architect pass — clean, forwarding to
hardener), received via architect's merge into this worktree.

## Host load (BL-149 gate)

`uptime` at pass start: load avg 109/106/104 on 4 cores (`sysctl -n hw.ncpu`).
Massively over the 2x-cores busy threshold. `mutation_cooldown_gate.bb` run
against each of the 5 changed `extension/src/**` files confirms:

- `availabilityLedgerStore.ts`, `apply-cooldown-pause.ts`,
  `resume-expired-pauses.ts`, `telegramCursorOperatorExec.ts` — `skip-busy`
- `telegram-front-desk-bot.ts` — `skip-cooldown` (touched by another ticket
  0.5 days ago)

No file reached `run`. Per the office-hours mutation bypass (operator policy
2026-07-06) and the hardener's own load-avg guardrails, Stryker was NOT run
this pass — it does not weaken the gate, it defers the full pass to a quiet
host; a targeted-test hardening pass runs instead so the pipeline is not
stalled.

## Targeted hardening (manual review supplementing the deferred Stryker run)

Since the automated TS mutation gate could not run, reviewed the new/changed
production code by hand against its own test suites for assertion gaps a
mutant could hide behind:

1. **Default-source parameter never asserted.** Both pause-twin writers
   (`writeControlPauseState`, `writeOperatorPauseState`) take an optional
   `source` defaulting to their own function name so every pre-BL-823 caller
   keeps working. No existing test asserted the actual DEFAULT string value
   — only explicit-source calls were checked. A mutant on either default
   string literal would have survived undetected.
   - Added `BL-823: writeControlPauseState with no source argument records
     the function-name default` (telegramFrontDeskBotCli.test.js).
   - Added `BL-823: writeOperatorPauseState with no source argument records
     the function-name default` (telegramCursorOperatorExec.test.js).
2. **`applyPause`/`resumeNow` own distinguishing sources never asserted.**
   These wrap `writeControlPauseState` with `'telegram-front-desk-bot:pause'`
   / `'telegram-front-desk-bot:resume'`; the existing BL-423 tests checked
   the pause-state file and the Telegram announcement but never the ledger
   record's `source`. Added assertions to both existing tests rather than
   new tests (natural extension of what they already exercise).
3. **`.bb` reader's forward-compatible skip branch untested.** Babashka has
   no mutation tool wired (engineering.prompt) — the gate is the hand-written
   test suite. `fold-intervals`' `case` default clause (an unrecognized event
   is skipped "without disturbing open state") had no test forcing that
   branch. Added a test that interleaves an unrelated `provider-outage`
   event between an open `pause-start` and end-of-records, asserting the
   still-open control-pause interval survives.
   - Verified this test is load-bearing, not decorative: hand-mutated the
     default clause to `(recur (next records) nil nil intervals)` (resetting
     open state instead of passing it through) — the new test failed with 3
     assertion mismatches. Reverted the mutation immediately after
     confirming the kill; `git diff --stat` on the `.bb` file is clean.

All three gaps were real: each is a case where a plausible one-line mutant
(a typo'd default string, a reset instead of pass-through) would have shipped
undetected. None reflect a wrong implementation — the implementation was
already correct in all three cases; only the test's power to catch a future
regression was missing.

## Gherkin acceptance mutation (BL-113, soft)

`specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-823-availability-interval-ledger.feature . \
specs/pipeline/steps/bl823AvailabilityIntervalLedgerSteps.js soft`

Both `Scenario Outline`s mutated: "Every pause writer twin appends its
transition" (12/12 killed) and "A ledger write failure never blocks the
operation it observes" (3/3 killed). Zero survivors. Manifest embedded in
the feature file and committed with this pass.

## CRAP (changed code)

`npm run compile && vitest run --coverage` scoped to the 5 tests that exercise
these 5 changed files (full-suite coverage skipped for the same load-avg
reason as Stryker — targeted coverage on the exact tests covering the changed
files gives the same numbers for those files), then
`node scripts/crapReport.js` against the 5 changed `src/*.ts` paths (never
`out/*.js` — BL-381).

Every function BL-823 itself added or touched is well under the CRAP<=6
threshold:
- `appendAvailabilityRecord` — complexity=2, coverage=100%, CRAP=2.00
- `writeControlPauseState` — complexity=3, coverage=100%, CRAP=3.00
- `writeOperatorPauseState` — complexity=4, coverage=100%, CRAP=4.00

20 functions in these 5 files exceed CRAP<=6, all pre-existing and unrelated
to this parcel's diff:
- `telegramCursorOperatorExec.ts`'s large pre-existing verb dispatchers
  (`executeOperatorVerb` CRAP=123.97, `executePolicyVerb` CRAP=43.20, etc.)
  — none of these functions' bodies are touched by BL-823's diff (which only
  adds an import, a call inside `writeOperatorPauseState`, and two source
  string literals at two `/pause`/`/resume` call sites).
- `apply-cooldown-pause.ts`'s `main` — complexity=7, coverage=100%,
  CRAP=7.00. BL-823's diff here is a single-line change (adding a 3rd
  argument to an existing `writeControlPauseState` call) — no new branch.
  `git diff` confirms no other line moved. Pre-existing complexity, not
  introduced or worsened by this ticket. At 100% coverage CRAP equals
  complexity exactly (the formula's coverage term is 0), so this can only be
  fixed by reducing complexity (splitting `main` into helpers), which is a
  cleaner/architect-scoped structural change this "deliberately small"
  ticket's own scope note explicitly warns against expanding into.

## DRY (changed code)

`jscpd` on the 5 changed files: 1 clone, 18 duplicated lines (0.45%) —
`forcedPostFn` (the `TELEGRAM_NOTIFY_FORCE_RESULT` E2E test seam) duplicated
between `apply-cooldown-pause.ts` and `resume-expired-pauses.ts`. Confirmed
pre-existing: the comment above `forcedPostFn` in `apply-cooldown-pause.ts`
already says "mirroring resume-expired-pauses.ts's own... convention exactly"
and both are tagged with tickets (BL-617/BL-423) that predate BL-823.
BL-823's diff to these two files is a single-line call-site argument each —
the duplicated block is untouched. Not a BL-823 defect.

## Verification (full re-run after the added tests)

- `npx vitest run` (5 targeted test files, from `extension/`) — 296/296 pass
  (294 pre-existing + 2 new default-source tests).
- `npx vitest run --config vitest.properties.config.mjs availabilityLedger`
  — 5/5 property tests pass, unchanged.
- `bb swarmforge/scripts/test/availability_ledger_lib_test_runner.bb` — ALL
  PASS (16 assertions across 13 scenarios, including the 1 new
  unrecognized-event test).
- `bash swarmforge/scripts/test/test_availability_ledger_lib.sh` — every
  check prints `ok`/`PASS`; script's own exit code still 1 from the
  pre-existing, already-ticketed BL-801 bash-3.2 `tmp_cleanup.sh` EXIT-trap
  bug (confirmed unrelated, same as the architect's pass — file untouched by
  this parcel).
- `node specs/pipeline/cli.js specs/features/BL-823-availability-interval-ledger.feature`
  — 13/13 pass.
- No orphaned `node --test`/`stryker`/`vitest` processes at handoff
  (`pgrep -fl` scoped check, clean).

## Required wiring (BL-531)

All four `required_wiring:` entries confirmed still live and now under a
source-string assertion (not just a wiring-exists check): both TS pause
twins, `kill_pipeline_swarm.sh`, `start-swarm.sh`.

## Verdict

Hardened. No bounce. Forwarding to documenter.
