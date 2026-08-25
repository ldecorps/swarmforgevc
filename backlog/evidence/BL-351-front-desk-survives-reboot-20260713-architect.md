# BL-351 front-desk-survives-reboot — 20260713 (architect)

## Verdict: PASS, forwarded to hardener

## What was reviewed

Merged cleaner's `9b7ce40619` into the architect worktree and reviewed the
combined parcel. No TypeScript/extension files are touched (shell +
Gherkin step wiring only), so `dependency-gate.js` does not apply to this
parcel — noted rather than silently skipped.

## Logical coupling: co-change-report.js

Ran against `generate_systemd_units.sh`, `frontDeskSurvivesRebootSteps.js`,
`restrictedFrontDeskOperatorSteps.js`. All reported coupling is expected:
`generate_systemd_units.sh` with its own test file and sibling deploy
scripts (`provision_secondary_host.sh`, `generate_secondary_conf.sh`); the
two step files with each other and `specs/pipeline/steps/index.js`. No new
unexpected coupling.

## Correctness / boundary checks

- Verified `PIDFile=$PROJECT_ROOT/.swarmforge/operator/front-desk-
  supervisor.pid` in the generated unit against `launch_front_desk.sh`'s
  own `PID_FILE="$OP_DIR/front-desk-supervisor.pid"` (`OP_DIR="$ROOT/
  .swarmforge/operator"`) — paths match exactly, by direct read, not
  narrative trust.
- Verified `ExecStop`'s `touch .../front-desk-supervisor.stop` against
  `front_desk_supervisor.bb`'s own `stop-file` definition
  (`(fs/path op-dir "front-desk-supervisor.stop")`) — matches.
- `Type=forking`+`PIDFile=` (rather than mirroring the operator unit's
  `Type=simple` verbatim) is the technically correct systemd idiom for
  `launch_front_desk.sh`'s actual shape (forks the supervisor into the
  background via `nohup`, waits for the pid file, exits) — `Type=simple`
  would have made systemd track the launcher's own near-immediate exit as
  "stopped", causing `Restart=always` to relaunch the launcher itself in a
  tight loop rather than tracking the real supervisor. Deviating from a
  literal mirror of the `operator` branch here is the RIGHT call, not
  scope creep — the ticket's own instruction to "reuse that shape" is
  satisfied at the level of the idiom (`Restart=always`, boot-persistent,
  reuse the existing launcher/stop-file), not a byte-for-byte unit copy.
- Process-table hygiene (engineering.prompt's shared-global-processes
  rule): the acceptance suite's `pkill`/`pgrep` calls are scoped to
  `ctx.root`, a per-run `fs.mkdtempSync` fixture path
  (`sfvc-bl351-acceptance-*`) — never a bare pattern that could catch a
  sibling worktree's own concurrently-running front-desk processes.
  Confirmed by reading the actual pattern strings, not the evidence
  narrative alone.
- No `.bb` file was touched; `front_desk_supervisor.bb`'s own
  bounded-restart supervision of the bridge/bot pair and
  `launch_front_desk.sh`'s own idempotent already-running guard are reused
  unchanged, exactly as scoped ("what did NOT need new code").
- The `restrictedFrontDeskOperatorSteps.js` step-text collision fix
  follows the same established branch-on-context-flag pattern as BL-349's
  fix reviewed earlier today — existing BL-334 scenarios are unaffected
  when the flag is absent (evidence cites a 9/9 green re-run of that
  feature).

No violations found. Forwarded to hardener with the same task name.
