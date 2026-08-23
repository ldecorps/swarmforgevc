# BL-611: babysitterd — the deterministic health-sweep daemon

**One babysitter exists: the daemon.** The earlier LLM-agent babysitter (a
Telegram-topic `claude` session asked to do deterministic health checking)
never behaved right and has been fully removed — no `babysitter.prompt` role,
no LLM launch path, no wake runtime. `babysitterd` replaces it: a shell/bb
loop that runs the same checks as a pure, unit-tested function over a
snapshot, and reports by nudging the coordinator's pane — never by acting on
the swarm itself.

This also supersedes the operator's private prototype
(`.swarmforge/operator/babysitter_check.sh` + `babysitterd.sh`, untracked and
gitignored). That copy should be stopped once this daemon is live; the
tracked version is the only one that should be running.

## What it checks

Each sweep evaluates a snapshot (tmux sessions, `ps`, file listings/ages, pane
captures, an available-memory reading) against these checks, in
`babysitterd_sweep_lib.bb`:

| # | Check | Fires when |
|---|---|---|
| 1 | live-session-per-role | a role pane has no live `claude` process (via a single `ps -eo pid=,ppid=,args=` snapshot filtered in-process by ppid — portable across GNU and BSD/macOS `ps`, never `pane_current_command`, which lies with a live child); if the `ps` gather itself fails outright, this reports `UNAVAILABLE` for that role rather than a false "no process" CRIT. Missing-session CRITs are mono-router topology aware (BL-804, below) — a dormant role's absent session under router mode is not a finding at all. A **vanished tmux session** for a role that should stand also carries a bounded repair intent (BL-1017, below) — the one exception to "the daemon never fixes anything" |
| 2 | remote-control-flag | a live process is missing `--remote-control` |
| 3 | handoffd-supervisor-fresh | handoffd/its supervisor is down, or `handoffd.log` is older than 5 minutes |
| 4 | dead-letter-nonempty | `.swarmforge/handoffs/failed/` is non-empty |
| 5 | stuck-in-process | an `inbox/in_process/` parcel is older than 30 minutes, in master **or** any worktree mailbox, **and** its owning role's pane is not busy (BL-807, below) — under mono-router, most of what used to trip this was the resident forwarding then rotating without completing the received parcel; BL-805 (see `swarmforge/handoff-protocol.md`) closes that at the source by refusing resident-invoked rotation over an undrained `in_process`, so this check now mostly catches genuine stalls |
| 6 | menu-blocked-pane | a pane capture shows an interactive menu/dialog (report only — never picks an option) |
| 7 | busy-but-frozen | busy footer present but the spinner-stripped content hash is unchanged across 3 consecutive sweeps |
| 8 | memory-floor | available memory is below the configured floor; reports `UNAVAILABLE` (never a fabricated OK or CRIT) when no memory facility on the host is readable |
| 9 | rotate-not-honored | the newest completed parcel's rotate instruction is older than a 10-minute grace period, its target differs from `.swarmforge/mono-router-active-role`, and the note is newer than that file's mtime (suppresses a false positive when the persona changed *after* the note completed) |
| 10 | swarm-starved | active tickets exist, zero pending/in-process parcels across every mailbox, no pane shows a busy footer, sustained for **2 consecutive sweeps**; pending never counts abandoned or >120-minute-old parcels |
| 11 | claim-risk | the salvaged `babysitter_assess_lib.bb` scan (a role heading for bounce/halt with HEAD unchanged) |
| — | planned-pause awareness | while `.swarmforge/operator/control-pause.json` marks an active pause, checks 9 and 10 are suppressed (planned quiet is not starvation) |
| 12 | resume-overdue | a pause is still marked active but its `untilMs` expired more than 15 minutes ago (the auto-resume sweep itself failed) |
| 13 | pipeline-code-on-main | a commit reachable from `main` or `origin/main`, not an ancestor of `swarmforge-QA`, touches a QA-exclusive path (BL-631, below); reports `UNAVAILABLE`, never a clean sweep, when `swarmforge-QA` itself can't be resolved |

