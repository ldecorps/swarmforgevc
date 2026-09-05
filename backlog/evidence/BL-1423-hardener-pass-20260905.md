# BL-1423 — hardener pass, 2026-09-05

Ticket: BL-1423-the-standing-bb-suite-runs-again
Commit reviewed: bc84a4fd2d (cleaner) / 2c1225de80 (architect, NONE pass)

## Result: NONE — no defect found; BL-113 mutation clean (2/2 killed)

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `bb swarmforge/scripts/test/suite_inventory_cli.bb swarmforge/scripts/test` | `suite inventory: ok - 495 test file(s), 491 standing, 4 excluded with a dated reason` — clean, confirmed independently |
| `bb swarmforge/scripts/test/handoffd_supervisor_startup_grace_test_runner.bb` | ALL TESTS PASS |
| `env -u TMUX bash swarmforge/scripts/test/test_handoffd_outbox_vanished_parcel_wiring.sh` | ALL PASS (01-04) |
| `node specs/pipeline/cli.js specs/features/BL-1423-...feature` | 3/3 scenario runs |
| `bb swarmforge/scripts/test/suite_inventory_lib_test_runner.bb` (regression) | ok |
| `git show --stat 82145fa26e -- suite-manifest.tsv` | exactly `1 file changed, 2 insertions(+)`, no deletions — invariant 1 confirmed directly on the parcel's own commit |
| `grep -c` both filenames in `suite-manifest.tsv` | 1 each (required_wiring) |
| `bl1423StandingSuiteRunsAgainSteps.js::registerSteps` present | yes (required_wiring) |

No leaked processes/fixture roots after any run (checked via `pgrep` and a
fresh-mtime `/tmp` scan before/after).

## BL-113 soft gherkin mutation (one Scenario Outline, 2 examples)

Ran `specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1423-the-standing-bb-suite-runs-again.feature <fresh
mktemp under ./tmp> specs/pipeline/steps/index.js soft` (all 4 positionals
explicit, workdir removed after). Result: **2 mutants, 2 killed, 0
survived** (the `<file>` example cells, single-letter case flips) — clean.
Manifest stamp committed alongside this evidence.

## Nature of this parcel

A pure data-only change (two manifest rows, alphabetically placed,
`standing` lane, empty date/reason) restoring `run_bb_suite.sh`'s ability
to run at all since 2026-09-02. Neither hotfix test file, nor
`suite_inventory_lib.bb`, nor the stamp-off template is touched — matches
the ticket's own tight scope. No Babashka/shell production logic changed,
so there is nothing beyond the manifest diff itself and the two tests'
independently-passing status to harden; both were re-verified live here,
matching all three prior roles' own independent runs.

## Verdict

No defect. Forwarding unchanged (plus the committed mutation-manifest
stamp) to documenter.
