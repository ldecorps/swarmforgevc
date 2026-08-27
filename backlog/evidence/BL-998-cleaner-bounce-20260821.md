# BL-998 — cleaner review, bounce to coder

- **Reviewer**: cleaner, 2026-08-21.
- **Reviewed at**: coder tip `0cebe5e1d0` (merged into cleaner at `e8ad30201`... see commit
  `Merge coder BL-998 (0cebe5e1d0) into cleaner.`).

## Checklist run (complete review inventory, Article 4.4)

| Check | Result |
|---|---|
| `test_compliance_battery_cli.sh` | 8/8 |
| `test_dispatch_lib_receive_mode.sh` | 5/5 |
| `test_reference_freshness_guard.sh` | 4/4 |
| `test_shell_fixture_dispatch_isolation.sh` (the new derived guard) | PASS |
| `bl998_guard_membership_property_runner.bb` (Invariant 2 property) | ALL PASS, 96 runs |
| `specs/features/BL-998-...feature` (BL-998 acceptance) | 5/5 |
| `specs/features/BL-226-...feature` (sixth offender's own acceptance) | 3/3 |
| `test_handoff_state_dir_worktree_root.sh` | 7/7, but see D1 — the pass is not proof of isolation |
| **`test_idle_clear_respawn.sh`** | **CRASHES before printing a single PASS/FAIL line — see D1** |

## D1 (behavior, coder) — `done_with_current_task.bb` is not actually the safe leaf shape the ticket (and the coder's own conversions) treat it as

The ticket's constraint says: *"Calling a leaf helper (`ready_for_next_task.bb`,
`done_with_current_task.bb`) directly with an explicit root is correct... The
guard must not flag it, and `test_handoff_state_dir_worktree_root.sh` must
keep its lines 86 and 94."* The coder's own evidence (Finding 2) independently
observed the same file's real `done_with_current_batch.bb` reading a live
mailbox, converted the BATCH pair to fixture copies, but left the TASK pair
(`ready_for_next_task.bb` / `done_with_current_task.bb`) on the real path in
both files that use it, per the ticket's mandate — and flagged the mechanism
as an open question for the architect rather than confirming it.

**It is not open — it reproduces, deterministically, every run:**

`done_with_current_task.bb`'s completion path is not a true leaf. After
moving the completed file (which correctly resolves to the FIXTURE via
`(worktree-root)`, a `git rev-parse --show-toplevel` from cwd — cwd-based
resolution is genuinely safe), it unconditionally calls `run-ready!`:

```clojure
(defn run-ready! []
  (process/exec (str (fs/path script-dir "ready_for_next_task.sh")) "--idle-boundary"))
```

`script-dir` here is `(fs/parent *file*)` — the directory of the **actual file
on disk**, not cwd. When `DONE_TASK` is left pointing at the real
`swarmforge/scripts/done_with_current_task.bb` (as both files do, per the
ticket), `script-dir` is the REAL scripts directory. `process/exec` replaces
the process image and runs `ready_for_next_task.sh` from there, whose own
body is:

```sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
exec bb "$SCRIPT_DIR/ready_for_next_task.bb" "$@"
```

`$0` is the REAL path, so this `cd` leaves the fixture entirely and lands in
the real scripts directory — inside whichever real worktree this checkout
happens to be (the reviewing role's own). The subsequent
`ready_for_next_task.bb` then resolves `(worktree-root)` from THAT cwd,
targeting the REAL project root and the REAL role's REAL mailbox (whatever
`SWARMFORGE_ROLE` the test exported for the subshell) — not the fixture.

**Reproduced directly, twice:**

- `test_idle_clear_respawn.sh`, scenario 1 (`bb "$DONE_TASK"` with
  `SWARMFORGE_ROLE=onrole`, `DONE_TASK` unconverted): the exec chain escaped
  into the reviewing worktree's own real `ready_for_next_task.bb`, which found
  this session's real in-process BATCH and refused with
  `TASK_IN_PROCESS_IS_BATCH`, printed to stderr with exit 2 — before the
  script prints a single `PASS`/`FAIL` line. Confirmed the real batch was
  merely read, not moved (`ls` of `inbox/in_process/` afterward showed it
  untouched) — but only because it was a *batch* the guard refuses outright;
  had it been a single real task, `done_with_current_task.bb`'s own completed
  chain would have run against it.