Every check is a pure function over a snapshot struct — no tmux/fs/sleep in
the test path. `swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb`
and `..._property_runner.bb` drive it with fixtures.

**The daemon does not fix anything — with two bounded exceptions.** No menu
picks, no parcel moves; apart from typing the nudge line into the
coordinator's pane it is read-only, *except* that a vanished standing role's
tmux session can be recreated (BL-1017, below) and a missing tmux control
plane can be auto-recovered via `./swarm ensure` (BL-958/BL-1071, below) —
both bounded and never silencing the CRIT that reports them. Everything else
stays judgment for the coordinator/human.

## What a nudge looks like

A CRIT finding, or a `stuck-*` WARN, gets typed (with a trailing Enter — typed
messages submit, draft overlays do not) into the coordinator's pane as:

```
babysitter health sweep: <finding 1 message> ; <finding 2 message> ; ... — investigate and take the minimal correct action (or tell the human).
```

Every other WARN, and every OK, stays in the log only. Each finding is deduped
by its key with a 30-minute cooldown, so a persistent condition nudges once,
not every sweep. If the coordinator pane/process is down, the daemon logs
`NUDGE-SKIP` — it never nudges into a dead pane and never falls back to acting
on the swarm itself.

**Dedup was silently broken for every check until BL-631.**
`read-dedup-state!` parsed `nudge-dedup.json` with Cheshire's
`keywordize-keys` flag on, turning every finding's plain string `:key` into a
Clojure keyword on reload; `decide-nudges`' lookup is string-keyed and can
never match a keyword, so no check's dedup ever actually took effect — every
eligible finding renudged on every single sweep, for every check, since the
daemon shipped. Fixed by dropping that flag (the file's only reader). Not
specific to check 13 below; found only because that check's own acceptance
scenarios couldn't pass against it.

If you see a coordinator pane message starting `babysitter health sweep:`,
treat it as a trusted, deterministic report — not something to re-verify from
scratch.

## Start / stop / ensure

The spawn detaches via `setsid` when it is on `PATH` (Linux), and falls back
to plain `nohup`+`disown` when it is not (macOS ships no `setsid`) — the same
detachment `start_handoff_daemon.sh` already relies on. Either path survives
the launching shell exiting.

Managed by the same lifecycle as every other swarm daemon — no separate
command:

- `start_ancillary_services.sh` starts it (`start_babysitterd.sh`), unless
  `SWARMFORGE_SKIP_BABYSITTERD=1` is set.
- `stop_ancillary_services.sh` / `./stop-swarm.sh` stop it by pidfile, the
  same pattern as the other daemons.
- `kill_all_swarm.sh` (the nuclear path) signals its pidfile too.
- `./swarm ensure` verifies the pidfile's pid is alive and, if not, runs
  `start_babysitterd.sh`. That start script **adopts** a live
  `babysitterd.sh` for this root when the pidfile is missing or stale
  (rewrites the pidfile, does not spawn a second copy) — the extra-start +
  EXIT-trap path is how a healthy daemon used to look DOWN in
  `./swarm status`. Override the repair command with
  `SWARM_ENSURE_BABYSITTERD_CMD`.
- `./swarm status` reports a `babysitterd` row from **process truth** (a
  live `babysitterd.sh` for this root), not pidfile-only. Status is
  read-only: it tags `adopted-live` when the pidfile is missing and never
  rewrites it.
- Operator's runtime (`operator_runtime.bb`) polls that same process +
  pidfile + Telegram-announce path every tick and **tells** (coordinator
  note + `status.json` `babysitterd_watchdog`) — it never restarts
  babysitterd. Cron (BL-675) remains the restarter. Set
  `OPERATOR_BABYSITTERD_WATCHDOG_ENABLED=0` to disable the poll.
- The daemon's EXIT trap unlinks the pidfile only when it still contains
  **this** process's pid, so a raced extra start cannot delete an
  orphan's pidfile on the way out.

A second `start_babysitterd.sh` while a live pidfile exists is refused; the
original process is left running. A second start while the pidfile is
**missing** but the daemon process is still alive **adopts** that pid.

## Where the log and state live

```
.swarmforge/babysitterd/babysitterd.pid       daemon pidfile
.swarmforge/babysitterd/babysitterd.log       bounded ~2000 lines; one heartbeat line per tick
.swarmforge/babysitterd/streak                swarm-starved idle-sweep streak
.swarmforge/babysitterd/nudge-dedup.json      {finding-key -> last-nudged-ms}
.swarmforge/babysitterd/pane-hash-<role>      last 3 stable content hashes (check 7)
.swarmforge/babysitterd/session-repairs.json  {role -> {"attempts" n "last-ms" ms}} — the repair cooldown budget (BL-1017)
```

This is deliberately **not** `.swarmforge/babysitter/` (no `d`) — that
directory belonged to the retired LLM hawk. Keeping the state dirs distinct
means stale hawk state is never mistaken for daemon state; the daemon never
reads the old directory. `stop_ancillary_services.sh` best-effort clears any
leftover hawk process/socket it finds there as migration hygiene, not as part
of the daemon's own lifecycle.

The heartbeat line lets `daemon_log_freshness.conf` (BL-675) tell "quiet but
alive" from "wedged" — see
[Daemon log-freshness watchdog](BL-675-daemon-log-freshness-watchdog.md),
which also restarts babysitterd if its log goes stale.

## The env skip flipped meaning

`SWARMFORGE_SKIP_BABYSITTER` (no trailing `d`) is now **inert** — it is the
old LLM hawk's skip flag and nothing reads it anymore. The current flag is
**`SWARMFORGE_SKIP_BABYSITTERD`**.

This was a deliberate rename, not a reuse of the old slot: reusing
`SWARMFORGE_SKIP_BABYSITTER` would mean any host whose `.swarmforge/swarm.env`
already sets it (e.g. with a comment like "cost > value for this project",
written about the paid LLM agent) would silently boot with the new, free
deterministic daemon disabled too — reproducing the exact defect this ticket
fixes, under a new name.

If your `.swarmforge/swarm.env` (untracked, host-local) still sets
`SWARMFORGE_SKIP_BABYSITTER=1`, that line is now a no-op and should be deleted
by hand — nothing in this parcel can edit it for you.

**macOS hosts specifically**: if `.swarmforge/swarm.env` sets
`SWARMFORGE_SKIP_BABYSITTERD=1` (trailing `d`) under a stale rationale carried
over from the old paid LLM hawk (e.g. "cost > value"), that reasoning does not
apply to the free deterministic daemon. Since BL-802 (below), babysitterd runs
correctly on macOS — clearing that line by hand is what turns the sweep back
on for this host.

## macOS portability (BL-802)

The gathering layer reads whatever memory facility the host actually has:
`/proc/meminfo` first (or `BABYSITTER_MEMINFO_PATH`, the existing hermetic
test seam — unchanged), falling back to parsing macOS `vm_stat` when neither
`/proc/meminfo` nor the override path is readable. If neither facility yields
a reading, `available-mem-mb` is `nil` and the memory-floor check reports
`UNAVAILABLE` rather than fabricating a reading — the old behavior silently
defaulted to 999999MB available, which masked real low-memory conditions as
OK.

Both the pane process gather and the memory-floor gather now distinguish "the
gather tool itself failed" from "the thing being checked for is genuinely
absent" — a failed gather reports `UNAVAILABLE` in the log; it is never
nudge-eligible (`UNAVAILABLE` is neither `CRIT` nor a `stuck-*` `WARN`), so it
never produces a false CRIT nudge and never silently passes as OK.

## Mono-router topology awareness (BL-804)

Under `config rotation router` only two sessions stand: the resident (first
non-coordinator `roles.tsv` session) and the coordinator. Before this fix,
check 1 CRIT'd on every dormant role's absent session anyway — 6 false
CRITs per sweep on a live mono-router install (specifier, cleaner,
architect, hardender, documenter, QA) — and because CRITs are nudge-eligible,
that noise re-hit the coordinator's pane every 30-minute dedup window.

`babysitter_check.bb` now resolves rotation-router mode the same way
`handoffd.bb` does — swarm-identity rotation key, else the identity-recorded
active pack conf, else the tracked `swarmforge/swarmforge.conf` — via
`mono_router_lib.bb` (`rotation-router-from-identity?`,
`conf-rotation-router?`), and stamps each role's `:should-stand?` from
`mono-router-lib/should-have-standing-session?`. `check-live-session` in
`babysitterd_sweep_lib.bb` suppresses a missing-session finding only when the
gatherer says that role should not stand; a present pane is always fully
checked (process/menu/frozen/remote-control), and a required session
(resident or coordinator) still CRITs if missing. Non-router packs are
unchanged — every role is expected to stand, exactly as before BL-804.

The daemon never grows a second topology parser: this is a call site for the
same `mono_router_lib` resolution `handoffd` already uses, not a
reimplementation.

## Bounded session repair for a vanished standing role (BL-1017)

Before this fix, a standing role's tmux session vanishing (the pane killed,
the host restarted, whatever the cause) stayed gone until a human ran a full
`./start-swarm.sh` — recreating all eight sessions to fix one, and itself
made a 2026-08-21 incident worse. Check 1's missing-session branch now
carries a bounded `:repair` intent next to the CRIT, and `babysitter_check.bb`
**acts on it directly** rather than merely returning it — a decision nobody
consumes is exactly the BL-419 shape (mechanism built, wired nowhere) this
ticket's own `required_wiring` names, and it was a real gap: the pre-existing
suite covered only the pure decision function, never the live consumption
point, until this pass added scenarios exercising both.

