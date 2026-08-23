# BL-1071 — hardener pass — 20260823

## Context

Received from architect (`ab4b5aa932`, PASS — D1/scenario-06 verified fixed,
plus the `control-plane-error` destructuring gap the coder found along the
way). Merged into the hardener worktree (`068aab397`); the merge carried
the specifier's deliberate ticket renumber (BL-1101 -> BL-1107, `d1b86ad56`)
transitively — the ticket-deletion pre-commit guard required naming BL-1101
in the merge commit message to confirm it, no retirement work performed
here.

## Degraded gate, as the ticket itself records up front

Babashka + shell only for `babysitter_check.bb` / `babysitterd_sweep_lib.bb`:
no mutation/CRAP/DRY is wired for either layer (engineering.prompt, Startup
Tools). Ran the BL-149 cooldown gate on both anyway for the record:

```
babysitter_check.bb:        skip-cooldown (file_age_days: 0.13, host quiet)
babysitterd_sweep_lib.bb:   skip-cooldown (file_age_days: 0.59, host quiet)
```

Both inside the 3-day cooldown window — moot in practice since no mutation
tool is wired for either file regardless, but recorded per protocol. Nothing
below implies mutation ran against these two files.

The two touched Node files (`bl1071BabysitterSweepSurvivalSteps.js`,
`specs/pipeline/steps/index.js`) sit under `specs/pipeline/steps/`, not
`extension/src/`, so CRAP (`npm run crap`) and DRY (`npm run dry`) — both
scoped to `extension/src/*.ts` — do not apply to them either.

## What DID run, and is real hardener-owned coverage

**BL-113 soft Gherkin acceptance mutation — not previously run on this
parcel.** The feature carries two `Scenario Outline`s (10 total examples
across `sweep-survives-a-failing-probe-01` and
`plane-response-matches-what-is-possible-02`); the four other scenarios are
plain `Scenario:` and are out of BL-113's scope.

```
bash specs/pipeline/scripts/run_gherkin_mutation.sh \
  specs/features/BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix.feature \
  "" specs/pipeline/steps/index.js soft
```

Result (embedded manifest, `tested_at: 2026-08-23T06:05:44Z`, confirmed
freshly written by this run — file mtime matches, not a stale stamp per
BL-460/BL-502): **10/10 mutants killed, 0 survived, 0 errors** across both
outlines. Every `Examples:` column (`probe`, `scripts`, `response`,
`per-role`) already resolves through an explicit `KNOWN_*` lookup keyed on
the cell value itself (BL-421/BL-908 pattern — not a shape-based lookup), so
every cell is mutation-tight by construction. A soft re-run immediately
after correctly reported `total=0 skipped=10` (BL-460 stamp-still-valid
shape, not a broken tool).

- Full acceptance suite: `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1071-....feature` — **10/10 pass**.
- Babashka unit tests: `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb`
  — ok.
- Shell integration suite: `bash swarmforge/scripts/test/test_babysitter_check.sh`
  — **ALL PASS** (15/15, including M/M2 for review goals 1 and 2).
- Property tests (invariants 1, 2, 3), scoped run per architect's own
  approach: `npm run compile && npx vitest run --config
  vitest.properties.config.mjs test/bl1071RecoveryBoundedInTime.property.test.js
  test/bl1071SweepSurvivesAnyProbeFailure.property.test.js` — **4/4 pass**.
- Standing whole-tree guards (parcel touches `specs/pipeline/steps/`, so all
  13 `test/*Guard*.test.js` files run per the standing-guard rule, not just
  the two most load-bearing): `npx vitest run test/*Guard*.test.js` (minus
  `.property.` siblings) — **125/125 pass**, including
  `retiredEnsureEnvVarGuard.test.js` (guards review goal 1's removal) and
  `tmuxReaperGuard.test.js` (this step file starts no real tmux server —
  only PATH-stubs the binary — so it's a clean pass, not a false negative).

No leftover mutation/test processes after any run (`pgrep -fl 'node
--test|stryker|mutationWorker|vitest'` clean before and after); the
mutation script's own auto-created `/tmp/tmp.*` work dir (it takes no
`--work-dir` cleanup trap of its own) removed by hand after use.

## Coverage-gap judgment: one candidate considered, not added

`sh!`'s catch synthesizes `{:exit 127 ... :spawn-failed? true}`
(`babysitter_check.bb:101`, review goal 3). No test asserts the
`:spawn-failed?` key directly, and no caller reads it — confirmed by grep,
zero references to `:spawn-failed?` or the literal `127` anywhere in
`babysitterd_sweep_lib.bb`. The regression this key is meant to protect
against tomorrow (a future caller mis-trusting a synthesized 127 as a real
one) is not testable today because there is no such caller yet; the
regression that WOULD matter today — the catch being removed entirely,
re-aborting the whole sweep on a spawn failure, which is the ticket's own
incident shape — is already covered end-to-end by shell case L (`missing
vm_stat binary does not abort the sweep`). Adding a unit test that merely
asserts an unconsumed map key is present would be testing implementation
trivia with no behavioral consequence yet, not closing a real gap
(architect's own "gold-plating" judgment elsewhere in this same ticket).
Left unadded; a future ticket that adds a real consumer of `:spawn-failed?`
should test it there, against that consumer.

## Verdict: PASS — forwarding to documenter.

By hardender.
