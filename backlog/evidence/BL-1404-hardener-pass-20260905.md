# BL-1404 — hardener pass, 2026-09-05

Ticket: BL-1404-recorded-waive-silences-escalation
Commit reviewed: 16df51de21 (cleaner) / bec8a53c10 (architect, NONE pass)

## Result: NONE — no defect found

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `bash swarmforge/scripts/test/test_babysitter_check.sh` (regression + 4 new) | 21/21 |
| `bb swarmforge/scripts/test/bl1404_waive_silences_escalation_property_runner.bb` | ALL PROPERTIES HOLD, 500/500 each of P1/P2/P3, coverage `{:has-waived-crit 206, :has-unwaived-crit 409, :no-waives-at-all 263}` |
| `node specs/pipeline/cli.js specs/features/BL-1404-...feature` | 4/4 |
| `node specs/pipeline/cli.js specs/features/BL-1344-...feature` (regression) | 7/7, unaffected |
| `bb swarmforge/scripts/test/bl1344_waive_lib_test_runner.bb` (regression) | ALL PASS, unaffected |
| `grep -n decide-escalations swarmforge/scripts/*.bb` | one call site, fixed |
| `bl1404WaiveSilencesEscalationSteps.js::registerSteps` present | yes (required_wiring) |

No leaked processes/fixture roots after any run (checked via `pgrep` and a
fresh-mtime `/tmp` scan before/after).

## No BL-113 gherkin mutation (no Scenario Outline)

The feature is four plain `Scenario:` blocks, no `Scenario Outline:` /
`Examples:` — the wrapper would report `inapplicable` (BL-638), not a real
pass. Per the BL-638 fallback, the hand-authored surgical mutation is the
coder's own property test P1: it drives the real combined pipeline and,
when broken to feed `decide-escalations` the pre-fix raw `findings` (the
EXACT single-line mutation this parcel's diff is), fails 412/500 generated
cases. Re-ran it live in this worktree (unmodified — see the "no code
changed" note below): confirmed clean (all pass) against the actual fixed
line. This is the mutation sweep BL-638 calls for, already present and
already verified non-vacuous by the coder's own break-then-restore record.

## Diff review

The fix is exactly the one line the ticket names:
`decide-escalations findings` -> `decide-escalations nudgeable`
(`babysitter_check.bb:1334`). Confirmed by reading `partition-findings`
(`babysitter_waive_lib.bb:140-157`) that `nudgeable` (`:to-nudge`) equals
`(vec findings)` — same order, same content — exactly when the waive store
is unusable, so the unusable-store-escalates-everything bound (invariant 2)
holds automatically with no separate branch to keep in sync, matching both
the coder's and architect's own trace. `grep -n decide-escalations
swarmforge/scripts/*.bb` confirms this is the only call site (no sibling
left unfixed).

## Design/CRAP/DRY

No production code changed by this pass. Babysitter/babysitterd has no
mutation/CRAP/DRY tooling wired (BL-472 deferred, cleaner already recorded
this fallback); gated by the unit/property/acceptance suites above.

## Verdict

No defect. Forwarding unchanged to documenter.
