# BL-1057 — hardener pass

Merged architect's clean review (`30d42093e1`) into the hardener worktree.

## Tooling fallback (per the ticket's own note)

Implemented in Babashka (`swarmforge/scripts/host_switchover_doctor.bb` +
`host_switchover_doctor_lib.bb`) — no mutation/CRAP/DRY tooling wired for
this lane (engineering.prompt, Startup Tools). Gate is its own unit +
property suite. Recording the degraded fallback explicitly per this
ticket's own note, not implying Stryker/CRAP ran.

## Suite verification, re-run live (not trusted from the coder/architect's
own evidence)

- `bb swarmforge/scripts/test/host_switchover_doctor_lib_test_runner.bb`:
  **ALL TESTS PASSED**.
- `bb swarmforge/scripts/test/bl1057_host_switchover_doctor_property_runner.bb`:
  **ALL 60 RUNS PASSED**
  (`{:ok 221, :blocked 81, :missing 89, :oracle-ok 221, :oracle-blocked 81,
  :oracle-missing 89, :stale 29, :oracle-stale 29}`) — read the assertion
  set myself: invariant 1 (never writes) via a before/after fingerprint of
  the whole inspected tree (content + mtime), invariant 2 (one verdict per
  declared location, no duplicates, no unknown verdict), invariant 3 (every
  non-OK finding names both a concrete path and a remediation string
  actually present in the rendered report text), plus an independent
  ORACLE that recomputes the expected verdict from the generator's own
  planted state and compares against the reported one — this is what
  catches a classification bug a purely structural check would miss (the
  property file's own comment names the exact near-miss this guards:
  prefix comparison with no separator letting a STALE root read as OK).
  Reach is asserted per verdict class (`oracle-ok`/`oracle-blocked`/
  `oracle-missing`/`oracle-stale` all >0), not merely hoped for. No coverage
  gap found worth adding to; this property test is already thorough enough
  that a further hand-written unit test would only restate it.
- `specs/pipeline/scripts/run_acceptance.sh` on the feature: **11/11**.
- BL-113 Gherkin soft mutation on both `Scenario Outline`s
  (`Each host-pinned location gets exactly one verdict`,
  `The exit code says whether this host needs attention`): **12/12 and
  6/6 killed respectively, 0 survived, 0 errors**, manifest embedded
  in-file.
- `required_wiring` (`docs/index.md` links `how-to/BL-1057-host-switchover-doctor.md`):
  confirmed present.
- CLI thin-wrapper check: `host_switchover_doctor.bb`'s `-main` is argument
  parsing, `--json`/`--inventory` branching, and I/O only — every verdict,
  the inventory itself, and the report text all live in the unit- and
  property-tested `host_switchover_doctor_lib.bb`, matching the CLI
  thin-wrapper rule.

## Orphaned processes / leaked fixtures

None — this ticket's suites are pure Babashka processes with no
backgrounded daemons or tmux servers; no cleanup needed beyond the normal
`pgrep` check (clean).

## Verdict

Hardened within the tooling this project has for `.bb` code: both suites
re-run and green, BL-113 clean on both Outlines, required_wiring confirmed.
No gap found worth adding a test for — the property suite's own oracle
design already covers the invariant space thoroughly. Forwarding to
documenter.

— By hardender.
