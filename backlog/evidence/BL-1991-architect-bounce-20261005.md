# BL-1991 — architect bounce, 2026-10-05

Commit reviewed: 1d32425315 (feature), evidence commit 814d2850ba received
from coder.

## D1 — the relaunch loop never runs when qwen is the thing that died (CONFIRMED, blocks the whole feature)

`swarmforge.sh`'s local-model launch case (lines ~2478-2491) appends, after
the FIRST `qwen ... -i "<card>"` invocation, a `local -a pending_msgs` /
`while` loop that checks `.swarmforge/local-seat-restart/*.msg` and
relaunches qwen with the pending override. The entire generated launch
script runs under `set -euo pipefail` (line 2700, the fixed `#!/usr/bin/env
zsh` / `set -euo pipefail` template header — unchanged by this parcel).

Under `set -e`, a non-zero exit from the first command in a script body
terminates the whole script immediately — before any later statement runs.
The repeat guard's own `end-qwen-process!` (local_model_repeat_guard.bb)
kills qwen via `ProcessHandle.destroy()` on the parent, which is exactly
the signal-terminated, non-zero-exit case `set -e` reacts to. This is not
a corner case: it is the SAME condition the whole feature exists to handle
— "when the repeat guard ends qwen for a missed write" is, by construction,
a non-zero-exit qwen.

Reproduced directly (fake `qwen` that exits 143, same template shape:
`set -euo pipefail; qwen ...; local -a pending_msgs; pending_msgs=(...);
while ...; done; echo "LOOP RAN"`): the script exits 143 right after the
first `qwen` call, "LOOP RAN" never prints, and the pending `.msg` file is
left on disk — the launcher never even inspects `pending_msgs`, which is
the FIRST line after the failing command. The acceptance suite
(`bl1991SkippedWriteRestartSteps.js`) never catches this because it drives
`local_model_repeat_guard.bb`'s `answer` directly via
`bl1991RestartGuardCli.bb` and never runs the real generated launch script
end to end — the gap is between the two halves the commit message itself
calls out ("the other half").

Consequence: in the live pane, exactly the trigger scenario (repeat guard
kills qwen for a missed write) leaves the pane dead with a pending override
message nobody ever reads — the opposite of scenario 01's acceptance
criterion ("a fresh one is started"). Every non-zero qwen exit for any
reason (not only a restart) now aborts the launch script before it even
checks for a pending override, which is also a behavior change from the
pre-BL-1991 script (previously qwen's exit code was moot — nothing followed
it).

**Remediation**: the first `qwen` call (and the loop's own `qwen` call)
need their exit status kept from tripping `set -e` before the
`pending_msgs` check runs — e.g. `qwen ... -i "..." || true` (or an
explicit `set +e`/`set -e` bracket around just the qwen invocations), so a
killed-for-restart qwen and an ordinarily-crashed qwen both fall through to
the pending-override check. Verify by re-running this reproduction with
the fix applied: "LOOP RAN" must print and the `.msg` file must be
consumed.

## Everything else checked, no further defect

- Both declared invariants hold in `local_model_repeat_guard.bb`: a
  restart only fires on the THIRD non-write call since the latest
  compaction (`restart-decision`'s `(>= (inc other) 3)`), is capped at
  `max-restarts` = 2 and durable via the `.json` count file keyed off the
  in_process handoff filename, and never refuses a tool call (the hook
  always returns the normal notes-response or nil; killing is a side
  effect, not a PostToolUse denial — `skipLoopDetection` is untouched).
- `node specs/pipeline/cli.js specs/features/BL-1991-...feature`: 4/4 ok.
- `bash swarmforge/scripts/test/test_bl1971_local_model_repeat_guard.sh`:
  all PASS (regression unaffected).
- `extension/test/bl1991LocalSeatRestartInvariants.property.test.js`:
  dependency-gate clean (`node out/tools/dependency-gate.js
  test/bl1991LocalSeatRestartInvariants.property.test.js` → PASSED, no
  forbidden edges).
- co-change-report.js: only the files this same parcel touched, no
  surprise coupling.
- No architecture-boundary issue: shell/babashka driving a tmux-resident
  qwen pane, no process spawned outside tmux, no secret values written,
  no webview/extension-host code touched.

By architect.
