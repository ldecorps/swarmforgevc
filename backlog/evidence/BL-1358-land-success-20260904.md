# BL-1358 — LAND SUCCESS, 2026-09-04

The Gherkin mutation harness gains a per-mutant time ceiling (measured
incident: 808s hang). Human ruling: option 1 (a timeout fails the gate,
same as a surviving mutant), 300s default.

## Verification

- `npm run compile` — clean.
- `node --test specs/pipeline/test/bl1358MutantTimeCeiling.test.js` — 8/8.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1358MutantTimeCeilingInvariants.property.test.js` — 2/2.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1358's feature — 4/4.
- `bash specs/pipeline/test/bl1358_mutant_timeout_mutation_sweep.sh` —
  6/6 killed, 1 accepted-equivalent (re-derived independently: a
  SIGKILL-terminated `spawnSync` child reports `status:null`, never `0`,
  so `!timedOut` is redundant with `result.status===0` for every real
  input — verified, not just trusted from hardener's evidence).
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- No `extension/src` touched — CRAP/DRY N/A, matches hardener's own note.
- Human ruling conformance verified directly:
  `DEFAULT_MUTANT_TIMEOUT_MS = 300000` in `runnerAdapter.js`; the worker's
  timed-out branch is its own outcome (`timed_out: true`), never folded
  into `detected`/`surviving`.
- No `bounce_history`.
- Process hygiene clean before/after in this worktree (concurrent
  `node --test` under `.worktrees/coder` belongs to that role's own
  session, unrelated).

## Hand-built tip-pure commit — refused once by the property-suite guard

Built in scratch worktree `/tmp/land-bl1358`, off `origin/main` at
`c0e502ebd6` (the tip left by this session's BL-1380 land). Own-paths (13
files) from the coder/cleaner/architect/hardener/documenter evidence
trail, cross-checked against `git diff --name-only origin/main <QA-tip
87fc537e25>` — clean, no foreign-ticket content (BL-1367/BL-1380/BL-1385/
BL-1389 all already landed).

First commit attempt was correctly **refused** by
`check_property_suite_drift.sh` (Tier 2): 3 non-allowlisted failing files
under a 332-second run with heavy concurrent worktree load. Re-ran each of
the three in isolation before retrying — all clean (`bl1074PostCloseRefileDuration`,
`bl1367ApprovalCarriesItsRuling`, `bl956PipelineBoardCaptionCapInvariants`)
— resource-contention flakiness under load, not a regression this land
introduced. Retried the identical commit; passed.

## A live, unrelated incident found and fixed mid-land

While landing, `git push origin HEAD:main` failed:
`fatal: '/tmp/bl1390-post-commit-kTsiBL/does-not-exist.git' does not
appear to be a git repository`. Root-caused (full account:
`backlog/evidence/QA-bl1390-shared-git-config-origin-clobbered-20260904.md`):
BL-1390's own test fixture — running concurrently in `.worktrees/coder` —
had overwritten the shared repo's `.git/config` `[remote "origin"]` URL
with a fixture path, breaking `git push`/`fetch`/`ls-remote` for EVERY
worktree sharing this repo, not just mine. Fixed
(`git remote set-url origin git@github.com:ldecorps/swarmforgevc.git`),
verified with `git ls-remote origin main` before trusting any subsequent
push. Escalated to the specifier and coordinator (priority `00` notes) —
not fixed in BL-1390 itself (not my ticket, not yet reviewed by QA).

**Consequence for this land specifically**: my FIRST `land_main_publish.sh
--decide-only` / push attempt (before I diagnosed and fixed the remote)
silently failed at the network step while `land_main_publish.sh
--release-lock` still reported `LOCK_RELEASED` (that step doesn't verify
the push succeeded). Caught before reporting anything landed — cross-
checked `git ls-remote origin main` showed `origin/main` unchanged. Redid
the full `--acquire-lock` / `--decide-only` / push / `--release-lock`
sequence cleanly after the fix.

## Landed

- Tip-pure commit `485fd43bce` off `origin/main` at `c0e502ebd6`. Second
  (post-fix) `land_main_publish.sh --decide-only` read `:next :push`,
  `origin-advanced-since-gate: false`. Pushed `c0e502ebd6..485fd43bce`.
- No `abandoned_commits` follow-up: no automated `land_step_cli.bb`
  attempt was run for this ticket (hand-built directly, same posture as
  BL-1380).
- Scratch worktree `/tmp/land-bl1358` removed after confirmed push.

## Not a GH-seeded ticket

`BL-1358`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.
