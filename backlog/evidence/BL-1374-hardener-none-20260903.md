# BL-1374 hardener pass — 2026-09-03 — NONE

Role: hardender. Ticket: BL-1374 (a sync merge is not credited with its
passengers).

Received via the same architect batch as BL-1360/BL-1367/BL-1376/BL-1377/
BL-1378 (merge `16fd7b8854`, architect commit `31f43a2841`). This ticket has
no `Scenario Outline` in its feature file (plain `Scenario:` only — BL-113
soft Gherkin mutation is inapplicable, confirmed by `grep -c "Scenario
Outline:" specs/features/BL-1374-a-sync-merge-is-not-credited-with-its-
passengers.feature` returning 0).

Ran this ticket's own test/property/acceptance suites as part of the batch's
combined pass (see `backlog/evidence/BL-1360-BL-1367-BL-1374-BL-1376-BL-1377-
BL-1378-hardener-batch-20260903.md`):
- `test_bl1374_sync_merge_passengers.sh`: ALL PASS (16 assertions across 5
  scenarios).
- `bl1374_sync_merge_passengers_property_runner.bb`: ALL PROPERTIES HOLD (24
  fixture runs).
- Acceptance (`run_acceptance.sh` on
  `BL-1374-a-sync-merge-is-not-credited-with-its-passengers.feature`): 4/4
  pass.

The ticket's own diff (`land_step_lib.bb`'s path-scoped passenger-detection
logic, `.bb` code with no wired mutation/CRAP/DRY tool per
engineering.prompt) is already covered by a hand-authored fixture suite
(the `.sh` above) built by the coder to exercise the trap the ticket names
(a `--cc` NAME list naming a path the merge did not actually write a line
at) — reviewed the fixture shapes and found the coverage exhaustive for the
ticket's own scope: clean auto-merge (no entanglement), genuine
entanglement (refused, naming sibling and path), and the `--cc` trap
scenario specifically.

No defect found. No hardening action needed for this ticket beyond what the
architect's own commits already carry — this is an explicit NONE per
Article 4.4.

Forwarding to documenter.
