# BL-812 — coder pass

handoffd is invoked as `bb handoffd.bb <project-root>` but its process cwd is
not guaranteed to be that root (observed live: launcher home dir). Every
target-root-scoped read in `handoff_lib.bb` (roles.tsv, the mono-router
active-role marker, tmux-socket, launch scripts, and transitively
wake-session/rotate-resident-to!) used to shell `git rev-parse
--git-common-dir` from process cwd, so under a foreign cwd every one of
those reads silently resolved against the wrong root - the resident looked
absent, chase degraded to waking a session mono-router never creates, and
the swarm starved.

## Fix

- `swarmforge/scripts/handoff_lib.bb`: added `explicit-project-root` (a
  plain atom, not a `binding` - handoffd's shutdown-hook thread and any
  future sweep thread must see it too, per the ticket's own design
  constraint 1) and `set-project-root!`. `target-root` now prefers the
  override (`(or @explicit-project-root <the pre-existing git-common-dir/
  cwd fallback>)`), unchanged when no override is set (design constraint 2 -
  the cwd fallback rotate_to_role.bb/operator_runtime.bb/operator_lib.bb
  depend on must survive).
- `swarmforge/scripts/handoffd.bb`: calls `handoff-lib/set-project-root!
  project-root` once, immediately after `project-root` is parsed from argv -
  before any handoff-lib call below reads target-root.

No other file needed a change: every root-scoped call site the ticket's own
fix inventory names (`roles-tsv-path`, `mono-router-resident-session`,
`mono-router-home-role`, `mono-router-active-role-path`, `tmux-socket`,
`launch-script-path`, `load-role-info`/`load-all-roles`'s 0-arity forms,
`wake-session`, `rotate-resident-to!`) already routes through `target-root`
alone - fixing the one function fixes every caller transitively, and
`handoffd.bb` itself never shells `git rev-parse` for this class of read (it
only uses `project-root` directly, already correct, for its own git-history
reads).

## required_wiring (both satisfied)

- `swarmforge/scripts/handoff_lib.bb::set-project-root!` - defined.
- `swarmforge/scripts/handoffd.bb::handoff-lib/set-project-root!` - called
  at startup, immediately after `project-root` is parsed.

## Acceptance (BL-112)

New step handlers: `specs/pipeline/steps/bl812HandoffdCwdWakeRemapSteps.js`
(registered in `specs/pipeline/steps/index.js`), driving the real
`handoff_lib.bb` via a new CLI probe (`swarmforge/scripts/test/
bl812_root_probe.bb`, never a reimplementation) from a genuinely foreign
process cwd - `swarmforge/scripts/test/
test_handoffd_bl812_cwd_invariant_root_resolution.sh`.

```
$ bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-812-handoffd-cwd-breaks-mono-router-wake-remap.feature
...
# tests 9
# pass 9
# fail 0
```

