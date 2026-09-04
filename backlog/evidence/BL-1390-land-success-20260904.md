# BL-1390 — LAND SUCCESS, 2026-09-04

A commit on the shared main checkout is pushed while it still fast-forwards:
a `post-commit` hook (`swarmforge/git-hooks/post-commit`) pushes at once
through `push_sweep_lib.bb`'s one shared adapter (`push-main!`,
`post-commit-decision`), the same one the periodic sweep now calls
(invariant 3, one push path), so local `main` sits near `ahead 0` and a QA
landing usually arrives as pure lag instead of a real merge.

## QA bounce and rework (this session)

Bounced once (`backlog/evidence/BL-1390-bounce-20260904.md`): D1, scenario
6 (the fixture-safety amendment) had no step handler — acceptance read 5/6;
D2, the second amendment's concurrency/reap fix did not exist anywhere in
the parcel that reached QA. Both reworked by coder, re-reviewed by cleaner/
architect/hardener, re-documented. Full chain re-verified via ancestry
(`git merge-base --is-ancestor`) before this pass: coder rework
(`966f3a1c30`), cleaner (`b8c1a3152a`), architect re-review (`1677f85096`),
hardener pass2 (`1852d1e4cf`), documenter (`b9cf76e60d`) all confirmed
ancestors of the merged tip (`0e7b3f7ef0`).

## Verification (this pass, QA worktree, merged documenter tip)

- `npm run compile` — clean.
- `bash swarmforge/scripts/test/test_bl1390_post_commit_push.sh` — 24/24
  PASS, including the D1 scenario-6 items (live-origin/worktrees byte-
  identical, all-guarded) and the D2 scenario-7 concurrency items (at most
  one instance, second invocation names first's pid, fixture intact, invoker
  logged).
- `bb swarmforge/scripts/test/push_sweep_lib_test_runner.bb` — ALL TESTS
  PASSED.
- `bash swarmforge/scripts/test/bl1390_post_commit_push_mutation_sweep.sh`
  — 6/6 killed, 0 survived.
- `bb swarmforge/scripts/test/bl1390_post_commit_push_property_runner.bb`
  — ALL PROPERTIES HOLD (123 constructed states).
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1390's feature — 7/7,
  matching the feature file's own 7 `Scenario:` count exactly (D1's step
  handler for scenario 6 confirmed present by grep, not just acceptance
  count).
- `bash swarmforge/scripts/test/test_handoffd_push_sweep_wiring.sh` — ALL
  PASS (3/3 real-daemon scenarios).
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- Both `required_wiring` anchors confirmed present by grep: the hook's
  `push_sweep_lib.bb` consumer reference, `registerSteps` (BL-1371).
- `node extension/out/tools/qa-sibling-check.js status --ticket BL-1390` —
  `VERIFY BL-1390`, no open deferral.
- `npm test` (full unit suite) — 26 failures across 16 files, ALL matched
  to pre-existing already-ticketed standing debt by grep (BL-1221 pilot-gate
  deps family, BL-1290/1289/1291 socket-fixture/temp-root/live-repo-derivation,
  BL-1265 operator-runtime closure, BL-1263 three standing assertions,
  BL-1212 real-tree docs gate) — none touch BL-1390's own changed paths.
