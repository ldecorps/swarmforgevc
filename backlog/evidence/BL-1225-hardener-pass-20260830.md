# BL-1225 — hardener pass, 2026-08-30

Part of a combined batch pass with BL-1252 and BL-1218 (one architect batch,
one union mutation/test pass per role instructions); recorded per-ticket to
respect the one-commit-per-ticket scope gate. See also
backlog/evidence/BL-1252-hardener-pass-20260830.md and
backlog/evidence/BL-1218-hardener-pass-20260830.md.

No `extension/src/**/*.ts` touched — Babashka surface, no
mutation/CRAP/DRY wired (Engineering Rules, Startup Tools). No
`Scenario Outline` in the feature, so Gherkin mutation is `inapplicable`
(BL-638), not a pass — fell back to hand-authored surgical mutation on the
two new pure pieces in `build_freshness_lib.bb`, per the BL-567 pattern.

## Mutant 1: bring back the truncating `:out`/`:err`
Reverted `operator-log-spawn-opts` to the pre-ticket shape:
`{:out (str log-file) :err (str log-file) :dir project-root}`.
`bb swarmforge/scripts/test/build_freshness_lib_test_runner.bb` immediately
produced 4 FAILUREs (":out is never a bare path string", the stdout/stderr
target assertions). Also re-ran
`extension/test/bl1225SyncRestartTrailInvariants.property.test.js`: 2 of 3
properties failed non-vacuously. Restored the file, confirmed `git diff`
empty and `ALL TESTS PASSED`.

## Mutant 2: drop the caller-attribution wiring
Removed the `:extra-env {"SWARMFORGE_DAEMON_START_CALLER" ...}` map from
`restart-handoffd-group!` in `build_freshness_cli.bb`. The required-wiring
unit checks caught it immediately (2 FAILUREs: the literal-presence check
and the "value comes from the lib, never a second literal" check).
Acceptance did NOT catch this one (a wiring gap the unit test is scoped
for, not the feature's 3 scenarios) — noted, not a defect: the unit test is
the correct owner of this specific assertion (BL-654 required_wiring).
Restored the file, confirmed `git diff` empty.

## Suites (final, clean state)
- `build_freshness_lib_test_runner.bb`: `ALL TESTS PASSED`.
- Property lane (3 properties): all pass.
- Acceptance (`run_acceptance.sh` on the feature): 3/3 passing.
- No orphaned test/mutation processes before or after this pass.

By hardener.