Scenario 04 ("chase rotates the resident onto a dormant role holding
actionable mail") drives `rotate-resident-to!` directly rather than the full
`handoffd.bb` chase-sweep loop: that function is the exact respawn action
chase performs once it has decided to poke a role, and the decision logic
itself (`preferred-mono-rotate-role`/`chase-rotate-to!`) is untouched by
this ticket, which fixes only root resolution. Driving the whole daemon
event loop for this scenario would mean either a live tmux socket (this
project's Testability Boundary excludes live tmux/PTY interaction) or a
purpose-built `--chase-once` CLI flag, which is out of this ticket's scope.

Non-vacuity (both the shell fixture and the acceptance run): re-ran against
the pre-fix tree (`git stash` on `handoff_lib.bb`/`handoffd.bb`) - the probe
fails to even compile (`Unable to resolve symbol: handoff-lib/
set-project-root!`), confirming the fixture cannot pass by accident. Also
ran against a deliberately half-fixed `target-root` (`set-project-root!`
present but `target-root` still `(or nil <fallback>)`, ignoring the atom) -
scenario 01a fails immediately (`expected 'swarmforge-coder', got 'nil'`).

## Unit / regression runs

```
$ bb swarmforge/scripts/test/handoff_lib_test_runner.bb            -> ALL TESTS PASSED
$ bb swarmforge/scripts/test/handoff_wake_session_test_runner.bb   -> ALL TESTS PASSED
$ bb swarmforge/scripts/test/mono_router_lib_test_runner.bb        -> ok
$ bash swarmforge/scripts/test/test_chase_sweep.sh                 -> ALL PASS
$ bash swarmforge/scripts/test/test_rotate_to_role_stuck_parcel_gate.sh -> ALL CHECKS PASSED
$ bash swarmforge/scripts/test/test_corrupt_handoff_never_dispatched.sh -> ALL PASS
$ bash swarmforge/scripts/test/test_handoffd_ambulance_wiring.sh   -> ALL PASS
$ bash swarmforge/scripts/test/test_handoffd_pause_suppresses_outbound_wakes.sh -> ALL PASS
$ bash swarmforge/scripts/test/test_ready_for_next_rotate_home.sh  -> ALL CHECKS PASSED
$ bash swarmforge/scripts/test/test_sidecar_no_orphan.sh           -> ALL PASS
```

`test_operator_runtime_bl647_rotation_liveness.sh` and
`test_operator_runtime_tick.sh` fail in this dev tree - confirmed
pre-existing and unrelated by re-running against the unmodified tree
(`git stash` on both touched files): identical `FileNotFoundException`
(`mono_router_lib.bb` not found) from both. Root cause: `swarmforge/scripts/
test/lib/operator_runtime_sandbox.sh`'s `copy_operator_runtime_sandbox`
libs list omits `mono_router_lib.bb`, which `handoff_lib.bb` load-files
(pre-existing, not something this ticket's diff touches) - a sandbox-fixture
gap, not a regression. Not fixed here (out of this ticket's scope); worth a
follow-up ticket if not already tracked.

## BL-654 declared-invariant coverage

Ticket declares three invariants. Per coder.prompt's Invariants section,
first authorship of each invariant's property test rests with the coder.

1. **"Wake remap and resident rotation resolve project-scoped paths from
   handoffd's argv project-root (or an explicit equivalent), never from
   process cwd."** — property test authored:
   `swarmforge/scripts/test/bl812_project_root_override_property_runner.bb`.
   Every root-scoped read reduces to one precise property of `target-root`
   itself (`(or @explicit-project-root <fallback>)`): once
   `set-project-root!` is called with a non-blank value, `target-root`
   always echoes it verbatim, and every dependent path-builder
   (`roles-tsv-path`, `mono-router-active-role-path`) composes under it -
   500 generated project-root strings (varied length, spaces, accented
   chars), plus a fixed regression pin proving `set-project-root! nil`
   restores the git-common-dir/cwd fallback. In-process (no subprocess
   forking per run) — babashka's own classpath/load-file startup cost
   (~7-10s observed) makes a 500-run subprocess loop impractically slow,
   matching every other `*_property_runner.bb` in this directory. Ran clean
   (`ALL PROPERTIES HOLD`); non-vacuity proven twice - against the pre-fix
   tree (compile error, the seam doesn't exist) and against a deliberately
   half-fixed `target-root` that ignores the atom (every P1 run failed,
   echoing the real cwd's git-common-dir instead of the generated root) -
   both restored before commit.

2. **"A dormant mono-router role with actionable inbox/new mail produces a
   resident rotate or a wake on the resident session — never unbounded
   chase-wake-error against swarmforge-\<dormant\>."** — **stated reason, no
   property test**. The decision logic this invariant describes
   (`preferred-mono-rotate-role`/`chase-rotate-to!`/
   `chase-poke-and-notify!`) is pre-existing, untouched by this ticket, and
   inherently impure: it scans the real mailbox filesystem, captures the
   live resident tmux pane, and performs the actual rotation over a real
   tmux socket - not a pure, testable module, and BL-812's own scope is
   fixing root resolution feeding INTO that decision, not restructuring it
   (mirrors BL-795's own invariant-2 stated-reason for the same functions:
   "Babashka has no property-test framework wired for this daemon-
   control-flow layer regardless"). Encoded instead via the real-fixture
   acceptance scenario 04, which drives `rotate-resident-to!` (the exact
   respawn action this decision delegates to) under a foreign cwd with a
   fake-tmux fixture and asserts both the positive outcome (resident pane
   respawned running the target role's launch script) and the negative one
   (no `send-literal` - chase-wake-error's failure mode - is ever attempted
   against the nonexistent dormant session).

3. **"wake-session remaps identically whether handoffd's cwd is the project
   root or an unrelated directory."** — **stated reason, no separate
   property test**. `wake-session`'s only cwd-dependent path is
   `mono-router-resident-session` -> `roles-tsv-path` -> `target-root` -
   there is no cwd-handling code inside `wake-session` itself. Invariant 1's
   property test already proves `target-root` is cwd-invariant once the
   override is set (the override wins before the cwd-derived branch is ever
   reached), and `resolve-wake-session` (the pure remap decision
   `wake-session` wraps) is pre-existing, untouched by this ticket, and
   already covered by `handoff_wake_session_test_runner.bb`'s fixed
   examples. A third property test would only be re-proving invariant 1's
   result through one more layer of pure composition. Encoded end-to-end
   instead via the real-fixture acceptance scenario 03, which resolves the
   hardender wake session from both the project-root cwd and a foreign cwd
   in the same run and asserts byte-identical output.

## e2e QA procedure

Steps 1-5 of the ticket's own `e2e_qa_procedure` require a live daemon and
real tmux socket (steps 1, 3, 5) - this project's Testability Boundary
excludes live tmux/PTY interaction from the coder's own verification, same
boundary every prior ticket in this area (BL-805, BL-795) has respected.
Step 2 (resolve the resident session through handoff-lib with the project
root set explicitly, from a foreign cwd) is exactly acceptance scenario 01a,
already proven above. QA owns steps 1/3/4/5 against the real live daemon per
the ticket's own procedure.
