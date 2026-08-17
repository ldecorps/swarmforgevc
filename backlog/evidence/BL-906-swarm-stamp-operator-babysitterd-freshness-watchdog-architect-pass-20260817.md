# BL-906 — architect pass (clean review) — 2026-08-17

## Scope reviewed

Commit `d7c94b3704` (coder), sent by cleaner via `merge_and_process cleaner
b3f68ae365`. This is the fix for architect's own 2026-08-17 first-round
bounce D1 (invariant-unencoded: none of the 3 declared invariants had a
property test or a stated non-encodability reason). Three files touched:
`swarmforge/scripts/babysitterd.sh` (2-line cross-reference comment only, no
functional change), `swarmforge/scripts/babysitterd_freshness_lib.bb` (new
pure predicate `should-unlink-pidfile?`), and a new property runner
`swarmforge/scripts/test/babysitterd_freshness_lib_property_runner.bb`.

## Complete review inventory (Article 4.4 — one pass, everything run)

- Dependency-rule gate (BL-259, hard gate):
  `node extension/out/tools/dependency-gate.js
  ../swarmforge/scripts/test/babysitterd_freshness_lib_property_runner.bb
  ../swarmforge/scripts/babysitterd_freshness_lib.bb
  ../swarmforge/scripts/babysitterd.sh` — PASSED, no forbidden edges.
- Co-change coupling (BL-255): ran against this round's changed files. The
  new property runner's only pairing is with
  `babysitterd_freshness_lib.bb`/`babysitterd.sh` themselves — its own
  ticket's file family. `babysitterd.sh` is the same pre-existing hub file
  the prior architect pass already characterized (hundreds of entries,
  flooding effect, not evidence of new coupling). No new/unexpected
  coupling.
- **Invariant 1 (pure-layer half), P1**: `classify` never returns
  `:action :restart` across 1000 generated `{:enabled? :live-pid
  :pidfile-alive? :telegram-creds?}` combinations, generator confirmed to
  hit all 5 classify states (not a lucky slice).
- **Invariant 1 (grep-checkable half)**: re-confirmed independently —
  `grep -n start_babysitterd swarmforge/scripts/operator_runtime.bb` — only
  comment lines (312, 2290), no call site.
- **Invariant 2, P3**: new pure predicate `should-unlink-pidfile?` — true
  iff trimmed recorded pidfile content equals own-pid as a string — tested
  across 500 generated cases (matching pid with assorted whitespace,
  different pid, blank, nil) plus two fixed cases pinning the exact live
  regression (a racing second launch's pidfile overwrite must never be
  unlinked by the original process).
- **Invariant 3, P2**: `classify`'s `:state` independently re-derived from
  the same four declared inputs via the documented priority order (down >
  pidfile-lie > announce-mute > healthy, gated by `enabled?`) and asserted
  equal across 1000 generated combinations — proves state depends on
  exactly the declared observed-process-truth fields.
- **Non-vacuous, independently re-verified** (architect's own
  break-then-fix, not taken on the commit message's word): removed the
  `str/trim` call from `should-unlink-pidfile?` (regressing the trap's own
  whitespace-normalization semantics), rebuilt nothing needed (bb, no
  compile step) — reran the property runner, got >100 FAIL lines, all on
  the whitespace-padded matching cases, exactly as expected for that
  mutation. Restored (`git diff`/`git status --short` clean), reran — clean
  pass again.
- `bb swarmforge/scripts/test/babysitterd_freshness_lib_property_runner.bb`
  — clean pass (2000 assertions across P1/P2/P3).
- `bb swarmforge/scripts/test/babysitterd_freshness_lib_test_runner.bb` —
  PASS (pre-existing example-based suite, unaffected).
- `status.json`'s `babysitterd_watchdog` field: still present,
  `operator_runtime.bb:2358` (unchanged by this commit).
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-906-operator-babysitterd-freshness-watchdog.feature` —
  independently re-run, 10/10 PASS.
- `bash swarmforge/scripts/test/test_babysitterd_lifecycle.sh` —
  independently re-run, ALL PASS (8/8, including test 04's EXIT-trap
  ownership check).
- `bash swarmforge/scripts/test/test_daemon_log_freshness.sh` —
  independently re-run, ALL CHECKS PASSED.
- `bash swarmforge/scripts/test/test_operator_runtime_babysitterd_watchdog.sh`
  — independently re-run, ALL CHECKS PASSED (20/20).
- `bash swarmforge/scripts/test/test_swarm_ensure.sh` — independently
  re-run in full (large suite: RC-1..RC-13, 05a..05i, 07a..07f, and the
  base 01-10 checks), 44/44 PASS, exit 0. Re-run in full even though this
  round's diff doesn't touch `swarm_ensure.bb` or change `babysitterd.sh`'s
  actual trap behavior (comment-only there), per Article 4.4's
  run-or-blocked discipline rather than assuming clean from the prior
  pass's result on a different commit.
- No orphaned processes after any of the above, checked before and after:
  `pgrep -fl 'babysitterd.sh|start_babysitterd'` and `ps aux | grep 'sleep
  100\|sleep 300'`. The only `sleep 300` seen (both before my mutation test
  and after the full `test_swarm_ensure.sh` run) is confirmed a child
  (`ps -o pid,ppid,command`) of the live swarm's own real babysitterd
  (pid 2367), not a test leak.
- Hardening-gate degraded-fallback record (Babashka has no mutation/CRAP/DRY
  wired): still not yet applicable at this stage — the ticket's own
  `qa_e2e_procedure` requires the hardener to record this explicitly; flagged
  again for the hardener.

All of the above: PASS. No defects found this round. All three declared
invariants now carry non-vacuous property-test coverage (BL-654), closing
my own round-1 bounce.

## Verdict

Architecturally compliant. Forwarding to hardener.

By architect.
