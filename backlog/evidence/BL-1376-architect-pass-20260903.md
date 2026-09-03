# BL-1376 — architect review, pass (2026-09-03)

## Scope reviewed

Cleaner's tip (`bbe763b5e8`), merged into this worktree at
`Merge cleaner bbe763b5e8 for BL-1376. By architect.` (`747747553b`). Only
conflict was additive (`bl1376ExpediteBranchHandoverSteps` require line in
`specs/pipeline/steps/index.js`), resolved by keeping both sides.
`swarmforge/` is Babashka — no mutation/CRAP/DRY wired (BL-472 deferred),
gated by its own unit/CLI/property suites plus the JS mutation-site-count
advisory on the one touched `.js` file, already run by the cleaner.

## Dependency gate / co-change

`cd extension && node out/tools/dependency-gate.js
../specs/pipeline/steps/bl1376ExpediteBranchHandoverSteps.js` — PASSED, no
forbidden edges. Co-change report: entirely in-scope co-changes (its own
lib/CLI/tests, index.js, evidence). No suspicious coupling.

## Architecture read

- `run-branch-name`/`run-branch-owner`/`branch-outstanding` in
  `expedite_lib.bb` stay pure — no `git`/`fs`/`process` call anywhere in
  them (read the source). `expedite_cli.bb::run-branch-facts` is the one
  place that shells out (`git rev-parse`/`git rev-list`), matching the
  pure-core/thin-IO-adapter split the file already uses. `ensure-worktree!`
  now calls `run-branch-name` instead of re-literalling `"expedite/" +
  ticket` — the single-definition shape invariant-adjacent to BL-1360's
  own invariant 3, so the branch prefix has one home.
- Grepped the diff for `merge`/`push`/`checkout`/`publish` calls: none
  added. The handover only reads and reports; nothing added performs a
  land. Matches `qa_e2e_procedure` step 6 and the coder/cleaner's own
  disclosure.
- An absent branch is deliberately treated as a definite nothing (not an
  unreadable check) — a run that refused before creating a worktree left
  no code anywhere, so no phantom leaving is reported. Reasonable design
  call, consistent with the standing `test_expedite_cli.sh` BL-1024d
  check that a refused run claiming nothing stays green (verified: still
  passes).

## Invariants (BL-633/654) — both declared, both covered

1. Silent only on a genuine nothing; an unreadable ancestry check reports
   rather than omits — P1, asserts the item appears exactly when there is
   something to land and never a distance nobody measured. NON-VACUOUS
   (reporting a level branch as outstanding, or omitting the unreadable
   case, both fail P1 per coder evidence).
2. Never claims a land; no merge/push/publish added — P2, asserts no
   producible text matches `landed|merged|pushed|published`, and that the
   two pre-existing leavings still survive. NON-VACUOUS (rendering "-
   landed" fails P2).

Generator reach asserted rather than hoped for: the coder's evidence states
the run fails unless all five branch shapes and both dry-run values were
actually generated — read the runner and confirmed this floor exists (not
just claimed).

## Verification run directly

- `bb swarmforge/scripts/test/expedite_lib_test_runner.bb` — ALL PASS.
- `bash swarmforge/scripts/test/test_bl1376_expedite_branch_handover.sh` —
  ALL PASS (32 checks).
- `bb swarmforge/scripts/test/bl1376_expedite_branch_handover_property_runner.bb`
  — ALL PROPERTIES HOLD (500 runs).
- `bash swarmforge/scripts/test/test_expedite_cli.sh` — ALL PASS, no
  regression in the pre-existing handover checks.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1376-*.feature` — 7/7.
- `specs/pipeline/steps/index.js` — `bl1376ExpediteBranchHandoverSteps`
  registered. No `required_wiring` declared on the ticket, with a stated
  reason (both call sites of `outstanding-work` already exist at mint, so
  any anchor would gate nothing) — read and agree, same shape as BL-1235's
  own documented fail-open exemption.

## Property-testing pass (own section, BL-654 scope boundary)

The two declared invariants are the ticket's obligation and are covered
above. No other touched pure module needs new coverage.

## Correctness read

No defect found. The coder/cleaner's own "surfaced, not swept" note about
BL-1360/BL-1296/BL-1309/BL-1356/BL-1359 parked to `backlog/hold/` by the
BL-1375 expeditor land is the same state I already merged into this worktree
last hop and already flagged as outside this role's remit — not a defect in
THIS parcel, and not re-actioned here.

## Verdict

No defect found. Forwarding to hardener.