**What it does.** `ensure-role-session!` mirrors `swarm_ensure.bb`'s own
single-role launch path, and what it may resolve to is now pinned by
`single_role_repair_lib.bb`'s `resolve-single-role-repair` (BL-1018): a
missing session is created with its launch command carried directly on the
`new-session` call and is **never** followed by a `respawn-pane` into it; an
existing session is `respawn-pane -k`'d in place and never recreated. That
split matters because create-then-respawn against a missing session is the
exact sequence a 2026-08-21 incident took — a single-role repair of the
specifier brought down the entire pack tmux server (socket, `handoffd`, and
all eight sessions), root mechanism unproven but BL-958's leading hypothesis
is a respawn issued against a missing session restarting a half-alive tmux
server. `ensure-role-session!` reads `.swarmforge/launch/<role>.sh` — always
the project-root copy, never a worktree-local one, which can drift — and
threads it through `provider_respawn_env_lib.bb` so the relaunched pane keeps
whatever alternate-runtime auth env `swarm_ensure.bb`/`handoffd.bb`'s own
respawn path would have passed it. This recreates **one** session —
deliberately not `start-swarm.sh`'s eight-session sweep, which is the
disproportionate action this ticket exists to avoid. Every resolved command
also names the pack socket explicitly (`tmux -S <socket> ...`) and is never a
`kill-server`/`kill-session` — the two properties BL-1018's acceptance
asserts directly against the resolver's output, see
[the feature file](../../specs/features/BL-1018-single-role-respawn-never-kills-the-server.feature).

