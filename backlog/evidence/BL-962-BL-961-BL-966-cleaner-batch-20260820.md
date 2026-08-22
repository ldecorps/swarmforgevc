# Cleaner batch pass — BL-962, BL-961, BL-966

Three `git_handoff`s received as one batch from the coder, a linear chain
(`cc9b19b829` ← `1aaf72fcd7` ← `5c8b0835f8`); merged once at the tip.
**Forwarded as THREE separate `git_handoff`s** under their own task names,
never collapsed (Article 2.6).

**Inventory: NONE.** No defect found in any of the three. Every check below
was run or is recorded blocked; nothing assumed clean.

---

## Cleanup applied

**C1 — BL-962: one exit-code decoder instead of two.**
`babysitter_check.bb` had `qa-ancestor?` decoding `0 / 1 / anything else`
into `{:ok? …}`, and BL-962 added `path-identical-to-parent?` decoding the
same convention again (`is_qa_ancestor.sh`'s contract and `git diff
--quiet`'s agree). Extracted `exit->answer`, used by both. The rule that
actually matters — **a non-0/1 exit is never read as a plain "no"**, the
fail-closed half of invariant 3 — now has ONE definition rather than a copy
per predicate. Behavior-preserving; both BL-962 runners and
`test_babysitter_check.sh` pass unchanged.

Nothing else needed cleaning. Specifically **not** touched:

- BL-962's pure/impure split (`adjudicate-merge-paths` /
  `assemble-offending-commits` pure, `merge-parent-facts` impure) is already
  what the architecture rules ask for — policy independent of IO.
- BL-961's change is nine lines in one heredoc, deriving the pack from the
  `CONFIG_FILE` the launcher actually loaded. No structure to improve.
- BL-966's `resolve-identity-root` memoizes per root with a documented
  reason (runs in handoffd's poll cycle) and degrades to the caller's own
  root on any git failure. Sound as written.

---

## Observation for the architect — NOT acted on (out of scope)

BL-966 adds the **sixth** Babashka implementation of "resolve the master
checkout via `git rev-parse --git-common-dir`":

| File | Shape |
|---|---|
| `dispatch_lib.bb:28` | `git-common-dir` from process cwd |
| `salvage_lib.bb:48` | inline, `sh-out "."` |
| `swarm_handoff.bb:69` | `git-common-dir` from process cwd |
| `handoff_lib.bb:106` | through the BL-967 chokepoint, with an override seam |
| `backlog_depth_lib.bb:115` (**new**) | through the chokepoint, memoized, per-root |
| `handoff-lib.sh:34` | the shell twin |

(plus `swarm-metrics.ts:56` and `trace-hop.ts:85` across the language
boundary). They are not trivially interchangeable — some resolve from
process cwd, some from a passed root, one carries an override seam, one
memoizes — which is exactly why unifying them is a design decision with its
own ticket, not something to fold into a cleanup pass on three unrelated
tickets. Flagged, not fixed. Note this is the same hazard class as
`handoffd.bb:110`'s own comment ("silently resolved against the WRONG root
via git-common-dir-from-cwd").

---

## Peer claim re-run — the conclusion holds, one stated cause is wrong

BL-966's handoff names two failures as "pre-existing on this host, not this
parcel". **Both are indeed pre-existing** — I reproduced the second
byte-identical from a scratch worktree at the pre-merge commit `860896ef54`,
and neither test file nor `resolve_swarm_socket.bb` is touched by this
parcel. But one **stated cause is wrong**:

- `test_backlog_depth_pack_override.sh` — claimed cause: "`grep -P` (stock
  BSD grep)". Measured: `grep -P` **works on this host**
  (`printf 'a\tb\n' | grep -P "^a\t"` succeeds). The real failure is
  `resolve_swarm_socket.bb: Socket path exceeds the operating system's
  unix-socket path limit (100 chars)` — the fixture's macOS
  `/private/var/folders/...` temp root is 102 chars and `XDG_RUNTIME_DIR` is
  unset. A path-length fixture problem, not a grep-portability one.
- `test_compliance_battery_cli.sh` — claimed cause: "receive competency".
  Confirmed exactly, same single FAIL line at pre-merge.

Recording the correction because a wrong cause is how a real defect hides
later: anyone acting on "BSD grep" would change the grep and watch the test
keep failing. Not a bounce — the routing conclusion (pre-existing, not this
parcel) was right, and neither test is in these tickets' scope.

---

## Checks run

| Check | Result |
|---|---|
| `bl962_merge_adjudication_test_runner.bb` | PASS |
| `bl962_merge_adjudication_property_runner.bb` | PASS |
| `bl961_pack_export_property_runner.bb` | PASS |
| `bl966_depth_identity_root_property_runner.bb` | PASS |
| `backlog_depth_test_runner.bb` | PASS |
| `daemon_cycle_guard_lib_test_runner.bb` (BL-967 D2 closure gate) | PASS |
| `test_babysitter_check.sh` | PASS |
| `test_swarmforge_pack_export.sh` | PASS |
| `test_effective_backlog_depth_cli.sh` | PASS (ALL PASS) |
| `test_swarm_ensure.sh` | PASS (ALL PASS) |
| `npm test` | **444 files / 7909 tests, all passing** |
| `test_backlog_depth_pack_override.sh` | FAIL — pre-existing, cause corrected above |
| `test_compliance_battery_cli.sh` | FAIL — pre-existing, reproduced at `860896ef54` |

`npm test` exits non-zero on a fully green suite: that exit is
`recordTestDuration.js`'s **7s per-file speed budget**, which ~15 files
exceed on this host, not a test failure. Read the summary lines, not the
exit code.

**Degraded tooling — recorded, not implied away.** Every source file in all
three tickets is Babashka or shell. Per the Engineering Rules neither has
mutation, CRAP, or DRY tooling wired in this repo (BL-472 deferred): this
pass is gated by the bb/shell runners and the TS unit suite alone.
**Mutation, CRAP, and DRY did NOT run.** The BL-485 mutation-site count is
N/A — it counts against compiled `out/**/*.js` and no changed file has a
compiled counterpart.
