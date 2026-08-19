# BL-936 architect pass — 2026-08-19

## Reviewed commit
`70900424888409154a2a7e023873782987775980` ("BL-936: declare the BL-805
property fixture a rotation-router pack", By coder, forwarded unchanged by
cleaner).

## Checks run (complete inventory, not first-failure-stop)

1. **Dependency-rule gate**: PASSED, no forbidden edges, on both changed
   files.
2. **Co-change report**: all flagged pairs below the suspected-coupling
   threshold (3) — expected siblings (feature file, step registry, the
   BL-805 shell fixture that took the same BL-931 amendment). Nothing new.
3. **Invariant 1** ("fixture corrected, never the gate; no env bypass/
   force/seam; no edit to `handoff_lib.bb`/`mono_router_lib.bb`/
   `rotate_to_role.bb`/`.sh`"): confirmed via `git show --stat` — the
   3-file diff touches only `bl805RotateGateOnUnfinishedInProcessParcel.property.test.js`,
   the new `bl936...Steps.js`, and `specs/pipeline/steps/index.js`. Zero
   `swarmforge/scripts/` changes, zero other production source.
4. **Invariant 2** ("both properties keep asserting what they assert
   today"): read the property-test diff directly — the only change inside
   the file is two additions to `makeFixture()` (writing
   `swarmforge/swarmforge.conf` with `config rotation router`, and making
   the fake `tmux` binary answer `list-panes` with a fixed pane-command
   line). `SHAPES`, `expectedBlocking`, and both tests' own assertion
   bodies are byte-for-byte unchanged.
5. **`required_wiring`** (fixture builder must actually WRITE the pack
   declaration, not just comment/adjust assertions): confirmed —
   `fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'),
   'config rotation router\n')` is a real write.
6. **Invariant 3** (restored properties stay non-vacuous — property 2 must
   still fail with BL-805's own gate neutralised): independently
   re-verified myself, not just trusting the commit message. Added
   `SWARMFORGE_ROTATE_FORCE: '1'` to `runResidentInvoked`'s env (the same
   documented override the coder used), ran the file: property (invariant
   2) failed cleanly on `handoff-alone`, `got exit 0: rotate: WARNING
   SWARMFORGE_ROTATE_FORCE override set - rotating over unfinished parcel
   left behind: .../case_stuck0.handoff`. Reverted; recompiled unneeded
   (plain JS); reran, confirmed 2/2 green again. Matches the coder's own
   claimed result exactly.
7. **The second fixture gap the coder found beyond the ticket's own
   diagnosis** (fake `tmux`'s `list-panes` answering empty, defeating
   BL-927's live-identity probe and failing the stuck-parcel gate open
   regardless of in_process contents): read the reasoning and the fix
   directly — `case "$*" in *list-panes*) echo "zsh
   .swarmforge/launch/coder.sh" ;; esac` is a fixture-only change,
   consistent with the departing role being fixed to `coder` in every
   scenario this file drives (confirmed: `fx.coderWt` is the fixed CWD).
   Sound, in scope, no production file touched.
8. **Property file, run directly**: 2/2 pass (was 2/2 red before the fix,
   per the ticket's own reproduction, not independently re-reproduced by
   me — trusted the ticket's own verbatim measured output).
9. **BL-936's own acceptance feature**
   (`BL-936-bl805-property-lane-exercises-the-parcel-gate.feature`): 4/4
   pass. Fixture-dir count before/after: 0 → 0 (guarded/terminal cleanup
   pattern applied correctly from the start).
10. **BL-805's own acceptance feature** (collateral-damage check, per this
    ticket's own qa_e2e_procedure step 6): 5/5 pass, unchanged.
11. **Invariants-review gate**: all three declared invariants are
    process/scope facts about this fix's own diff and verification
    procedure (which files changed, which assertions changed, whether a
    temporary manual neutralisation still trips the gate) — none is a
    property over an input range in the fast-check sense, and a
    *permanent* property test for invariant 3 would itself require baking
    a force/bypass env var into the committed suite, in tension with
    invariant 1's own letter. The coder's stated non-encodability
    reasoning is sound; I verified all three by direct inspection/rerun
    rather than requiring a property test, same posture BL-933's invariant
    1 took earlier this session.

## Verdict
No architecture violation, no correctness defect. All three declared
invariants hold, independently re-verified (including invariant 3's
non-vacuity, reproduced myself rather than only trusting the commit
message). Forwarding to hardener.

By architect.
