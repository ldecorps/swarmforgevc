# BL-2038 — architect review pass, 2026-10-06

1 defect found. One bounce, complete inventory (Article 4.4).

## D1

- **Failing command**: `grep -n 'record-path\|phase.*\.md' swarmforge/scripts/local_seat_phase_cli.bb swarmforge/scripts/done_with_current_task.bb swarmforge/scripts/ready_for_next_task.bb`
- **Commit hash**: 06650997d9
- **First error excerpt**: `local_seat_phase_cli.bb:76-77` owns `record-path` (`(fs/path ".swarmforge" "phase" (str ticket ".md"))`), exposed both to itself and, via the `show` subcommand's JSON `:path` field, to any other caller. `done_with_current_task.bb:126` (new, this parcel) re-derives the identical literal construction by hand: `(fs/path ".swarmforge" "phase" (str ticket-id ".md"))`, instead of asking the module that already answers "where is this ticket's record" — exactly the sibling file in this same two-ticket lineage, `ready_for_next_task.bb`'s own new `phase-cli-show` (lines 88-94), avoids this by shelling to `local_seat_phase_cli.bb show <ticket>` and reading its `:path` field.
- **Failure class**: behavior (BL-1811: a second answer to a domain question, even with the dependency arrow pointing inward — `dependency-gate.js` cannot see this, the edge between the two files is legal, there is no import at all)
- **Expected vs observed**: Expected: one domain answer for "this ticket's phase-record path," asked by every caller that needs it (mirroring `ready_for_next_task.bb`'s own `phase-cli-show` pattern in the same commit). Observed: the path format is now hand-copied in three places (`local_seat_phase_cli.bb`'s own three internal call sites already share it via the private fn; `done_with_current_task.bb` is the new, independent fourth). All four currently agree byte-for-byte, so nothing is wrong *today* — but a future change to the record's layout (nesting, a different extension, sharding by seat) that updates `record-path` has no mechanical reason to also update this hand-built string, and `remove-phase-record-for!`'s cleanup would then silently stop firing (best-effort + `catch Exception _ nil` swallows the resulting `fs/exists?` false-negative with no signal at all).
- **Blamed role**: coder
- **Remediation pointer**: `swarmforge/scripts/done_with_current_task.bb`'s `remove-phase-record-for!` should resolve the record path the same way `ready_for_next_task.bb`'s `phase-cli-show` already does in this parcel: shell to `bb local_seat_phase_cli.bb show <ticket-id>` (run from the seat's own worktree cwd, which `done_with_current_task.bb` already has) and delete the path named in the JSON `:path` field, rather than rebuilding `".swarmforge/phase/<ticket>.md"` from scratch. This also means the deletion stays correct for free if `record-path`'s own format ever changes.

By architect.
