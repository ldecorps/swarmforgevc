# BL-1392 — LAND SUCCESS, 2026-09-04

A dead cron daemon is never silent: install-time `CRON_DAEMON_DOWN` probe
(`install_swarmforge_crons.sh`) plus a runtime `handoffd` heartbeat sweep
(`cron-heartbeat-stale`, reading `.swarmforge/daemon/freshness-check.cron.log`'s
mtime) — the runtime half catches cron dying AFTER a clean install, which the
install-time half alone cannot (BL-1235 shape).

## Verification (QA worktree, merged documenter tip)

- `npm run compile` — clean.
- `bash swarmforge/scripts/test/test_bl1392_dead_cron_never_silent.sh` — 16/16
  PASS.
- `bb swarmforge/scripts/test/cron_heartbeat_lib_test_runner.bb` — ALL TESTS
  PASSED.
- `bb swarmforge/scripts/test/bl1392_cron_heartbeat_property_runner.bb` — ALL
  PROPERTIES HOLD (30 constructed cases).
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1392's feature — 6/6,
  matching the feature file's own 6 `Scenario:` count exactly.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- All three `required_wiring` anchors confirmed present by grep:
  `CRON_DAEMON_DOWN` (installer), `cron-heartbeat-stale` (handoffd sweep
  label), `registerSteps` (step handler discovery, BL-1371).
- No `extension/src` touched — CRAP/DRY N/A.
- No orphaned test/mutation processes before or after.
- Confirmed the full chain (coder rework → cleaner → architect pass2 →
  hardener → documenter) via the evidence trail; the earlier architect
  bounce was reworked and re-passed.
- Directly verified `fixture_isolation.sh`'s concurrency safety by running
  the BL-1392 e2e suite twice concurrently: both completed, all PASS.

## Hand-built tip-pure commit — BL-1390's still-bounced content excluded

Built in scratch worktree `/tmp/land-bl1392`, off `origin/main` at
`e1198ff503` (the tip left by this session's BL-1363 land). The raw QA-tip
diff against `origin/main` carried substantial BL-1390 content — expected,
since BL-1390 remains bounced this session
(`backlog/evidence/BL-1390-bounce-20260904.md`) and both tickets moved
through the same shared documenter worktree.

`swarmforge/scripts/handoffd.bb` needed a hand-splice, not a whole-file
checkout: 4 diff hunks against `origin/main`. Hunks 1 (the
`cron_heartbeat_lib.bb` load-file), 2 (the `cron-heartbeat-sweep!`
function block), and 4 (the `run-sweep! "cron-heartbeat"` cadence
registration) are BL-1392's own content — included. Hunk 3
(`push-sweep-push!` refactored onto `push_sweep_lib.bb`'s shared adapter,
explicitly commented "BL-1390: the push itself now lives in
push_sweep_lib.bb") is BL-1390's — excluded; confirmed by diffing the
spliced file against the QA-worktree tip: the only remaining difference is
exactly that excluded hunk.

Also excluded entirely: BL-1390's own feature file, step handler,
`docs/how-to/BL-1390-...md`, its `docs/index.md` line, its Specification.MD
entry (spliced out — kept BL-1392's own entry, which sits above it in the
QA-tip's stack), and its `suite-manifest.tsv` row
(`test_bl1390_post_commit_push.sh` — not carried; that ticket has not
landed).

**Included as inseparable guardrail work**, per BL-1392's own cleaner
(`BL-1392-cleaner-d1-fix-20260904.md`) and hardener evidence: the new
`swarmforge/scripts/test/lib/fixture_isolation.sh` shared library (lock +
dead-owner-pid reap + wall-clock bound + invoker log — coder's D1 fix for
the exact runaway-process class QA reported live this session), and its
retrofit onto already-landed BL-1363's fixture
(`test_bl1363_close_ticket.sh`) and step handler
(`bl1363ClosingATicketIsOneCommandSteps.js`, module-scope e2e
memoization). This was one coder commit spanning all three fixtures
(`bl13{63,90,92}`); BL-1390's own retrofitted fixture
(`test_bl1390_post_commit_push.sh`) was excluded along with the rest of
that ticket's unlanded content — BL-1363's is not, since BL-1363 is
already on `main` and the migration is a self-contained improvement
independently re-verified green on the pure tree.

`docs/index.md` needed a one-line edit (extending the existing BL-675
entry, not a new row). `docs/reference/Specification.MD` needed the
top-of-stack entry spliced in ahead of BL-1363's (kept the `Prior entry —`
chain intact). `suite-manifest.tsv` needed two new rows
(`cron_heartbeat_lib_test_runner.bb`, `test_bl1392_dead_cron_never_silent.sh`)
appended in the file's existing tab format (verified via `cat -A`).

## Re-verified on the tip-pure tree

- `npm run compile` — clean.
- `bash swarmforge/scripts/test/test_bl1392_dead_cron_never_silent.sh` —
  16/16 PASS.
- `bash swarmforge/scripts/test/test_bl1363_close_ticket.sh` (regression
  check on the retrofit) — 19/19 PASS.
- `bb swarmforge/scripts/test/cron_heartbeat_lib_test_runner.bb` — ALL
  TESTS PASSED.
- `bb swarmforge/scripts/test/bl1392_cron_heartbeat_property_runner.bb` —
  ALL PROPERTIES HOLD.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1392's feature — 6/6.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `git diff --diff-filter=D origin/main --cached` — no deletions.
- All three `required_wiring` anchors re-confirmed present by grep on the
  pure tree.
- No orphaned test/mutation processes before or after.

## Landed

- Tip-pure commit `13d59ed2b1` off `origin/main` at `e1198ff503`.
- `land_main_publish.sh --decide-only` (lock NOT held during the decision
  call — holding QA's own lock during decide-only makes `lock-available?`
  read false and forces an unnecessary `:rematch-once-at-edge` → `:wait-lock`
  cycle against itself; releasing first and re-deciding read
  `:lock-admission :admit`, `:next :push`, `origin-advanced-since-gate:
  false`). Acquired the lock, pushed `e1198ff503..13d59ed2b1`, verified
  with `git ls-remote origin main`, released the lock.
- No `abandoned_commits` follow-up: hand-built directly (expected the
  BL-1390-contamination pattern from the raw diff, same as BL-1363's
  land), no `land_step_cli.bb` attempt was run.
- Scratch worktree `/tmp/land-bl1392` removed after confirmed push.

## Not a GH-seeded ticket

`BL-1392`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.