- `test_handoff_state_dir_worktree_root.sh` line 112 (`bb "$DONE_TASK"`,
  `SWARMFORGE_ROLE=coder`, same unconverted `DONE_TASK`) exhibits the
  identical escape by the same mechanism — I did not re-run it live a second
  time once the mechanism was understood (re-running against the real
  **coder** worktree's mailbox risks claiming that role's actual live queue,
  which BL-998 exists to stop). Its 7/7 PASS is not evidence of isolation:
  the test only asserts the FIRST line of captured stdout
  (`grep -q "^COMPLETED: ..." <<< "$OUT"`) — `process/exec` output from the
  escaped-to real `ready_for_next_task.bb` lands later in the same captured
  `$OUT` and is never checked, so the assertion would pass whether or not the
  real tree was touched afterward. Checked the real coder worktree's mailbox
  post-hoc (`inbox/new`, `inbox/in_process`, `inbox/completed`, grep for the
  synthetic `BL-056-test`/`BL-089-test` task names) — clean, no residue — but
  only because the real coder inbox happened to be empty at that instant, the
  same "got lucky" outcome the ticket itself says is not good enough
  (*"had the seat been idle, the queued parcel... was claimable"*).

**This directly violates the ticket's own invariant 1** ("No test run alters
live swarm state... byte-identical before and after") for both files that use
`DONE_TASK`/the task-leaf pair without a fixture copy.

**Remediation**: bind `DONE_TASK` (and, for symmetry/safety, `READY_TASK`
where it is called directly rather than via a dispatcher that is itself
already fixture-bound) to each fixture's own installed copy — the identical
`install_scripts`-then-rebind pattern the coder already applied correctly to
`READY_BATCH`/`DONE_BATCH` in `test_handoff_state_dir_worktree_root.sh` and to
`READY_TASK` in `test_idle_clear_respawn.sh`. Apply to:
- `test_idle_clear_respawn.sh`: `DONE_TASK` (currently the only unconverted
  call site left in that file).
- `test_handoff_state_dir_worktree_root.sh`: `DONE_TASK` at line 112, and
  `READY_TASK` at its two call sites (lines 153, 158) for the same reason —
  both are calls through the "safe leaf" pair that is not actually safe once
  the completion/receive chain reaches its post-action escalation.

**Spec gap, not part of this bounce** (routed separately per Article 4.4): the
ticket's own constraint text asserting `ready_for_next_task.bb` /
`done_with_current_task.bb` are safe-to-call-directly leaves is incorrect for
`done_with_current_task.bb` specifically (its `run-ready!` tail-call makes it
transitively self-rooting) — `ready_for_next_task.bb` itself has no such
tail-call and remains a true leaf. A `note` (priority `00`) is being sent to
specifier + coordinator to correct the ticket text and to flag the same
question the coder already raised in Finding 1/2 for the architect: whether
the derived guard's signature should widen to follow `process/exec` of
siblings so a "leaf" call that is not actually a leaf is caught by the guard
itself rather than by hand-inspection.

## Not re-bounced / accepted as-is

- Finding 1 (sixth offender, `readyForNextPromotionSteps.js`) — fixed,
  verified 3/3 on `BL-226-...feature`. Whether the guard should also scan
  `specs/pipeline/steps/*.js` is correctly left as an open decision (shares a
  home with BL-974 per the ticket's own notes) — not this ticket's scope to
  decide unilaterally.
- Finding 3 (`test_idle_clear_respawn.sh` pre-existing respawn-pane failure)
  — moot for this bounce since the file now fails earlier (D1) before
  reaching that check; will need re-verification once D1 is fixed.
- `test_backlog_depth_conf.sh` correctly left alone (never executes its
  dispatcher path, not an offender per the ticket's own exclusion).