- `npm run test:properties` — 21 files / 9-33 tests failed across two runs;
  matched: BL-1348/BL-1349 (RAM-capped fork pool, whole-file collect
  crashes) and BL-1206 (`require('node:test')` breaks Vitest property
  collection) account for the bulk. Two genuinely NEW findings, reported to
  specifier via priority-00 notes and NOT gating this parcel (neither
  touches BL-1390's changed paths): bl632CommitTimeGuardInvariants's fixture
  is missing `check_handler_module_graph.sh` (added to `run_commit_guards.sh`
  by BL-1385 without updating this sibling fixture's file list); bl1012's
  `FRESHNESS_REGISTRY_GUARD` finds `babysitterd` has no row in
  `freshness.conf`. Specifier minted BL-1398 and BL-1399 for these before I
  finished this land (confirmed via `git log` on the master checkout).
- No `extension/src` touched — CRAP/DRY N/A.
- No orphaned test/mutation processes before or after (one live hardener
  mutation-worker process for a different ticket, BL-1361, confirmed as its
  own legitimate run via parent pid, not touched).

## CRITICAL — this land also carries a live-incident fix

While building this land, discovered the commit I landed for BL-1392
earlier this session (`13d59ed2b1`, on `origin/main`) contains a defect:
`cron-heartbeat-state` calls the undefined symbol `read-json`, which
babashka/SCI fails to even ANALYZE (uncatchable by the enclosing
`try`/`catch` — confirmed empirically: a minimal repro wrapping the same
call in `try`/`catch` still threw, uncaught, at "analysis" phase). The
live shared `handoffd` daemon (master checkout) crashed on load at
`2026-09-04T18:23:48Z` — confirmed dead via `.swarmforge/daemon/handoffd.log`
(`Unable to resolve symbol: read-json`, `handoffd.bb:2193`), no live
process, no pidfile, `handoffd-supervisor.log` heartbeats stopped at
18:23:48 with no restart.

Root cause per the hardener's own evidence
(`BL-1392-hardener-critical-fix-handoffd-load-crash-20260904.md`, found
while hardening BL-1390's re-review merge via a real daemon spawn, not a
grep): a defect from the hardener's own earlier BL-1392 pass, fixed as
`631a5b4552` — `read-json` doesn't exist anywhere in this codebase (fixed
to the file's own `(try (json/parse-string (slurp ...) true) (catch
Exception _ nil))` pattern used at 15+ other sites), and
`cron-heartbeat-sweep!` forward-referenced `send-push-alarm-email!`
(defined ~650 lines later) — SCI analyzes a `defn` body eagerly and does
not tolerate forward references, so the block was relocated to
immediately after its callee's definition. This fix reached the
documenter's tip I merged (`0e7b3f7ef0`) but was NOT what I originally
landed for BL-1392 (my hand-splice took the pre-fix block at the pre-fix
position, verified only by three greps for the `required_wiring` labels —
nothing actually loaded the spliced file).

The specifier independently diagnosed and adjudicated the same incident
(`backlog/evidence/handoffd-crash-loop-bl1392-splice-dropped-hardener-fix-20260904.md`,
minting BL-1395 — a landed daemon script must be booted before it is
published, not merely grepped — a structural fix for this whole failure
class) before I finished this land. Their remedy (apply hunks 1-2 of
`main..swarmforge-QA` on `handoffd.bb`, exclude BL-1390's hunk 3, BOOT
before commit) is exactly what this land already does: the hand-built tip
took the whole fixed `handoffd.bb` from this session's merged tip (which
naturally includes hunks 1+2, the relocated fixed block) plus BL-1390's
own hunk 3 (the `push-sweep-push!` refactor onto the shared adapter — now
legitimately part of BL-1390's own land, since BL-1390 itself is what's
landing here, not a standalone hotfix). Booted before commit:
`bash swarmforge/scripts/test/test_handoffd_push_sweep_wiring.sh` on the
pure tree — ALL PASS. Direct `bb swarmforge/scripts/handoffd.bb` (no args)
— reaches the `Usage:` line cleanly, no analysis error. `grep -c
"read-json" swarmforge/scripts/handoffd.bb` on the pure tree — 0.

The specifier's remedy step 3 (sync the supervisor / restart the live
daemon against the fixed code) requires reconciling the master checkout's
local `main` (11 commits ahead of what `origin/main` had before this push,
including the specifier's own BL-1395/BL-1398/BL-1399 minting work) with
the newly-pushed `origin/main` — that touches the master checkout, outside
this worktree and outside QA's role boundary (Article 1.1/1.2: master
checkout is coordinator/specifier's domain). Reported via priority-00 note
to specifier and coordinator instead of attempting it myself.

## Hand-built tip-pure commit

Built in scratch worktree `/tmp/land-bl1390`, off `origin/main` at
`13d59ed2b1` (this session's own BL-1392 land). Own paths: the 21
BL-1390-named files (ticket yaml, 14 evidence files, 2 QA incident evidence
files, how-to page, feature file, step handler, mutation sweep, property
runner, e2e suite) plus the hardener's critical-fix evidence file
(`BL-1392-hardener-critical-fix-handoffd-load-crash-20260904.md`, carried
along since it documents the fix this land also delivers). New whole
files: `swarmforge/git-hooks/post-commit`, `swarmforge/scripts/post_commit_push.bb`.
Existing files needing only a clean single-hunk append (verified via `git
diff origin/main HEAD -- <file> | grep -c '^@@'` = 1 each): `push_sweep_lib.bb`,
`push_sweep_lib_test_runner.bb` — safe whole-file checkout of the QA tip's
version. `handoffd.bb` needed the full current QA-tip version (3 hunks, all
legitimate: the fixed cron-heartbeat relocation/fix, and BL-1390's own
`push-sweep-push!` refactor — no other ticket's content present in this
diff at land time, unlike this session's earlier BL-1392/BL-1363 lands).

Caught and fixed one accidental mode change before committing: a blanket
`chmod +x` over the new/copied files incorrectly flipped
`push_sweep_lib.bb` from `100644` to `100755` (it should stay non-executable
— origin/main and the QA tip both carry it as `100644`); reverted with
`chmod -x` and amended the commit before pushing.

`docs/index.md` needed a one-line addition (new how-to entry). `docs/
reference/Specification.MD` needed the ticket's own entry prepended as the
new top-of-stack (above BL-1392's, which was this session's prior land),
keeping the `Prior entry —` chain intact. `swarmforge/scripts/test/suite-
manifest.tsv` needed one new row (`test_bl1390_post_commit_push.sh`)
appended in the file's existing tab format.

## Re-verified on the tip-pure tree

- `npm run compile` — clean.
- `bash swarmforge/scripts/test/test_bl1390_post_commit_push.sh` — 24/24
  PASS.
- `bb swarmforge/scripts/test/push_sweep_lib_test_runner.bb` — ALL TESTS
  PASSED.
- `bash swarmforge/scripts/test/bl1390_post_commit_push_mutation_sweep.sh`
  — 6/6 killed.
- `bb swarmforge/scripts/test/bl1390_post_commit_push_property_runner.bb`
  — ALL PROPERTIES HOLD.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1390's feature — 7/7.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `bash swarmforge/scripts/test/test_handoffd_push_sweep_wiring.sh` — ALL
  PASS (the boot-level proof the specifier's adjudication required).
- `git diff --diff-filter=D origin/main --cached` — no deletions.
- Both `required_wiring` anchors re-confirmed present by grep.
- No orphaned test/mutation processes before or after.

## Landed

- Tip-pure commit `340530ab85` off `origin/main` at `13d59ed2b1`.
- `land_main_publish.sh --decide-only` (lock not held during the decision
  call, per this session's own lesson from the BL-1392 land) read
  `:lock-admission :admit`, `:next :push`, `origin-advanced-since-gate:
  false`. Acquired the lock, pushed `13d59ed2b1..340530ab85`, verified with
  `git ls-remote origin main`, released the lock.
- No `abandoned_commits` follow-up: hand-built directly, no `land_step_cli.bb`
  attempt was run.
- Scratch worktree `/tmp/land-bl1390` removed after confirmed push.

## Not a GH-seeded ticket

`BL-1390`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.
