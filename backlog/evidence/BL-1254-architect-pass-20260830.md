# BL-1254 — architect pass, 2026-08-30

Reviewed the cleaner-forwarded commit `912767aee6` (cleaner merged coder
`dbda49491` with no additional cleanup commit of its own) against the
architecture rules and the ticket's declared invariants.

## Verdict: COMPLIANT — forwarded to hardender

## Dependency-rule gate (BL-259, hard gate)

Files straddle the `extension/` boundary, so ran a full-repo scan per the
documented invocation gotcha:

```
cd extension && node out/tools/dependency-gate.js
```

`Dependency-rule gate PASSED: no forbidden edges.`

## Co-change tool (BL-255)

Ran against the parcel's changed non-doc files (the two new property tests,
the step-handler registration, `index.js`, and the two new CLI helper
scripts). All reported co-changes are frequency 1 (this commit only, files
that landed together with no prior joint history) — below the default
suspected-coupling threshold. No logical coupling flagged.

## Invariants Review (BL-654)

All three of the ticket's declared invariants carry either an executable
encoding or a stated non-encodability reason, per the evidence file the
coder wrote (`backlog/evidence/BL-1254-stamp-expedite-no-verdict-chain-20260830.md`).
Independently re-verified rather than trusted:

- Re-ran both property files directly (not via the commit-time guard, which
  this branch has bypassed for an unrelated BL-1294 red per the recorded
  override):
  `cd extension && npx vitest run --config vitest.properties.config.mjs
  test/bl1254LedgerCertificationNeedsAHuman.property.test.js
  test/bl1254MissingVerdictNeverBounces.property.test.js`
  → 2 files, 6 tests, all green.
- Re-ran the acceptance feature:
  `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1254-swarm-stamp-expedite-no-verdict-chain.feature`
  → 9/9 pass.
- Re-ran both Babashka suites:
  `bb swarmforge/scripts/test/expedite_lib_test_runner.bb` → ALL PASS.
  `bash swarmforge/scripts/test/test_expedite_cli.sh` → ALL PASS (BL-782's
  warned pre-existing failures did not reproduce here either).
- Confirmed invariant 1 by hand: `git log --oneline -1 -- expedite_lib.bb
  expedite_cli.bb expedite_lib_test_runner.bb test_expedite_cli.sh` since
  before this chain's mint shows no commit from this parcel — the four
  hotfix files are untouched.
- Read `bounce-payload-valid?` (expedite_lib.bb:866-877) directly to verify
  the pinned finding: `class` is compared exactly (`(= c "no-verdict-abandoned")`)
  while `reason` is lower-cased first. Grepped the whole tree for any site
  that constructs `:class "no-verdict-abandoned"` and found none outside the
  pure function itself, the tests, and BL-1259's still-paused feature file —
  confirms the coder's "not live" characterization: the running driver only
  ever synthesizes the lowercase `:reason :no-verdict` (expedite_lib.bb:920),
  never a `no-verdict-abandoned` class. Correctly left as a pinned follow-up,
  not fixed here — fixing it would touch the hotfix source, which invariant 1
  and the ticket's constraints forbid in this parcel.

## Required wiring

`specs/pipeline/steps/index.js::bl1254ExpediteNoVerdictChainStampSteps` —
confirmed registered (`index.js:891`), exercised by the 9/9 acceptance run
above.

## Correctness read

No defect beyond the already-pinned, already-non-live case-asymmetry finding.
Nothing in this parcel writes to `backlog/hotfix-ledger.yaml` or touches the
hotfix sources — confirmed by direct git history read, not by trusting the
evidence file's claim.

## Property Testing pass (undeclared coverage)

The only new pure/testable modules this parcel adds ARE the two declared-
invariant property tests already covered above; the step-handler file is
acceptance wiring driving real CLIs, not a pure module with an independent
property-shaped invariant. No additional property test needed.

## Surfaced, not acted on

Confirmed `backlog/paused/BL-1259-*.yaml` exists and reviews the SAME three
SHAs (`3f4f69ec1b`, `70c5e0e5b0`, `5de352ed1d`) as its own stamp-off,
independently of BL-1254. The coder's note to the specifier is not visible
from this worktree's mailbox (specifier is master-resident); not
re-sent — routing a `note` is the coder's completed action, not something
for the architect to redo. Left for the specifier to adjudicate.
