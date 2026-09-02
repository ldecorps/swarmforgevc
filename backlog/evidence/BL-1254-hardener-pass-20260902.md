# BL-1254 — hardener pass, 2026-09-02

Reviewed commit `efcdfb1e47` (architect clean sweep), merged into hardender
as `73f8a636c2`. Review-only BL-848 stamp-off parcel for three already-landed
hotfixes (3f4f69ec1b, 70c5e0e5b0, 5de352ed1d); this parcel's own chain
(coder re-walk, cleaner, architect) touched only evidence files — the
reviewed scenario-06 step handler landed earlier (36d8fd08b4) and is
untouched here. No hotfix Babashka source touched.

## Load / process hygiene
- `uptime`: load average ~1.9 on 20 cores — quiet.
- `pgrep -fl 'node --test|stryker'`: no strays before starting.

## Checks run (independent re-run)
- `bb swarmforge/scripts/test/expedite_lib_test_runner.bb` — ALL PASS.
- `bash swarmforge/scripts/test/test_expedite_cli.sh` — ALL PASS, including
  the no-verdict-recovery and bounce-without-reason cases; BL-782's
  known-failing cases did not fire (pre-existing, not this parcel's to fix,
  per qa_e2e_procedure item 4).
- `node specs/pipeline/cli.js
  specs/features/BL-1254-swarm-stamp-expedite-no-verdict-chain.feature` —
  10/10 pass, matches coder/cleaner/architect evidence.
- Property lane (`vitest run --config vitest.properties.config.mjs`):
  `bl1254LedgerCertificationNeedsAHuman.property.test.js` (2/2) and
  `bl1254MissingVerdictNeverBounces.property.test.js` (4/4) — 6/6 pass.
- BL-113 soft Gherkin acceptance-mutation gate, run with all 4 positionals
  explicit against a fresh `mktemp` workdir under `./tmp/` (removed after):
  scenario index 2 ("A bounce must carry an actionable reason...") was
  correctly SOFT-SKIPPED — its manifest entry already records a clean
  6/6 kill from 2026-08-30 with an unchanged stamp (BL-460's soft-skip
  behavior, not a broken run). Scenario index 0 ("A stage that exits
  without a verdict is re-invoked while recoveries remain") ran fresh:
  **5/6 killed, 1 survived.**
  - Survivor m5: `examples[2].attempt` mutated `3 -> 12` (the "fails the
    ticket closed" row). Investigated per the BL-234/BL-1081 equivalence
    discipline: the step handler's `decide()` shells out to the REAL
    `bl1254ExpediteDecisionCli.bb`, which calls the landed
    `should-recover-missing-verdict?` against `max-missing-verdict-recoveries
    = 2` — not a JS reimplementation. Verified empirically, not just by
    reading the code:
    `bb specs/pipeline/steps/lib/bl1254ExpediteDecisionCli.bb recover
    '{"attempt":2,"parsed":null}'` and the same call with `"attempt":11`
    both return `{"max":2,"recover":false,...}` byte-identical, while
    `"attempt":1` returns `recover:true`. The boundary is `attempt < 2`;
    every value at or past it is indistinguishable to the real landed
    logic. This is an ACCEPTED EQUIVALENT mutant, not a test gap: no
    assertion could ever separate attempt=3 (the Outline's witness) from
    attempt=12 without pinning an arbitrary number the ticket's own
    constraints forbid designing around (this parcel must not redesign or
    re-litigate the recovery bound). Per Article 4.4/BL-234, this scenario's
    manifest entry correctly stays unwritten this pass (BL-502: only a
    fully-clean scenario, zero survivors, is recorded) — reverted the
    resulting timestamp-only manifest diff since nothing informative
    changed for scenario 2 and scenario 0 has no clean entry to add.
- CRAP/DRY: N/A. This parcel touches zero `extension/src/*.ts` files (the
  ticket's own required_wiring anchors are Babashka lib calls, already
  landed outside this parcel) and zero new JS this pass — only evidence
  files were added by coder/cleaner/architect/hardener. Babashka itself has
  no mutation/CRAP/DRY wired (BL-472, deferred) — the CLI/lib suites above
  are the degraded fallback, already run.
- Invariants (independently re-checked): 1) `git status --porcelain` over
  the four hotfix files — clean, none touched. 2) all three ledger rows
  read `state: stamp-open`, `human_decision: null` — unchanged by this
  pass. 3) scanned the feature file — no scenario asserts the superseded
  70c5e0e5b0 same-stage bounce.

## Lessons
No new lesson to propose — the equivalence found here is a straightforward
instance of the already-documented BL-234/BL-1081 pattern (a real subprocess
call past its own decision boundary), not a new failure class.

## Verdict
Clean sweep — the one mutation survivor is an accepted equivalent, recorded
above with its empirical evidence. No defect found. Forwarding to
documenter.
