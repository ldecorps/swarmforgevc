# BL-1317 — hardener pass (20260902)

Received: architect commit `09c6ce0ac8` (forwarded unchanged from cleaner's
clean sweep `df349fbc73`, on top of coder's self-audit `cfdb532b64`).

## BL-149 file-change cooldown gate

Per-changed-file `mutation_cooldown_gate.bb` results (host quiet, load
1.76/20 cores):

- `extension/src/tools/effortDialAdapt.ts` — **run**
- `swarmforge/scripts/done_with_current_task.bb` — **run**
- `swarmforge/scripts/handoff_lib.bb` — skip-cooldown (1.2 days old)
- `swarmforge/scripts/seat_difficulty_lib.bb` — skip-cooldown (1.9 days old)
- `swarmforge/scripts/ready_for_next_task.bb` — skip-cooldown (1.9 days old)

## Stryker mutation (`out/tools/effortDialAdapt.js`)

Final run (post-CRAP-extraction, `--force`): **98.82%** — 84 killed, 1
survived (equivalent), 0 timeout, 0 no-coverage, 0 errors.

The one survivor, `rankOf`'s `effort === undefined ? -1 : ...` mutated to
`false ? -1 : ...` (line 52 in the compiled output), is an **accepted
equivalent** (BL-234 class): `ADAPT_EFFORT_LADDER.indexOf(undefined)` is
always `-1` for a string-array ladder, identical to the explicit `-1`
branch it replaces — no assertion could ever differentiate the mutant from
the original. Demonstrated from the code, not by shape.

10 real survivors from the first scoped run were closed by adding reason-
string assertions (StringLiteral mutants on every `reason:` literal) and
one new test for an actual gap: `cleanStreakRequired`'s `??` default
(`ADAPT_DEFAULT_CLEAN_STREAK`) was never exercised with the field truly
absent — every existing test (unit and property) always passed it
explicitly equal to the default itself, so `??` and `&&` produced the same
result everywhere they were exercised. Added
`BL-1317: an omitted cleanStreakRequired falls back to the real default,
not a falsy short-circuit`, which passes `cleanStreakRequired: undefined`
and asserts the default gate still holds. Also closed the
`if (signal === 'clean') -> if (true)` survivor by strengthening the
"unknown signal" test to assert the exact reason and effort, which a
mutant re-routing an unrecognized signal into the clean branch cannot
satisfy.

### Attempts before the clean run (all environmental, none in my domain)

Six dry-run attempts were needed before the mutation run itself could
start. In order:

1. `test/liveRepoDerivationGuard.test.js` red — pre-existing, ticketed
   **BL-1291** (paused, `todo`).
2. `test/telegramCursorOperatorExec.test.js` "ambulance engage" red —
   pre-existing, ticketed **BL-1263**.
3. `test/telegramClient.test.js` `allows_multiple_answers` red —
   pre-existing, also **BL-1263**.
4. Full-suite sweep surfaced a batch of further pre-existing reds, all
   ticketed: `test/pilotAcceptanceGate.test.js` and 6 sibling
   `landPilotedTicket` files (**BL-1221**/**BL-1229**,
   `deps.checkOrphanedAuthoredDocs is not a function`),
   `test/operatorRuntimeBbFixtureClosure.test.js` (**BL-1265**),
   `test/socketFixtureShortRootGuard.test.js` /
   `test/tempDirTrapGuard.test.js` (**BL-1290**/**BL-1226**/**BL-1312**),
   `test/constitutionDocCitations.test.js` (long-standing, corroborated in
   many prior QA passes per `backlog/evidence/QA-standing-red-corroboration-20260828.md`).
   All 15 files excluded **locally and temporarily** from
   `vitest.config.mjs`'s `exclude` array to unblock Stryker's dry run;
   reverted to a byte-identical `git diff` before every commit in this
   pass.
5. **Two REAL, previously-unticketed defects found and fixed** (BL-1066
   class — see below): `test/bl1300HeadroomProofIsPinned.test.js` and
   `test/activePoolFreshnessAudit.test.js`.
6. One flat host-load timeout (`Initial test run timed out!`) at load
   3.86–8.25/20 cores, coincident with the coder worktree's own
   `test:properties` run on this shared host (confirmed via `ps` — pgid
   21325, cwd `.worktrees/coder`, not mine to touch). Retried once each
   time; both retries succeeded.

## Two new BL-1066-class defects found and fixed (not this ticket's own domain, but blocking every mutation run on this repo)

`extension/test/bl1300HeadroomProofIsPinned.test.js` and
`extension/test/activePoolFreshnessAudit.test.js` both computed their
"real repo root" as `path.join(__dirname, '..', '..')` (or
`fs.realpathSync` of the same). Under a Stryker sandbox the sandbox
directory itself IS the extension root (BL-1066), so this walk-up lands
one level too shallow, inside `.stryker-tmp` — harmless for a plain `fs`
read (siblings are symlinked there), but:

- `bl1300...`: `git archive <commit> swarmforge/constitution.prompt ...`
  resolves its pathspec relative to `-C`'s cwd within the TRACKED tree, not
  through the symlinks, so every pathspec missed:
  `fatal: pathspec 'swarmforge/constitution.prompt' did not match any files`.
- `activePoolFreshnessAudit...`: `checkFreshnessViaCli`'s
  `resolveDeprecateCheckCliPath` looks for
  `<root>/extension/out/tools/deprecate-check.js` — under the wrong root
  that path doesn't exist, so the CLI path resolves to `undefined` and the
  function silently returns `''`, failing
  `assert.ok(raw.length > 0, 'expected the real CLI to produce output')`.

Both fixed the same way: replace the `../..` arithmetic with
`execFileSync('git', ['-C', __dirname, 'rev-parse', '--show-toplevel'], ...)`,
which resolves the true repo root regardless of sandbox nesting depth
(verified directly from inside `.stryker-tmp/sandbox-<id>/test/`). Both
pass standalone before and after; both were red under Stryker before the
fix and green under Stryker after (confirmed: the post-fix full-suite
Stryker dry run advanced past both files to the actual mutation phase).

Not ticketed as new backlog items — these are `test/`-only fixes with no
production behavior change, found and fixed in the same turn per the
"fix the harness first, then mutate" posture (the BL-788 precedent in this
role's prompt). A `rule_proposal` for the general pattern (a THIRD and
FOURTH file hitting the exact class the BL-1066 rule already documents,
one day-plus after that rule was accepted) is being sent to the specifier
separately.

## CRAP (`src/tools/effortDialAdapt.ts`, coverage forced with
`--coverage.reportOnFailure=true` per the standing-reds-blocking-coverage-write
rule — the same pre-existing reds above suppress the plain write)

First measurement: `decideAdaptEffort` complexity=11, CRAP=11.00 (100%
coverage; complexity alone breached the >6 gate). Extracted the two signal
branches into `decideBounce` (complexity 2) and `decideClean` (complexity
5) — pure, behavior-preserving split, no new product behavior. Final:

```
decideAdaptEffort  complexity=6  CRAP=6.00
decideClean        complexity=5  CRAP=5.00
adaptRoleEffort     complexity=3  CRAP=3.00
rankOf              complexity=2  CRAP=2.00
decideBounce        complexity=2  CRAP=2.00
```

All ≤6. Re-ran the full mutation pass with `--force` after the extraction:
identical result, 98.82%, same one accepted-equivalent survivor — the
split did not change behavior or drop coverage.

## DRY

`npx jscpd src/tools/effortDialAdapt.ts test/effortDialAdapt.test.js` — 0
clones, 0% duplication.

## Verification (all green)

- `npx vitest run test/effortDialAdapt.test.js` — 20/20 (was 18/18; +2 new)
- `npm run test:properties -- test/bl1317AdaptEffortInvariants.property.test.js` — 4/4
- `bash swarmforge/scripts/test/test_bl1317_effort_ladder_parity.sh` — ALL PASS
- `bb swarmforge/scripts/test/handoff_lib_test_runner.bb` — ALL TESTS PASSED
- `bb swarmforge/scripts/test/seat_difficulty_lib_test_runner.bb` — ALL PASS
- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1317-adapt-tier-effort-from-outcome-signals.feature` — 3/3
- Full unit suite (`npx vitest run`, no exclusions): 571 files, 9889 tests,
  9864 passed / 25 failed — the exact same 25 pre-existing, already-ticketed
  standing reds as the baseline before this pass touched anything (confirmed
  by diffing the FAIL list before/after). Zero new failures.

## Hand-authored sweep, `done_with_current_task.bb`'s Adapt wiring (no Stryker on `.bb`)

Two hand mutants against `record-effort-adapt-for!`, both killed via the
real acceptance feature, both reverted to a byte-identical `git diff`:

1. Hardcode the signal derivation to `"clean"` (defeating the
   `non-forwarding?` bounce check) — killed: 2/3 scenarios failed.
2. Delete the `(record-effort-adapt-for! target-file)` call entirely —
   killed: 2/3 scenarios failed.

## Orphan check

`pgrep -fl 'node --test|stryker'` scoped to this worktree: clean, nothing
left running. No fixture leaks under `extension/test/` or `$TMPDIR`
(`git status --short` clean of anything but the intended diff).

## Verdict

No blocking defect in the ticket's own domain. Forwarding to documenter.

By hardener.