**Bounds (invariant 2 — no respawn storm).** At most 1 repair attempt per
role per 10-minute cooldown window (`default-max-repair-attempts` /
`default-repair-cooldown-ms` in `babysitterd_sweep_lib.bb`), persisted across
sweeps in `session-repairs.json` since each sweep is its own process. An
attempt is recorded whether tmux succeeded or not — a session that keeps
failing to come back is retried at most once per window, then left as a
standing CRIT, not retried forever.

**The CRIT is never swallowed.** A repaired role still logs its
`swarmforge-<role>: tmux session missing` CRIT on the sweep that repaired it
— a session that keeps vanishing is a signal worth keeping, not something a
successful repair should hide. The repair outcome itself logs alongside it as
`REPAIR [repaired|failed|no-socket|no-session-name|no-launch-script] swarmforge-<role>`.

**Topology-respecting by construction.** The repair intent hangs off the same
missing-session branch the BL-804 `should-stand?` suppression already guards
(above) — a mono-router non-resident role's absent session is never a
finding at all, so it can never be repaired either. No second predicate to
drift out of sync with the first.

**Not covered by the unit suite:** actually killing a live tmux session and
watching the sweep bring it back is outside the testability boundary (real
tmux). Confirm by hand after a change here: kill one standing role's session,
wait for the next sweep, and check (a) that role's session returns, (b) no
other session was touched, (c) `handoffd` is still alive, and (d)
`./attach-swarm.sh <role>` succeeds afterwards.

