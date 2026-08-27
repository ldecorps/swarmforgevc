# 4 bb fixture copy-lists stale since BL-911 — tests red, and no gate runs them

Raised by: architect (priority-00 note 20260820T043136Z_000279).
**Coordinator verified all three parts of the claim. Correct on every one.**

## 1. The failure is real and reproducible
`bash swarmforge/scripts/test/test_lean_ledger_bb_wiring.sh` -> exit 1:

    FAIL: A1: done_with_current_task.bb exited non-zero
    Type:    java.io.FileNotFoundException
    Message: .../tmp.nvxkENLp/scripts/prompt_engine_lib.bb (No such file or directory)

## 2. Cause chain, and it IS BL-911
`handoff_lib.bb:37` unconditionally loads `prompt_engine_lib.bb`. That load was
introduced by **`818bd3826` "BL-911: rotation recomposes the role prompt from current
sources"**. Fixtures build a temp `scripts/` dir from an explicit copy-list; any list
that copies `done_with_current_task.bb` (which loads `handoff_lib.bb`) without also
copying `prompt_engine_lib.bb` now blows up at load time.

## 3. Exactly FOUR copy-lists, matching the architect's count
Filtered precisely — copies `done_with_current_task.bb`, omits `prompt_engine_lib.bb`:

    test_lean_ledger_bb_wiring.sh
    test_sidecar_tolerant_completion.sh
    test_handoff_state_dir_worktree_root.sh
    test_idle_clear_respawn.sh

(A naive "references handoff_lib.bb but not prompt_engine_lib.bb" filter returns ~20
files and is WRONG — most never load the failing chain. Filter on
`done_with_current_task.bb` instead.)

## 4. "Ungated" confirmed — this is the part that matters
`grep -rl` across `swarmforge/scripts/test/run_*.sh`, `swarmforge/scripts/*.sh` and
`.github/workflows/*.yml` finds **no runner or workflow** referencing these tests. So
nothing has executed them since BL-911 landed; they have been red, silently, for the
whole interval. Same shape as the known `specs/pipeline/test/` gap: a test directory
that exists, is maintained, and is run by nothing.

The copy-list staleness is a one-line-each fix. **The ungated-suite half is the real
defect** — without a gate, the next lib added to `handoff_lib.bb` re-breaks all four the
same way, equally silently.

Routed to the specifier to mint; the coordinator does not mint tickets.
