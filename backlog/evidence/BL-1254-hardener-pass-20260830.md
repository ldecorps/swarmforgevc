# BL-1254 — hardener pass, 2026-08-30

Reviewed the architect-forwarded commit `abf0317c35` (COMPLIANT verdict) for
BL-848 stamp-off of the Cursor expedite no-verdict hotfix chain. This is a
review-only stamp-off: nothing in this parcel reimplements, rewrites, or
touches the four hotfix files (`expedite_lib.bb`, `expedite_cli.bb`,
`expedite_lib_test_runner.bb`, `test_expedite_cli.sh`), confirmed unchanged by
the acceptance Background's own `git status --porcelain` check on every run.

## Suites re-run (all green, independently confirmed)

- `bb swarmforge/scripts/test/expedite_lib_test_runner.bb` → ALL PASS
- `bash swarmforge/scripts/test/test_expedite_cli.sh` → ALL PASS (BL-782's
  warned pre-existing failures did not reproduce, matching architect's note)
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1254-swarm-stamp-expedite-no-verdict-chain.feature` →
  9/9 pass
- Both declared-invariant property files, `--config
  vitest.properties.config.mjs`:
  `bl1254LedgerCertificationNeedsAHuman.property.test.js`,
  `bl1254MissingVerdictNeverBounces.property.test.js` → 2 files, 6 tests,
  all green

## Mutation hardening

### BL-113 Gherkin acceptance mutation (soft), both Scenario Outlines

`specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1254-swarm-stamp-expedite-no-verdict-chain.feature <fresh
mktemp -d under ./tmp/> specs/pipeline/steps/index.js soft`, all 4 positionals
passed explicitly.

- Scenario "A bounce must carry an actionable reason to count as a bounce"
  (Outline, 3 examples): 6/6 mutants KILLED, 0 survived, 0 errors — recorded
  in the feature file's own manifest (durable per BL-502).
- Scenario "A stage that exits without a verdict is re-invoked while
  recoveries remain" (Outline, 3 examples): 6 mutants total. 5 KILLED. 1
  SURVIVED:

  `m5: $.scenarios[0].examples[2].attempt: 3 -> 12` — mutating the third
  row's `attempt` value from 3 to 12 produced an identical result
  ("fails the ticket closed").

  **Accepted as EQUIVALENT, per the BL-234 exception — demonstrable from the
  landed code, not asserted by convenience.** `expedite_lib.bb:857-864`,
  `should-recover-missing-verdict?`, gates recovery on
  `(< (or attempt 0) max-missing-verdict-recoveries)` with
  `max-missing-verdict-recoveries` = 2 (`expedite_lib.bb:855`). For any
  `attempt >= 2` the comparison is false identically — 3 and 12 are both
  members of the same "recoveries exhausted" class the landed code treats
  uniformly, so no assertion at any observation point (the CLI driver, the
  step handler, or the acceptance test) could ever distinguish them. This
  scenario's own manifest entry is correctly OMITTED by BL-502 (the manifest
  writes only scenarios with zero survivors/errors) — that omission is
  expected, not a regression, and this evidence file is the durable record of
  the equivalence per BL-234's recording requirement.

  This finding did not require a new test: forcing one would pin an
  arbitrary boundary value (3 vs. 2, vs. 4, vs. 12 — all equally exhausted)
  as implementation trivia, not behavior, which is exactly what BL-234
  forbids manufacturing a kill for.

Not run: Stryker/CRAP/DRY. No `src/*.ts` production code is touched by this
parcel (the two new files under `extension/test/` are property TEST files,
kept separate from coverage/mutation/CRAP/DRY per the shared separation
rule; the step-handler file and the two new `.bb`/`.sh` CLI drivers are
acceptance wiring and Babashka/bash respectively — Babashka/bash have no
mutation/CRAP/DRY wired, BL-472 deferred, and this pass records that
degraded fallback explicitly rather than implying they ran). The CLI
drivers' own dispatch logic (`recover`/`prompt`/`bounce` query branches in
`bl1254ExpediteDecisionCli.bb`) is exercised by both the 9/9 acceptance run
and the BL-113 mutation pass above, which mutates the very Example values
those branches are driven with.

## Verdict

CONFIRMED (unchanged from coder/architect). One equivalent mutant recorded
above; no test gap, no defect, no ledger write. Forwarding to documenter.
