# BL-1423 — architect pass, 2026-09-05

Ticket: BL-1423-the-standing-bb-suite-runs-again
Role: architect
Commit reviewed: bc84a4fd2d (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1423StandingSuiteRunsAgainSteps.js`) and
  full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in both.
  The production change is two data rows in
  `swarmforge/scripts/test/suite-manifest.tsv` — no code, no webview, no
  VS Code API, no secrets. A co-change report is not meaningful for a
  pure-data-row change and was skipped.
- **Architecture**: this ticket touches no module boundary at all — it
  registers two pre-existing, unmodified test files in a membership list
  an existing consumer (`run_bb_suite.sh`) already reads. No new
  abstraction, no new dependency direction.

## Sole invariant, verified by hand

"This parcel's diff of `suite-manifest.tsv` is exactly two added rows:
every pre-existing row is byte-identical, none is removed or re-laned."
Read the commit's own diff (`82145fa26e`): exactly two `+` lines added at
the file's existing alphabetical position, zero `-` lines, zero context
changes. Confirmed by eye — this is the entire invariant and it holds
exactly.

## Independently re-verified the substance, not just the diff shape

- `bb suite_inventory_cli.bb swarmforge/scripts/test` → `suite inventory:
  ok - 495 test file(s), 491 standing, 4 excluded with a dated reason`,
  exit 0 — the first clean inventory since 2026-09-02, confirmed myself.
- `bash run_bb_suite.sh --inventory` → same clean result, exit 0.
- Ran BOTH newly-registered tests myself, from a detached shell
  (`env -u TMUX`, per the ticket's own warning against running a
  daemon-booting test from an agent pane):
  - `bb handoffd_supervisor_startup_grace_test_runner.bb` →
    `ALL TESTS PASS`
  - `bash test_handoffd_outbox_vanished_parcel_wiring.sh` → `ALL PASS`
    (01-04); a stderr line about a missing `control-ambulance.json` on
    first attempt is the fixture's own pre-existing self-healing fallback
    (falls back to `mkdir -p` then retries), not a failure — the test
    still reports ALL PASS.
- Neither test file's own content was touched by this parcel (confirmed:
  the diff is manifest-only) — a standing row was added to unmodified,
  independently-passing tests, exactly as directed.

## Acceptance wiring

Feature declares 2 scenarios / 3 scenario runs (scenario 01 plus scenario
02's 2-example Outline). Independently ran
`bl1423StandingSuiteRunsAgainCli.sh` directly for all 3 (`inventory`,
`rows-for handoffd_supervisor_startup_grace_test_runner.bb`, `rows-for
test_handoffd_outbox_vanished_parcel_wiring.sh`) — all three returned
exactly the expected shape (clean inventory; exactly one `standing` row
with empty date/reason; `listed: true` for both files). `registerSteps`
export present per the ticket's `required_wiring` anchor (BL-1371); the
two manifest-row anchors are satisfied by the parcel's own diff, as the
ticket itself notes (BL-1235's fail-open shape, same precedent as BL-1239's
backfill) — confirmed by grepping both filenames in the current manifest.

## Verdict

Architecturally compliant (trivially — no architecture surface touched).
No invariant violation, no correctness defect. Forwarding to hardener.
