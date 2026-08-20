# BL-967 — the identified blocking wait (part 3 of the ticket's fix)

Recorded by the coder, 2026-08-20, per the ticket: "identify tonight's actual
blocking wait from the first attributed timeout (or from the evidence paths
below if it reproduces under a fixture) and fix that real wait."

## The wait

**`handoff-lib/session-exists?` — and six sibling call sites in
`handoff_lib.bb` — still ran on `clojure.java.shell/sh`**, the exact
BL-057/BL-061 stream-read-shim family whose deadlock (blocked forever in
`read()` on a wedged child) is why handoffd itself moved to
`babashka.process` long ago. The library underneath it never moved.

Three independent lines of evidence converge on it:

1. **The stall signature.** Both captured stalls end on per-item chase
   actions (`chase-wake-skip-busy` at handoffd.bb's `:skip` branch). The
   very next code after the chase item loop is `chase-sweep!`'s tail:
   `observe-standing-role-loops!` — which, per role, calls
   `handoff-lib/session-exists?` (tmux `has-session` via
   `clojure.java.shell/sh`, unbounded, no logging) and then a capture.
   Eight roles × silent unbounded calls, exactly between the last logged
   chase action and the next sweep that logs anything.
2. **The sampler.** The intake's process sample showed the main thread
   blocked in read/open syscalls — the java.shell shim's read-side block,
   not a babashka.process wait.
3. **The codebase's own paper trail.** `handoff_lib.bb`'s BL-927 comment
   (architect bounce, 2026-08-19) explicitly names the remaining
   "`clojure.java.shell/sh` calls (session-exists?) in the same sweep" as
   the surviving instance of the deadlock family, on the daemon's
   highest-frequency call path. The specifier's fresh capture (a 7-in-2.5s
   `chase-wake-skip-busy QA` burst — seven rapid capture-panes stressing
   the tmux server — then one more item, then silence) is precisely the
   load shape that wedges the next unbounded tmux call.

## The fix (all three parts land in this parcel)

- **The real wait**: every `clojure.java.shell/sh` call site in
  `handoff_lib.bb` (7 sites: `worktree-root`, `project-root`,
  `session-exists?`, `pane-id`, two `respawn-pane` paths,
  `commit-object-exists?`) is converted to the new bounded chokepoint
  `daemon-cycle-guard-lib/sh!`; the `clojure.java.shell` require is gone
  from the file. `briefing_email_lib.bb` and `control_plane_lib.bb`'s
  in-cycle `process/sh` calls route through the same chokepoint, as do all
  48 `process/sh` sites and the shared `tmux!` helper in `handoffd.bb`
  itself.
- **Bounded (invariant 1)**: the chokepoint's wait is 60s by default
  (`SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS` seam) — well under the 300s
  freshness threshold. On a hit: the child's process tree is destroyed,
  `subprocess-timeout sweep=<name> bound-ms=<n> cmd=<cmd>` is logged, and
  a normal `{:exit 124}` result is returned — survived, never thrown.
- **Self-localizing (invariant 2)**: every sweep in the heavy bundle runs
  under `run-sweep!`, which emits `sweep-boundary sweep=<name> ms=<n>`
  even when the sweep took no action; the 1s idle ticks add none. The
  per-tick delivery/canary phases carry timeout ATTRIBUTION context
  without boundary lines.
- Also closed under the same rule (engineering: max-wait deadlines on lock
  loops): `with-pid-lock`'s previously-unbounded 50ms spin now fails
  loudly after 30s naming the stale lock dir.

## Caveat, stated plainly

The stall did not reproduce under a fixture (it needs a genuinely wedged
tmux server under real load), so the identification rests on the three
converging evidence lines above rather than a caught-in-the-act timeout.
If any OTHER wait was tonight's culprit, it is now equally bounded and the
next occurrence logs `subprocess-timeout sweep=...` naming it — the
structural halves of the fix make the identification self-correcting
(qa_e2e step 3's live soak is the check).
