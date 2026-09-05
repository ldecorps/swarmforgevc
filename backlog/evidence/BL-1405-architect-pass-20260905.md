# BL-1405 — architect pass, 2026-09-05

Ticket: BL-1405-hand-built-land-records-approval
Role: architect
Commit reviewed: 4c5ddcc9ad (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1405HandBuiltLandRecordsApprovalSteps.js`) and
  full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in both.
  The change is a new thin CLI (`record_land_approval.bb`) plus its pure
  testable core (`land_approval_cli_lib.bb`) over an EXISTING,
  UNMODIFIED writer (`land_step_lib.bb/record-land-approval!` — confirmed
  by diff: `land_step_lib.bb`/`land_step_cli.bb` are untouched by this
  parcel) and a Node step handler using standard modules only — no webview,
  no VS Code API, no secrets, no browser storage.
- **Co-change report**: all new files, self-referential coupling only
  (the CLI, its lib, its tests, its step handler) — nothing pre-existing
  to disturb.

## Invariants Review (BL-633/654)

Ticket declares two invariants:

1. **One writer**: confirmed by reading the diff that `land_step_lib.bb`
   and `land_step_cli.bb` are byte-for-byte unchanged — the new CLI calls
   the SAME `record-land-approval!` the ordinary land step already uses,
   and `already-recorded?` (the CLI's dedup check) only READS the store via
   an exact-field substring match against the two quoted JSON fields the
   writer itself produces, using the same `short` truncation on both the
   read and write side — never a second serializer of the record's shape.
2. **A record grants nothing on its own**: `record-land-approval!` (pre-
   existing, BL-1334) refuses and writes nothing when either sha is
   missing (confirmed unchanged); the CLI's own `-main` additionally
   refuses at exit 2 before ever calling the writer when `short` returns
   nil for either argument. `is_qa_ancestor.sh` (also unmodified) is what
   decides "approved" — the CLI never reimplements that predicate, it only
   shells out to the same script every other consumer uses
   (`print-verdict!`).

Independently re-ran the coder's property test:

```
generator coverage: {:p1-shared-commit-diff-source 240, :p2-invalid-commit 141, :p2-invalid-source 159}
bl1405 hand-built-land-records-approval properties: 300 runs each
ALL PROPERTIES HOLD
```

and the shell CLI test suite:

```
bash test_record_land_approval_cli.sh → 5/5 PASS (matches qa_e2e items
  1-5 exactly: unapproved-before-recording, record-then-approved,
  missing-sha-refuses-nothing-written, unapproved-source-still-refuses,
  duplicate-run-writes-one-line)
```

## Acceptance wiring

Feature declares 4 scenarios / 5 scenario runs (Scenario Outline with 2
examples + 3 plain scenarios). Independently drove
`bl1405HandBuiltLandRecordsApprovalSteps.js::registerSteps` against all 5
runs with my own harness (real git fixture, real CLI, real predicate
subprocess) — all passed. `registerSteps` export present per the ticket's
`required_wiring` anchor (BL-1371). No consumer `required_wiring` anchor
is declared for the CLI itself, per the ticket's own note (its consumer is
QA's hand-built land procedure, prose landed with this mint under BL-1235
fail-open) — the acceptance scenarios driving the real predicate end-to-end
is what proves reachability, and I independently confirmed that reachability
myself rather than taking the note at its word.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. This closes a downstream
consequence of the hand-built-land pattern I surveyed and flagged to the
specifier earlier today (`architect-qa-landing-difficulty-survey-20260905.md`)
— it fixes the false Article 4.2 CRIT that follows a hand-built land, not
the two root causes (sibling-list inflation, cross-ticket entanglement)
that force QA into hand-building lands in the first place; those remain
open questions for the specifier. Forwarding to hardener.