Acceptance feature:
[`specs/features/BL-1017-babysitterd-recreates-vanished-standing-session.feature`](../../specs/features/BL-1017-babysitterd-recreates-vanished-standing-session.feature).

## Control-plane auto-heal, bounded in time (BL-958/BL-1071)

Before this fix, a missing tmux control plane (`control-plane-missing`, see
[BL-958](BL-958-control-plane-loss-recovery.md)) opened an incident and
CRIT'd, but nothing ever ran `./swarm ensure` — the response-policy names
`babysitterd` as owner, yet the live owner never acted. Check `control-plane`
now does, gated by the same attempt/cooldown budget as the BL-1017 session
repair above (`session-repairs.json`, keyed `"control-plane"`), and per-role
`ensure-session` repairs are suppressed while a control-plane ensure is
queued — the coordinated whole-plane recovery is the only recovery in
flight, never racing eight individual per-role ones.

**Three finding severities, not two.** `control-plane-missing` with
persisted launch scripts present CRITs and queues the repair;
`control-plane-missing` with no launch scripts CRITs and escalates for a
human relaunch, queuing nothing (recreation is impossible, so it does not
churn through per-role repairs that cannot work). An observer that itself
throws — the tmux probe erroring rather than answering `up`/missing — now
reports `UNAVAILABLE [control-plane]` and carries the observation's own
error text, rather than producing no finding at all. That third case matters
because a throw producing nothing is the exact silent-blackout mechanism
this ticket's incident was, one layer up: the sweep printing "OK all checks
green" while it in fact knows nothing about the plane. `UNAVAILABLE` is
never nudge-eligible, same as every other unavailable-gather case in this
doc (memory floor, pane process), but it is never silence either.

**Bounded in wall-clock, not only in attempts.** `./swarm ensure` is shelled
under a wall-clock deadline (`BABYSITTER_ENSURE_TIMEOUT_MS`, default 5
minutes) via a `run-bounded!` mirroring `expedite_cli.bb`'s own — `setsid` so
the whole process group can be killed on timeout, output redirected to files
rather than deref'd (a killed process's stdout pipe can stay open on a
surviving grandchild). The attempt-budget bound alone stops a recovery being
retried forever; it says nothing about one that never returns, and an
ensure that hangs would otherwise hold the sweep open so the next tick never
happens — a babysitter that is stuck reads no differently from one that is
not running, which is the incident's own shape.

**The REPAIR line carries three outcomes, not two:**
`REPAIR [repaired|failed|unfinished] control-plane — ./swarm ensure`.
`unfinished` is the timeout case — nothing said no, so it is not a failure,
and nothing came back OK, so it is not a repair either; reporting it as
either would claim knowledge the sweep does not have. As with BL-1017, the
CRIT itself is never swallowed by a repair attempt.

**The force-result seam is gone.** `run-control-plane-ensure!` used to check
`BABYSITTER_FAKE_ENSURE_RESULT` first and, when set, fabricate a result
instead of recovering — a `*_FORCE_RESULT` env bypass sitting in production
code on the recovery path, and not reachable in a real environment by
accident: anything setting it would silently disable this auto-heal, the
same class of silent blackout as the incident it exists to fix. Removed; the
wiring test now puts a fixture `./swarm` in its own project root instead, so
the real spawn, the real bound and the real exit handling all run and only
the target script is a stand-in.

Verify: `bash swarmforge/scripts/test/test_babysitter_check.sh` (cases M/M2)
and `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb`.
Acceptance feature:
[`specs/features/BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix.feature`](../../specs/features/BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix.feature).

## Claim-risk stall detection restored (BL-809)

