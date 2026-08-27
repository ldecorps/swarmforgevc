# BL-938 architect pass — 2026-08-19

## Reviewed commits
`dd1245807ed57c4d383a660f507184e965c062cd` ("BL-938: fixture declares a
rotation-router pack, fixing the red aged-note wiring test", By coder) and
`1e0ff2e91fbbb6fba51a9aca5b13b91e45ccf142` ("BL-938: acceptance coverage
for the aged-note rotate wiring fixture fix", By coder), forwarded
unchanged by cleaner (`73d304232` is a pure merge commit — no cleaner-authored
diff on top; confirmed no cleaner edits to either BL-938 file).

Full parcel diff (`git diff dd1245807~1 1e0ff2e91f`) touches exactly 3
files: `swarmforge/scripts/test/test_handoffd_aged_note_rotate_wiring.sh`,
`specs/pipeline/steps/bl938AgedNoteRotateFixtureRotationRouterSteps.js`
(new), `specs/pipeline/steps/index.js`.

## Checks run (complete inventory, not first-failure-stop)

1. **Dependency-rule gate**: no `extension/` file is in this parcel's diff
   (confirmed above), so per-parcel mode has nothing to scan (verified —
   passing the 3 changed files errors "can't open", expected: they resolve
   relative to `extension/` cwd and none live under it). Ran full-repo mode
   anyway as a defensive check, same as BL-937's precedent: reports the
   same pre-existing 3-edge `acyclic` cycle in `telegram-front-desk-bot.ts`/
   `telegramCursorOperatorExec.ts`/`telegramCursorOperatorLiveness.ts`,
   already tracked at `backlog/paused/BL-759-...yaml`. None of those 3
   files are touched by this parcel. Not this parcel's defect, not
   blocking.
2. **Co-change report**: ran against all 3 changed files. The shell fixture
   and the new step-handler file show only frequency-1 co-changes (below
   the suspected-coupling threshold of 3) — nothing flagged. `index.js`
   shows many high-frequency "SUSPECTED COUPLING" hits, but it is a
   registry hub every ticket's step-handler file appends a line to (this
   parcel's own 1-line addition is the same shape) — structural noise from
   being a hub file, not genuine logical coupling. No action warranted.
3. **Invariant 1** ("the fixture is corrected, never the gate... no edit to
   handoff_lib.bb, mono_router_lib.bb or rotate_to_role.bb/.sh"): confirmed
   via `git show --stat` on both commits — zero production `.bb` files
   touched across the whole parcel. Read `resolve-rotation-router-mode?`,
   `rotation-router-from-identity?`, and `conf-rotation-router?` in
   `mono_router_lib.bb` directly and confirmed the fixture's new lines
   (`config rotation router` in `swarmforge.conf`, `rotation\trouter` in
   `swarm-identity`) are literal matches for what the gate actually reads —
   not a placeholder (the BL-874 lesson) — and match the sibling
   `test_handoffd_starve_rotate_wiring.sh` fixture byte-for-byte on this
   point, which the commit message claims as precedent.
4. **Invariant 2** ("the test keeps asserting what it asserts today...
   does not renegotiate the behaviour under test"): confirmed via
   `git show dd1245807` — the shell-fixture diff is pure insertion (27
   lines added, 0 removed), entirely inside `setup_common_fixture`; every
   existing assertion in the file is untouched. Independently ran both
   sibling wiring tests
   (`test_handoffd_priority_rotate_wiring.sh`,
   `test_handoffd_starve_rotate_wiring.sh`) myself under the real
   `/bin/bash` — 4/4 and 4/4 PASS, confirming the fix didn't collaterally
   affect them.
5. **Invariant 3** (non-vacuity — "with aged-note actionability
   neutralised... it must still fail"): NOT hand-waved from the commit
   message. Independently reproduced myself: made a scratch copy of the
   fixture with `note_actionable_after_ms` set far beyond the poll window
   and ran it under the real daemon — it correctly FAILs with "the resident
   was never rotated to specifier for its aged note" (no `chase-rotate
   specifier` line in the daemon log). Reverted/deleted all scratch
   artifacts; working tree stayed clean throughout (confirmed via
   `git status`).
6. **Ran the actual fixed test**: `test_handoffd_aged_note_rotate_wiring.sh`
   itself — 2/2 PASS ("A (F1 ordering-key wiring)", "B (F1 fresh-note
   guard)"), no `not-a-rotation-router` in the log. Matches the ticket's
   own `qa_e2e_procedure` step 2 claim.
7. **Ran the new acceptance feature end to end**: `node
   specs/pipeline/cli.js specs/features/BL-938-....feature` — all 4
   scenarios pass, including scenario 03 (the non-vacuity scenario, ~40s —
   it genuinely waits out the full poll window rather than asserting
   something trivial) and scenario 04 (the negative case: with the pack
   declaration removed, the daemon still logs `not-a-rotation-router` and
   never rotates — confirms BL-931's gate is left exactly as strong as
   before, per invariant 1's spirit).
8. **BL-654 non-encodability claim for all 3 invariants**: the commit's own
   reasoning (invariants 1/2 quantify over the diff's own scope, not a pure
   function's input space; invariant 3 quantifies over a bash integration
   test's pass/fail behaviour, no meaningful fast-check input domain) is
   sound and consistent with this codebase's own testability boundary
   (Babashka/bash have no mutation/CRAP/DRY wired, gated only by their own
   suite). Accepted; all three were instead independently re-verified by me
   procedurally above (items 3-5), not just trusted from the commit
   message.
9. **Property Testing pass**: the parcel touches no pure JS/TS module — a
   bash integration test, a step-handler file driving real subprocesses,
   and a registry-list append. All three are outside the fast-check
   generative-property boundary (same reasoning as invariant 3 above, and
   the same shape as BL-937's precedent). No new property test is
   warranted; none manufactured.
10. **Module boundaries / two-layer architecture**: not implicated — no
    extension host/webview code touched, no I/O ownership changed, no new
    process spawned bypassing tmux, no secrets, no webview storage.
11. **Correctness read**: no defect spotted beyond the invariants above.
    The step-handler's own documented judgement call (asserting on
    `PASS:`/`FAIL:` output lines rather than the shell script's process
    exit code, to route around a pre-existing, out-of-scope teardown race
    in `cleanup_a`/`cleanup_b`) is reasonable, explicitly not silently
    worked around, and already raised by the coder via `note` for
    specifier/coordinator triage per BL-937's own precedent — not this
    parcel's defect to fix.

## Verdict
No architecture violation, no invariant violation, no correctness defect.
All three declared invariants hold, independently re-verified (including
invariant 3's non-vacuity, reproduced myself under the real daemon rather
than only trusting the commit message). Forwarding to hardener.

By architect.
