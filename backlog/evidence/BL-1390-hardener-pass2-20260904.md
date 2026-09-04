# BL-1390 — hardener pass 2 (QA bounce rework), 2026-09-04

Merged architect re-review commit `1677f85096` (COMPLIANT — D1, the
cleaner's `git_q`→`gq` typo, confirmed fixed; one non-blocking
false-positive-risk finding noted, not blocking —
`backlog/evidence/BL-1390-architect-pass2-20260904.md`).

## Merge conflicts (own-tree structure vs. inbound, per "Replay the inbound
## work onto that shape")

My worktree already carried BL-1390 hardening (and BL-1392's own retrofit of
the same shared `fixture_isolation.sh`), so the merge conflicted in two
places. Resolved by comparing actual content, not by picking one side
blind:

- `test_bl1390_post_commit_push.sh` scenario 5b: took the architect's inline
  `in_fixture "$root" && GIT_TRACE=... git -C "$root" commit ...` over my
  own earlier `g()`-based fix, because the architect's revised raw-git-call
  self-check (auto-merged in unchanged, since it didn't conflict) is written
  specifically to pair with that exact pattern
  (`in_fixture "\$root" && GIT_TRACE` is matched literally in the regex).
- `docs/reference/Specification.MD`: both my own BL-1363 changelog entry
  and the architect's BL-1390 entry are real, same-day additions — kept
  both.

Re-verified post-merge: `test_bl1390_post_commit_push.sh` 4/4 clean runs
(24/24 ALL PASS each).

## Own finding: `handoffd.bb` crashed at daemon startup

Found while re-running `test_handoffd_push_sweep_wiring.sh` (a real daemon
spawn, unlike the grep-based wiring checks). Two defects in BL-1392's
cron-heartbeat code, from my own earlier BL-1392 pass this session:
`(read-json ...)` doesn't exist anywhere in this codebase, and
`cron-heartbeat-sweep!` forward-referenced `send-push-alarm-email!` (defined
~650 lines later) — babashka/SCI does not tolerate forward references,
confirmed with a minimal repro. Fixed in commit `631a5b4552`, own evidence:
`backlog/evidence/BL-1392-hardener-critical-fix-handoffd-load-crash-20260904.md`.
Sent a priority-00 note to documenter (current holder of BL-1392) naming the
fix commit to merge before landing. Not BL-1390's own defect, but it blocked
BL-1390's own wiring test from ever reaching a real verdict, so it had to be
fixed before this pass could complete.

## Checks re-run, all independently, post-merge and post-fix

- `test_bl1390_post_commit_push.sh` — 4 consecutive runs, 24/24 ALL PASS
  each (including the self-check "every mutating git command in the suite
  goes through the fixture guard" and scenario 5b).
- `bb swarmforge/scripts/test/push_sweep_lib_test_runner.bb` — ALL TESTS
  PASSED.
- `bb swarmforge/scripts/test/bl1390_post_commit_push_property_runner.bb`
  — ALL PROPERTIES HOLD over 123 constructed states.
- `swarmforge/scripts/test/bl1390_post_commit_push_mutation_sweep.sh` —
  6/6 killed, 0 survived, 0 skipped (re-confirmed; targets the shared-
  checkout guard, fail-closed unknown-counts, diverged check, `--force`,
  success/failure mapping, fetch-failure guard).
- `run_acceptance.sh` on the BL-1390 feature — 7/7 PASS.
- `check_feature_handler_registration.sh` — rc 0.
- `test_handoffd_push_sweep_wiring.sh` — was FAILING (daemon crash) before
  the handoffd.bb fix; ALL PASS after (a real `bb handoffd.bb` daemon spawn,
  ~3 minutes wall clock, octopus-merge and no-op-landing-merge scenarios).
- required_wiring anchors grepped directly (not assumed): `push_sweep_lib.bb`
  literal present in `swarmforge/git-hooks/post-commit` (line 29); `registerSteps`
  exported from `bl1390PushWhileFastForwardSteps.js` (line 84/220).

## BL-149 cooldown gate

- `swarmforge/git-hooks/post-commit`, `post_commit_push.bb`,
  `push_sweep_lib.bb` — the mutation sweep above already covers these; no
  new production logic beyond the rework already swept.
- `swarmforge/scripts/test/lib/fixture_isolation.sh` and
  `test_bl1390_post_commit_push.sh` — DECISION: run, but these are test
  scaffolding, not the ticket's own declared production invariants; their
  correctness is established here by direct empirical verification (the
  argv-corruption fix's own before/after repro in the earlier BL-1392 pass,
  plus 4 consecutive clean full-suite runs including the concurrency /
  single-instance / no-live-worktree-corruption checks) rather than a
  separate hand-authored mutant sweep on top of that.

## BL-113 Gherkin mutation

No `Scenario Outline` in the BL-1390 feature (all plain `Scenario:` blocks,
matching the architect's own confirmation) — inapplicable per BL-638.

## CRAP / DRY

`git show --stat 1677f85096` touches only
`backlog/evidence/BL-1390-architect-pass2-20260904.md` — no `extension/src`
file in this pass's own diff. N/A.

## Process / fixture hygiene

No orphaned `node --test`/`stryker` processes (two `bash` pids seen by an
early `pgrep` had already exited by the time of a follow-up `ps` check —
timing artifact, not a leak). The two long-lived `bb handoffd.bb` /
`bb handoffd_supervisor.bb` processes on this host are the LIVE swarm's own
standing daemons (root `/home/carillon/swarmforgevc`, 17+ minutes uptime at
the time checked) — not fixtures from this pass, not reaped.

## Result

Merge resolved (comparing content, not picking sides); a severe daemon-crash
defect in adjacent BL-1392 code found and fixed along the way, with the
holder notified; all of BL-1390's own invariants and required_wiring
re-verified clean, including the one check (`test_handoffd_push_sweep_wiring.sh`)
that could only pass once the crash was fixed. Forwarding to documenter.

By hardender.
