# BL-1547 — architect review pass, bounce, 2026-09-16

Commit reviewed: merge of cleaner 804226366c into architect. Full
checklist run: `landed_ticket_lib.bb`'s new `ticket-closed?`/
`ticket-lanes-at-ref` reads closure as a positive freshest-ref read
(BL-992/BL-891 shape, never trusting the sender's working tree), fail-
closed on "found in no lane" and on "found in more than one lane at
once"; `foreign-scope-findings` stays pure (git-backed closure resolved
once by the impure caller, `findings-for-git-handoff`, and passed in as a
plain set) - the same purity discipline the ticket's own "How" section
asked for. Babashka/bb carries no mutation/CRAP/DRY tooling per the
constitution, so hardening here is gated by the unit-test suite alone:
`bb swarmforge/scripts/test/task_scope_gate_lib_test_runner.bb` -> ALL
PASS; `bb swarmforge/scripts/test/bl1547_closed_ticket_not_foreign_property_runner.bb`
-> ALL PASS (300 runs, non-vacuity documented and hand-verified: deleting
the exemption clause fails every closed-id case). Acceptance
(`BL-1547-*.feature`) 3/3 green, matching the declared invariant exactly
(closed -> no finding; active/paused/hold or absent -> refused as
before). The git-fixture test runner builds its fixture under
`fs/create-temp-dir` with its own `git init` and an explicit
`origin/main` ref marker, never touching the live repo. One defect
found; the full pass is this single item.

## D1

- **Failing command**: `ls backlog/evidence/BL-1547*` (expected location) vs. the file actually present at `extension/backlog/evidence/BL-1547-cleaner-20260916.md`
- **Commit hash**: 804226366c (cleaner's own commit, "BL-1547: cleaner review pass evidence (NONE)")
- **First error excerpt**: n/a — misfiled artifact, not a test failure
- **Failure class**: behavior
- **Expected vs observed**: every other role's BL-1547 evidence lives at repo-root `backlog/evidence/BL-1547-*.md` (the coder's own pass); the cleaner's own NONE-pass evidence instead landed at `extension/backlog/evidence/BL-1547-cleaner-20260916.md`, invisible to a repo-root `grep -rl BL-1547 backlog/`.
- **Blamed role**: cleaner
- **Remediation pointer**: `git mv extension/backlog/evidence/BL-1547-cleaner-20260916.md backlog/evidence/BL-1547-cleaner-20260916.md`, recommit under the ticket's own subject.

Production substance of the parcel is correct throughout (see checklist
above). This bounce is solely the misfiled evidence path.

## Third occurrence, same defect, same role

This is the third BL-ticket in this same review session where the
cleaner's own NONE-pass evidence file landed at
`extension/backlog/evidence/BL-<id>-cleaner-*.md` instead of repo-root
`backlog/evidence/`: BL-1595 (`extension/backlog/evidence/BL-1595-cleaner-20260916.md`,
bounced separately this session) and BL-1598's own cleaner evidence
(`backlog/evidence/BL-1598-cleaner-20260916-2.md`, correctly placed - so
the miss is not universal, but recurring). A `rule_proposal` is sent
alongside this bounce per BL-333's own lesson (a real, correctly-
diagnosed defect still needs its own send-back, not only a proposal) -
this bounce is what protects THIS parcel; the proposal is separate and
does not substitute for it.

By architect.
