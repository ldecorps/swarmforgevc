# BL-1392 — critical fix found during the BL-1390 hardening pass, 2026-09-04

Discovered while independently re-running `test_handoffd_push_sweep_wiring.sh`
as part of hardening BL-1390's re-review merge (architect commit `1677f85096`):
**`handoffd.bb` — the whole daemon, not just the cron-heartbeat sweep —
crashed at startup.**

## What was wrong

Two defects in the BL-1392 cron-heartbeat code I hardened and forwarded
earlier in this same session (commit `7671300424`), both missed there because
my BL-1392 verification never actually LOADED or RAN `handoffd.bb` itself —
only its e2e suite (which shells out `install_swarmforge_crons.sh` and
`start_ancillary_services.sh`, never `handoffd.bb` directly), the pure-lib
unit/property runners, and a `grep` for the required_wiring labels. A grep
proves the label text exists; it proves nothing about whether the file
containing it can load.

1. **`cron-heartbeat-state` called a function that does not exist.**
   `(read-json ...)` — there is no `read-json` anywhere in this codebase; the
   established pattern (used at 15+ other call sites in this same file) is
   `(try (json/parse-string (slurp ...) true) (catch Exception _ nil))`.
   Fixed to match that pattern.

2. **`cron-heartbeat-sweep!` forward-referenced `send-push-alarm-email!`,
   defined ~650 lines LATER in the file — and babashka/SCI does not tolerate
   forward references.** Verified this empirically with a minimal repro
   (`(defn caller [] (callee)) (defn callee [] "x") (caller)` — fails with
   `Unable to resolve symbol: callee`, phase `analysis`, at the `caller`
   defn's own line) rather than assuming: SCI analyzes a `defn`'s body
   eagerly, at the point the `defn` form itself is evaluated, not lazily at
   first call — so a function may only call something already defined
   earlier in the same file. `send-push-alarm-email!`'s three other call
   sites (3234, 3243) are correctly positioned after its definition (2792);
   `cron-heartbeat-sweep!` was not.

## Why this was severe, and why the existing checks did not catch it

`(defn ...)` at analysis time is one atomic form. My first fix (`read-json`)
made the file's TOP-LEVEL LOAD succeed silently (`bb -e '(load-file ...)'`
prints nothing and exits 0) — but the *second* unresolved symbol only
surfaces when `cron-heartbeat-sweep!` is actually CALLED, since that is when
SCI compiles/analyzes ITS body for the first time and hits the still-broken
forward reference. A bare `load-file` probe cannot distinguish "loads fine"
from "loads fine but explodes on first real sweep tick" for this class of
bug — only actually running the daemon and reaching the call does. This is
exactly the shape of "a grep proves the label text exists, not that the file
loads": the BL-1392 e2e suite's "the daemon carries the cron-heartbeat-stale
sweep label" / "and registers it on the shared sweep cadence" checks are both
`grep`s over `handoffd.bb`'s source text, so they could not, and did not,
catch either defect. The failure was found only via
`test_handoffd_push_sweep_wiring.sh`, an UNRELATED BL-1390/BL-356 suite that
happens to spawn the real `bb handoffd.bb` daemon and wait on its real sweep
loop — it failed on the very first tick, `FAIL: the push sweep never logged a
successful push within 30s`, with the actual crash buried in the daemon's own
stderr.

## Fix

- `swarmforge/scripts/handoffd.bb`: `cron-heartbeat-state` now uses
  `(try (json/parse-string (slurp ...) true) (catch Exception _ nil))`
  instead of the nonexistent `read-json`.
- Relocated the entire `;; ── BL-1392: is the cron daemon...` block (state
  file def, `cron-heartbeat-log-path`, `cron-heartbeat-state`,
  `write-cron-heartbeat-state!`, `cron-heartbeat-sweep!` — previously lines
  2172-2229) to immediately after `send-push-alarm-email!`'s definition
  (previously line 2850, now ~2792), so the forward reference becomes a
  backward one. `run-sweep! "cron-heartbeat" #(cron-heartbeat-sweep!)`'s
  registration (line ~4566) is unaffected — still well after both.
- Pure move + the one function-body fix; diffed the change and confirmed no
  other line was touched.

## Re-verified after the fix

- `bb -e "(load-file \"swarmforge/scripts/handoffd.bb\")"` — loads silently,
  no error (was already true after the `read-json` fix alone, but confirmed
  again after the reorder).
- Direct `bb handoffd.bb <root>` against a real throwaway root
  (`SWARMFORGE_ALLOW_TMP_DAEMON=1`) — reproduced the crash before the
  reorder (`Unable to resolve symbol: send-push-alarm-email!`), confirmed
  gone after.
- `swarmforge/scripts/test/test_handoffd_push_sweep_wiring.sh` — was FAILING
  on the crash; now ALL PASS (a real daemon run, ~3 minutes, including
  octopus-merge and no-op-landing-merge scenarios unrelated to BL-1392 that
  simply couldn't reach a passing state while the daemon couldn't start).
- `cron_heartbeat_lib_test_runner.bb` — ALL TESTS PASSED (unaffected; this
  suite never loads `handoffd.bb`).
- `test_bl1392_dead_cron_never_silent.sh` — 16/16 ALL PASS (unaffected for
  the same reason — its runtime-sweep checks call `cron-heartbeat-lib.bb`
  directly, never `handoffd.bb`).
- No orphaned processes: the two long-lived `bb .../handoffd.bb .` /
  `bb .../handoffd_supervisor.bb .` processes found by `ps` are the LIVE
  swarm's own standing daemons (root `/home/carillon/swarmforgevc`, 17+
  minutes uptime, pre-existing) — not fixtures from this pass.

## Lesson

Sent as a `rule_proposal` to the specifier separately (Lessons Discipline):
a wiring check that only greps a `.bb` file's source text for a required
label can be fully green while the file cannot even load. For any ticket
that adds code to a daemon file with hundreds of interdependent top-level
`defn`s, at least one check must actually LOAD (or better, RUN) the file for
real — not just grep it — because babashka/SCI's eager per-defn analysis
makes forward-reference ordering bugs invisible to both a grep and a
`load-file` probe that never calls the new function.

By hardender.
