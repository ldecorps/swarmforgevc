# BL-993 cleaner bounce — 2026-08-20

Reviewed commit: `66919c67c3` (coder's re-fix for the architect's D1 bounce,
`backlog/evidence/BL-993-bounce-20260820.md`), merged into the cleaner
worktree at `f3bd6e745`.

## Review pass (Article 4.4 complete inventory)

- Re-read the re-fix diff (`swarm_ensure.bb`, `swarm_status.bb`): both now
  delegate to `operator_runtime_watch_lib.bb`'s `healthy?`, exactly as the
  bounce's remediation prescribed. `read-pid`/`pid-etime` reused, not
  reimplemented. No new second liveness check remains — clean.
- `mutation-site-count` on the only `extension/` file this parcel touches:
  N/A, this parcel touches no `extension/` files.
- `bl993_watch_survives_runtime_death.sh`: re-ran, PASS.
- `specs/features/BL-993-a-dead-operator-runtime-is-restarted-without-a-human.feature`:
  re-ran, 8/8 PASS.

## D1 — `test_swarm_ensure.sh` scenario 05a is flaky: a successful operator
   restart is intermittently reported FAILED instead of FIXED (class:
   behavior, blamed: coder)

Ran `test_swarm_ensure.sh` twice in a row, no other change between runs:

- Run 1: scenario 05a **FAILED** — `set -euo pipefail` aborted the whole
  script there (7/47 scenarios executed before abort). Output: `operator:
  FAILED (restarted the operator runtime)` — the repair attempt ran, but
  the post-repair `operator-healthy?` recheck read the freshly-restarted
  process as unhealthy.
- Run 2, no code changes: scenario 05a **PASSED** ("operator runtime not
  running is repaired and reported FIXED").

This is a genuine race, not environment noise: the fixture's initial
`bb -e '(Thread/sleep 100000)' operator_runtime.bb &` process (present
before any repair) is correctly read as healthy every time — including in
the run where 05a failed, since scenarios 01-04 (which also depend on the
fixture's initial operator process reading healthy) passed both runs. The
failure is specific to the repair path: `fake_operator_start.sh` backgrounds
a new `bb -e ... operator_runtime.bb &` process and returns; `ensure-
component!` (`swarm_ensure.bb:410-424`) calls `healthy?-fn` again
immediately after `repair!-fn` returns, with no wait for the newly forked
process's command line to become queryable via
`process-table-lib/cmdline!` (`ProcessHandle.info().commandLine()` /
`sysctl KERN_PROCARGS2` on this Darwin host). Sometimes the recheck lands
before the new process's argv is visible to that call, and
`operator-runtime-cmdline?` (which requires `"operator_runtime.bb"` in the
command line, per the D1 re-fix) reads it as not-yet-alive, so `classify`
returns `:failed` even though the restart genuinely succeeded.

This is new with this ticket's own re-fix, not pre-existing: the OLD bare
`pid-alive?` check `operator-healthy?` used before BL-993 needs only OS-level
liveness, which is available the instant `fork()` returns, with no
exec-visibility race — the cmdline check the D1 remediation correctly
required is what introduces the window. `swarm_status.bb`'s
`gather-operator-runtime` shares the same `healthy?` call and would show
the identical race on a status check landing in the same window.

Confirmed NOT a cleaner-scope fix: closing this race means either (a)
`ensure-component!`/the operator repair path waiting/retrying briefly for
the new process to become cmdline-visible before the post-repair recheck,
or (b) `fake_operator_start.sh` (and the real `start_operator_runtime.sh`
path it stands in for) not returning until the spawned process is
confirmed up. Either is a behavior decision, not a cleanup/refactor — cleaner
does not introduce new behavior (own role prompt, "Does Not Own"). This is
squarely a coder design/implementation call, so it stays outside my remit
to patch directly here.

**Remediation**: pick one of the two above (or another shape) and verify with
several repeated `test_swarm_ensure.sh` runs (not one lucky pass) that
scenario 05a no longer flakes — the same "repeated bare invocation" bar
this project already applies to property-runner reach floors
(BL-982/BL-992 D1). Re-run the full 47/47 suite after the fix per the
original bounce's own remediation step 4, since a retry/wait change to the
shared `healthy?`/`ensure-component!` path touches every daemon's repair
recheck, not just operator's.

## Verdict

Sent back to coder. Do not forward to architect.
