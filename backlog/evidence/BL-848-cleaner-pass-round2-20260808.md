# BL-848 cleaner pass (round 2) — 2026-08-08

## Scope

QA bounce round 2 (`backlog/evidence/BL-848-qa-bounce-round2-20260808.md`, D1)
blamed cleaner for forwarding coder's bounce-fix commit (`4eaa77594b`)
unchanged to architect with no committed trace of its own review — per
Article 4.4, indistinguishable from the stage never having run. This is that
review, on the same delta: `swarmforge/scripts/operator_runtime.bb` and
`swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh`.

## Review verdict: NONE — no cleanup changes needed

- **CRAP / structure**: `git-log-main`'s format string and parse widened from
  3 to 4 `%x1f`-delimited fields to carry `%cd`; `resolve-main-commits` takes
  the sweep's `now` as an explicit fallback input rather than reading a clock
  itself, keeping it pure and testable. `ms->ymd` is a small, private,
  single-purpose helper — no branching, no nested conditionals. No CRAP
  concerns on this delta.
- **DRY**: `ms->ymd` (epoch-ms -> YYYY-MM-DD, local zone) duplicates the
  *convention* of `hotfix_ledger_update.bb`'s `today` (`LocalDate/now`
  str-formatted) but not its code — the two take different inputs (arbitrary
  epoch-ms vs. wall-clock now) and live in different `.bb` files with no
  shared require between them. Both are 1-line private fns. Not worth a
  shared module for this; importing across these two scripts for a
  three-line date formatter would add coupling the current architecture
  doesn't otherwise have. Left as-is.
- **Encapsulation / boundaries**: change stays entirely inside
  `operator_runtime.bb`'s existing private (`defn-`) functions
  (`git-log-main`, `resolve-main-commits`); no new public surface, no
  boundary crossed.
- **Mutation-site size** (BL-485): `node extension/out/tools/mutation-site-count.js
  swarmforge/scripts/operator_runtime.bb` — script targets compiled
  `out/**/*.js` (Stryker's TS/JS scope) and reports 0 sites for a `.bb` file;
  not applicable to Babashka. Per the Startup Tools / Language tool table,
  Babashka mutation/CRAP/DRY tooling is not wired (BL-472, deliberately
  deferred) — the actual gate for `.bb` is its own unit-test suite, run
  below.
- **Coverage of the changed behavior**: the new wiring-test assertion
  (`test_operator_runtime_hotfix_certification_sweep.sh`, check "01: the new
  entry's detected_at is a real YYYY-MM-DD date, never blank") reads the
  sweep-appended entry back out of the real ledger file — it is the changed
  behavior's own regression check, not vacuous. No additional test needed.

## Checks run this pass

- `bash swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh`
  — 13/13 PASS (includes the new detected_at assertion).
- `bash swarmforge/scripts/test/hotfix_ledger_update_test_runner.sh` — 20/20 PASS.
- Scope discipline (BL-506): `git diff --name-only ca33c97b HEAD` — only
  ticket-relevant files (active ticket YAML, three evidence files, feature
  file, the two coder delta files). Untracked
  `swarmforge/scripts/operator_path_lib.sh` (known pre-existing debt, BL-796)
  confirmed not staged, left untouched.

## Forward

No cleanup changes required on this delta. Forwarding to architect.
