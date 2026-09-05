# BL-1420 — hardener pass, 2026-09-05

Ticket: BL-1420-the-freshness-fixtures-pass-the-registry-guard
Commit reviewed: 6eafb1418b (architect NONE pass)

## Result: found and fixed one BL-113 mutation gap (test-side only)

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1011-...feature` | 8/8 (was 0/8 pre-fix) |
| `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1012-...feature` | 9/9 (was 0/9 pre-fix) |
| `bb swarmforge/scripts/test/bl1011_freshness_attribution_property_runner.bb` (default) | ALL PROPERTIES HOLD, real coverage across all 8 classes |
| `PROPERTY_RUNS=40 bb ...` | ALL PROPERTIES HOLD |
| `node specs/pipeline/cli.js specs/features/BL-1420-...feature` | 6/6 pass |
| `node specs/pipeline/cli.js` on BL-1399, BL-784 (regressions) | 3/3, 3/3 pass |
| `git diff main -- daemon_log_freshness_registry_guard.sh daemon_log_freshness_check.sh` / `git status --short daemon_log_freshness*.conf` | both empty (invariant 3) |
| `npx jscpd` (new helper vs BL-1399's pre-existing fixture) | 0 clones — not a mechanical DRY violation |
| `backlog/standing-reds.tsv` / `property_suite_standing_allowlist.tsv` | neither names this file family |
| leftover process/fixture check (`pgrep`, `git status --short`) | clean before and after every run |

## Independently reproduced the guard's real red/green pair myself

Built a scratch fixture via the real `writeGuardSatisfyingRows` naming
`bl1420-nonexistent-daemon` in `FRESHNESS_REQUIRED` (absent from the
conf), ran the real `daemon_log_freshness_registry_guard.sh` directly:
`FRESHNESS_REGISTRY_GUARD: daemon 'bl1420-nonexistent-daemon' has no row
in freshness.conf`, exit 1 — reproduces invariant 2's red case from
scratch, independent of any fixture's own claimed output.

## Independently reproduced non-vacuity myself (not just trusted), both mechanisms

**Guard-satisfying glob** (`freshnessFixture.js`'s `supervisorNames`):
mutated the filter to match nothing, re-ran BL-1011's acceptance: **0/8**
(the guard's second arm refuses every run again, exactly the pre-fix
state). Restored; confirmed byte-identical via `diff` and `git status
--short` (empty); re-ran — 8/8 again.

**Exit-check in the bb property runner**: mutated `(zero? (:exit
result))` to `(zero? 999)` (always false), re-ran at `PROPERTY_RUNS=8`:
**16 failures** — every run reported `P-checker` and every one of the 8
coverage floors failed (0 runs ever reached the property-evaluation
branch), confirming the exit-check genuinely gates whether properties are
evaluated at all. Restored; confirmed byte-identical via `diff` and `git
status --short` (empty); re-ran — ALL PROPERTIES HOLD, 48 runs, real
coverage across all 8 classes again.

## BL-113 hard gherkin mutation: found and fixed a real gap

One `Scenario Outline` (scenario 04, 3 examples, 2 mutable columns = 6
mutants). First run: **3 survived** — all three `<supervisors>` column
mutants (2→3, 3→10, 2→4).

Root cause, found by reading
`specs/pipeline/steps/bl1420FreshnessFixturesPassTheGuardSteps.js`: the
`<supervisors>` value is captured once by the Given step
(`ctx.supervisorCount = Number(count)`), used to CREATE that many fake
`*_supervisor.bb` scripts in the scratch directory, and the SAME captured
value flows into the Then step's assertion
(`the conf carries exactly <count> supervisor rows...`) via its own
separate regex capture of the identical Examples cell. Because both the
setup and the assertion derive from one Examples cell, mutating that
numeral changes both sides together — the assertion "N+1 rows" still
holds for the new N, so the mutant is invisible. This is the BL-908/
BL-1263 KNOWN_VALUES class from this session's own established rules: a
value "consumed" only by round-tripping through itself proves nothing
about the Outline's own literal.

**Fix (test-side only, no production code touched):** added
`KNOWN_SUPERVISOR_COUNTS`, pinning each `<fixture>` label's own expected
`<supervisors>` count, and asserted `ctx.supervisorCount` against it
(keyed by `fixtureLabel`) in the step that receives both — ahead of the
existing self-referential check, so a mutated `<supervisors>` cell no
longer round-trips against its own construction.

**Re-verification after the fix:**
- Acceptance feature re-run: still **6/6** pass (no assertion weakened).
- BL-113 hard mutation re-run: **6/6 mutants killed, 0 survived** —
  manifest confirms `"Total":6,"Killed":6,"Survived":0,"Errors":0"`.

## Design/CRAP/DRY

No production code changed. Test-file-only fix scoped to one step-handler
file; the new map mirrors the Outline's own Examples table 1:1, same
pattern as the existing `KNOWN_FIXTURES` map.

## Constraints respected

- `git diff --name-only` (this pass) touches only the feature file
  (mutation stamp/manifest) and the step-handler file — no fixture-helper
  file, no source files, no other fixed files' behavior changed.

## Verdict

Real BL-113 gap found and fixed. Forwarding to documenter.