`babysitter_assess_lib.bb`'s `worktree-head-commit-10` (the HEAD read check 11
scans with) used `process/shell` without `:out :string`, which inherits
stdout instead of capturing it — leaking the raw 10-char hash to the console
on every sweep — and left `:out` a `NullInputStream`, so trimming it threw
into the broad `catch` and the function returned `nil` even when `git`
succeeded. `scan-claim-risks`, the production entry point, always hits that
fallback, so `head` was permanently `nil`: `head-unchanged?` was always
false, and three of the seven claim-risk severities — `:watch`,
`:warn-uncommitted`, `:warn-fixture-droppings` — could never fire.
`list-untracked-files` had the identical bug on the same call path.

Both now use `process/sh` (captures stdout by default, matching
`handoffd.bb`'s already-correct equivalent) and degrade to `""` / `[]` on
failure instead of `nil`. The stdout leak is gone, and the stall detector — a
role holding a claim past its idle timeout with HEAD unmoved — can fire
again. Row 11 above is otherwise unchanged: same trigger, same nudge path,
now actually reachable.

## Stuck-in-process now gates on owner liveness, and sees every mailbox (BL-807)

Check 5 used to be a pure file-age test: it never consulted whether the owning
role was actually working, even though the same sweep already builds a
`busy-by-role` map (from live pane classification) for check 10's
`owner-busy?` gate. That let the same sweep decide "there is motion here"
(check 10) and "this is stuck" (check 5) about the same parcel — and because
`stuck-*` is the one `WARN` class that escalates to a coordinator-pane nudge,
a false positive interrupted a live agent mid-parcel rather than just adding
log noise. Long-running parcels (mutation runs, full suites, one resident
working one parcel at a time under mono-router) routinely cross the 30-minute
mark honestly.

`stuck-parcels` (`babysitter_check.bb`) now takes the same `busy-by-role` map
check 10 already receives, resolves the owning role for each aged
`in_process` parcel, and attaches `:owner-busy?` to the finding.
`check-stuck-in-process` (`babysitterd_sweep_lib.bb`) skips any finding where
`:owner-busy?` is true — the parcel is still stuck if the owning role goes
idle before the next sweep, but never warns while there is motion. The
30-minute threshold itself is unchanged (raising it would only delay true
positives, never eliminate false ones), and no new durable state or
last-motion timestamp was added — this is busy-now suppression only, so a
role that is busy on something *else* while a different parcel rots in its
`in_process` still suppresses that finding.

Separately, the glob that finds `in_process` parcels only matched the flat
worktree mailbox shape (`.worktrees/<role>/.swarmforge/handoffs/inbox/...`)
and was blind to the role-nested master shape
(`.swarmforge/handoffs/<role>/inbox/...`) that the specifier and coordinator
use — an abandoned specifier or coordinator parcel raised no warning, ever.
The glob (`"{,**/}inbox/in_process/*.handoff"`) and `owning-role-for-path`'s
regex resolution now cover both shapes with one rule, each real parcel
matched — and counted — exactly once.

Acceptance feature:
[`specs/features/BL-807-babysitter-stuck-in-process-warn-ignores-owner-liveness.feature`](../../specs/features/BL-807-babysitter-stuck-in-process-warn-ignores-owner-liveness.feature).

## Operator's babysitterd freshness watchdog: tell, never restart (BL-906)

Babysitterd going down was previously caught by nothing but cron's own
freshness restart (BL-675). Worse, the obvious manual remedy was ambiguous:
running a second `start_babysitterd.sh` while an orphaned daemon was still
alive deleted the pidfile on that second process's EXIT, so `./swarm status`
reported the daemon DOWN while it was in fact still running. This is a
separate, additional layer on top of that same manual remedy — the Operator
runtime now polls, on every tick, and the manual/adopt path was hardened at
the same time.

**Separation of powers, not a limitation.** `operator_runtime.bb` polls
process + pidfile + Telegram-announce-credential presence every tick, via the
pure classifier `babysitterd_freshness_lib.bb`'s `classify`. On anything but
healthy it **tells** — a coordinator-pane note plus a `babysitterd_watchdog`
field in `status.json` — and never calls `start_babysitterd.sh` itself. Cron
(BL-675) remains the sole restarter. An Operator that could also restart
would be a second restarter racing the first, reproducing the exact
duplicate-process failure that caused the pidfile lie in the first place.
Disable the poll with `OPERATOR_BABYSITTERD_WATCHDOG_ENABLED=0`.

`classify` reports exactly one of four states, in this priority order:

| State | Meaning |
|---|---|
| `down` | No live babysitterd process for this root. A missing pidfile alone is not proof either way — this only fires when no matching process exists. Cron or `./swarm ensure` should restart it; the Operator will not. |
| `pidfile-lie` | A live process exists but the pidfile is missing or stale — `./swarm status` would otherwise report DOWN for a daemon that is actually running. `./swarm ensure` / `start_babysitterd.sh` adopt that pid (rewrite the pidfile) rather than starting a duplicate. |
| `announce-mute` | The daemon is alive and the pidfile is correct, but no Telegram credentials are available to announce with — restarts still happen, humans just aren't told. |
| `healthy` | Live process, correct pidfile, announce path available. No finding, no note. |

(A fifth, non-alerting `disabled` state applies only when the watchdog itself
is turned off via the env var above.)

The pidfile-lie regression is fixed at its source, not just detected: the
daemon's own EXIT trap (`babysitterd.sh`) now unlinks its pidfile only when
the pidfile's own recorded content still names *this* process's pid — a pure
twin of that check, `should-unlink-pidfile?`, lives in
`babysitterd_freshness_lib.bb` for property coverage, and the bash original
carries a comment pointing back at it so the two can't silently drift apart.
A raced second `start_babysitterd.sh` against a live orphan can therefore
never delete the orphan's own pidfile on its way out.

Acceptance feature:
[`specs/features/BL-906-operator-babysitterd-freshness-watchdog.feature`](../../specs/features/BL-906-operator-babysitterd-freshness-watchdog.feature).

## Detecting pipeline code that lands on `main` outside QA (BL-631)

The BL-590 post-mortem: an entire cleaner pass ran in the master checkout (a
`cd` habit, not a rotation bug), landing un-QA'd pipeline code on `main`.
Nothing errored, and nothing told anyone — an architect found it hours later
by eye. BL-629 refuses to deploy that state and BL-630 refuses to publish it;
this check is the layer that **tells** someone about a bad tip that already
exists.

`check-pipeline-code-on-main` (`babysitterd_sweep_lib.bb`) flags a commit as
CRIT when it is reachable from a main-naming ref (both `main` and
`origin/main` are swept — they diverge routinely under the current worktree
layout, see BL-891 in `docs/reference/Specification.MD`), is **not** an
ancestor of `swarmforge-QA`, and touches a QA-exclusive path
(`extension/src/`, `extension/test/`, `specs/pipeline/steps/`). The path set
is never restated here: `gather-pipeline-code-on-main`
(`babysitter_check.bb`) reads it at runtime from BL-632's own
`check_pipeline_code_on_main.sh --list-paths` (a `BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT`
env seam exists for tests only), and ancestry is decided by
`is_qa_ancestor.sh`, the one shared "is this sha QA-approved" predicate — not
a second `git merge-base` call. If `swarmforge-QA` itself can't be resolved,
the whole check fails closed to `UNAVAILABLE` rather than reading as a clean
sweep.

Merge commits are diffed with `git diff-tree -m --first-parent`, never a
plain `git show`/`diff-tree` — a merge's own plain diff reports zero files
even when its combined content touches a QA-exclusive path (measured
directly on this repo: 0 files plain vs. the real 13/35 via `--first-parent`
on two different merges), which is exactly the shape that let the BL-590
incident's own merge commit (`f8dc07963`) go unnoticed.

Each finding's key carries the offending sha
(`pipeline-code-on-main-<sha>`), so `decide-nudges`' dedup treats every
offending commit independently — one already-nudged sha stays deduped while
a distinct new one nudges on its own, rather than the first offender
permanently masking every later one.

Acceptance feature:
[`specs/features/BL-631-babysitter-detects-pipeline-work-on-main.feature`](../../specs/features/BL-631-babysitter-detects-pipeline-work-on-main.feature).

## Cached, batched pipeline-code-on-main gather (BL-1086)

Check 13's gather (BL-631, above) used to re-derive its answer from scratch
every 300s tick, spawning `is_qa_ancestor.sh` once per candidate SHA. On a
`main` sitting ~23 commits ahead of `swarmforge-QA`, that overran
babysitterd's 600s freshness threshold — and since the daemon writes its
heartbeat only *after* the check returns, a slow gather read as a dead daemon
and triggered a mid-sweep restart (`age_secs=1146`, 2026-08-22).

**The cache is on disk, not in memory.** Each tick's `babysitterd.sh` shells a
fresh `babysitter_check.sh` process, so an in-memory cache would never survive
between ticks and would hit nothing. `gather-pipeline-code-on-main-cached`
(`babysitter_check.bb`) instead reads/writes
`.swarmforge/babysitterd/pipeline-code-on-main-cache.json` (atomic
temp-file-then-move), keyed on all three tips the answer depends on: `main`,
`origin/main` (nil when unconfigured — not a failure), and `swarmforge-QA`.
Any of the three moving invalidates the cache. A gather that returns
`:ancestry-unavailable? true` is **never** cached — freezing a fail-closed
hole as clean would be worse than the cost this removes.

**The ancestry check is batched, not reimplemented.** `is_qa_ancestor.sh`
gained a `--batch <sha>...` mode (also accepting SHAs on stdin) that answers
"is this SHA QA-approved" for the whole candidate set in one process instead
of one process per SHA — reading the bounce-verdict stores once instead of
once per SHA. `is_qa_ancestor.sh` remains the single predicate (BL-925
invariant 2): batch mode is a batch of one sharing the same code path as
single-SHA mode, never a second `git merge-base` walk. `batched-qa-ancestry`
in `babysitter_check.bb` calls it and requires every requested SHA to come
back answered; if the batch call fails or a SHA is left unanswered, the whole
sweep fails closed to `:ancestry-unavailable? true` — never a partial
offending-commit list.

Verify with `bash swarmforge/scripts/test/test_babysitter_check.sh` and
`bb swarmforge/scripts/test/bl1086_cache_and_batch_property_runner.bb`.
Acceptance feature:
[`specs/features/BL-1086-babysitterd-caches-and-batches-its-qa-ancestry-gather.feature`](../../specs/features/BL-1086-babysitterd-caches-and-batches-its-qa-ancestry-gather.feature).

## Verify

```bash
bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb
bb swarmforge/scripts/test/babysitterd_sweep_lib_property_runner.bb
bb swarmforge/scripts/test/babysitterd_freshness_lib_test_runner.bb
bb swarmforge/scripts/test/babysitterd_freshness_lib_property_runner.bb
bash swarmforge/scripts/test/test_babysitter_check.sh
bash swarmforge/scripts/test/test_babysitterd_lifecycle.sh
bash swarmforge/scripts/test/test_operator_runtime_babysitterd_watchdog.sh
```

Acceptance feature:
[`specs/features/BL-611-deterministic-babysitterd-managed-by-swarm-lifecycle.feature`](../../specs/features/BL-611-deterministic-babysitterd-managed-by-swarm-lifecycle.feature).

The BL-802 macOS-portability behavior above has its own acceptance feature:
[`specs/features/BL-802-babysitterd-macos-portability.feature`](../../specs/features/BL-802-babysitterd-macos-portability.feature).

The BL-804 mono-router topology-awareness behavior above has its own
acceptance feature:
[`specs/features/BL-804-babysitter-mono-router-topology-awareness.feature`](../../specs/features/BL-804-babysitter-mono-router-topology-awareness.feature).

The BL-809 claim-risk stall-detection fix above has its own acceptance
feature:
[`specs/features/BL-809-worktree-head-read-leaks-stdout-and-always-returns-nil.feature`](../../specs/features/BL-809-worktree-head-read-leaks-stdout-and-always-returns-nil.feature).
