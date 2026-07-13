# BL-351 front-desk-survives-reboot — 20260713 (coder)

## What shipped

A `--unit=front-desk` branch in `swarmforge/deploy/generate_systemd_units.sh`, wired to the real
`launch_front_desk.sh` (never a bespoke launcher), closing BL-336 findings G1/G2: the bridge and
Telegram bot — the human's entire phone-card/holistic-UI/Concierge/Telegram surface — had no boot
unit at all.

## Design: `Type=forking` + `PIDFile=`, not `Type=simple` like the operator unit

The ticket asked to mirror `--unit=operator`'s shape "including `Restart=always`". Read
`launch_front_desk.sh` closely before assuming that meant `Type=simple` too: `operator_runtime.bb`
runs directly in the foreground under `ExecStart` (a true `Type=simple` daemon), but
`launch_front_desk.sh` is a **launcher** — it forks `front_desk_supervisor.bb` into the background
via `nohup ... &`, polls for that supervisor's own pid file to be claimed, then **exits**. Under
`Type=simple`, systemd tracks the `ExecStart` process's own lifetime as the service's lifetime — the
instant `launch_front_desk.sh` returns (always, whether it just launched something or hit its own
idempotent already-running no-op), systemd would consider the service "stopped" and `Restart=always`
would relaunch `launch_front_desk.sh` again in a tight loop, never actually tracking whether the real
supervisor is alive.

`Type=forking` + `PIDFile=<front-desk-supervisor.pid>` is the standard systemd idiom for exactly this
shape (a launcher that forks a daemon and exits, the daemon writes its own pidfile): systemd waits for
`ExecStart` to exit, then reads `PIDFile` and tracks *that* pid for the unit's actual lifetime.
`Restart=always` then correctly fires only when the supervisor itself dies — and re-running
`launch_front_desk.sh` on an already-running front desk (its own idempotent already-running guard,
completely unchanged) is a safe no-op rather than systemd's own restart triggering a duplicate
launch. Confirmed `launch_front_desk.sh`'s own contract matches: it does not return until the pid file
is written and the supervisor is confirmed alive (`PID_WAIT_ATTEMPTS` polling loop), which is exactly
what `Type=forking` requires of `ExecStart`.

`ExecStop` touches `front_desk_supervisor.bb`'s own real stop-file
(`.swarmforge/operator/front-desk-supervisor.stop`) — the same graceful-stop mechanism that file's
own poll loop already watches and exits cleanly on, mirroring the operator unit's own
`touch .../stop` `ExecStop` pattern exactly, just pointed at the front desk's own stop-file.

## What did NOT need new code

`launch_front_desk.sh`'s own already-running guard (pid-alive check, exits 0 without double-launching)
directly satisfies scenario 05 ("installing the boot services does not start a second front desk") —
unchanged, just reused. `front_desk_supervisor.bb`'s own existing bounded-restart supervision of the
bridge/bot pair is what actually satisfies scenario 04 at the *process* level; the systemd unit's job
is only to keep the *supervisor itself* alive across a reboot or its own death, mirroring the `swarm`
unit's relationship to `handoffd_supervisor.bb` (systemd boots it once; the supervisor watches its own
children internally). No changes to either `.bb` file were needed or made.

## Test coverage

- `swarmforge/scripts/test/test_generate_systemd_units.sh` (extended) — the front-desk unit's own
  directives: generated at all, `Restart=always`/`StartLimitIntervalSec=0`, `WantedBy=multi-user.target`,
  the shared per-pack `EnvironmentFile=` (Telegram secrets), `Type=forking`/`PIDFile=` naming the real
  pid file, `ExecStart` invoking the real `launch_front_desk.sh`, `ExecStop` touching the real
  stop-file, correct `User=`/`WorkingDirectory=` substitution, and byte-identical stdout-vs-output-path
  rendering.
- `specs/pipeline/steps/frontDeskSurvivesRebootSteps.js` (new, registered in
  `specs/pipeline/steps/index.js`) — all 5 Gherkin scenarios in
  `BL-351-front-desk-survives-reboot.feature`, driven against a REAL spawned front-desk process (real
  compiled `extension/out/` copy, real `launch_front_desk.sh`, real `front_desk_supervisor.bb`, real
  bridge + bot pair) — mirroring `mergedCodeReachesDaemonsSteps.js`'s own scenario-05 fixture
  (real-process kill/relaunch, no fake Telegram network needed since only the bridge's own
  `/telegram-inbound` route is exercised). Per the ticket's own E2E QA procedure ("a simulated restart
  proves nothing about a boot path, which is the entire deliverable"), these scenarios prove the
  MECHANISM the unit's directives rely on genuinely works when invoked exactly the way the unit invokes
  it — not a real reboot or real systemd, which the ticket explicitly reserves for a real host and QA's
  own manual procedure.
  - Scenario 01 drives the real generator directly.
  - Scenarios 02/04 kill the real supervisor + bridge + bot, then re-invoke the real
    `launch_front_desk.sh` (the exact command the unit's `Restart=always`/boot would run) and confirm
    a genuinely NEW process comes up.
  - Scenario 03 does the same kill+relaunch, then posts a real inbound message to the freshly
    relaunched bridge's `/telegram-inbound` route and confirms it is actually ingested into a real
    thread file — proving the SURFACE answers, not just a live pid.
  - Scenario 05 re-invokes `launch_front_desk.sh` against an already-running front desk and confirms
    the SAME original pid persists and no second bridge/bot pair appears.
- Found and fixed two real step-text collisions with earlier-registered handlers ("the swarm's boot
  services are..." was collision-free, but "the human sends a message to the front desk" collided with
  `restrictedFrontDeskOperatorSteps.js`'s BL-334 handler) — resolved with the same
  `ctx.<flag>Runner`-delegation pattern already established in this codebase (see
  `mergedCodeReachesDaemonsSteps.js`'s identical note), not by silently shadowing the earlier
  definition.

## A real process-leak bug found and fixed in my OWN fixture (not shipped code)

The acceptance suite's own fixture cleanup (`process.on('exit')`, and the kill step inside
`killAndRelaunch`) initially only `pkill -f`'d the bridge/bot child processes
(`<root>/extension/out/tools`) — `front_desk_supervisor.bb`'s own command line never contains that
substring (only its children's argv does), so the supervisor itself survived every cleanup, and its
own bounded-restart logic dutifully respawned fresh children right back. Running the suite repeatedly
while debugging leaked a growing tree of orphaned supervisor+bridge+bot processes (confirmed via `ps
aux`: dozens of stale entries accumulating run over run) and intermittently caused a spurious "found 3
matching processes" failure in scenario 05 under the resulting resource pressure. Fixed by having both
the exit handler and `killAndRelaunch` also `pkill -f "front_desk_supervisor.bb <root>"` — re-ran the
full suite three consecutive times afterward with zero leaked processes and zero flakes.

Full regression: re-ran `test_generate_systemd_units.sh` (green, no change to `swarm`/`operator`
branches) and the full `BL-334-restricted-front-desk-operator.feature` acceptance suite (9/9 green,
confirming the shared-step-text delegation in `restrictedFrontDeskOperatorSteps.js` introduced no
regression in its own scenarios). No TypeScript/extension code was touched by this ticket.

## What was explicitly not done

Per the ticket's own scope: no unit was installed on any real host (an operator step, documented as
such, not a code change). No change to the other four BL-336 findings (H1/H4/H5/H2-H3). G3 (the PWA
workflow's push-only trigger) was explicitly declined as a finding by the original audit and is not
addressed here either.
