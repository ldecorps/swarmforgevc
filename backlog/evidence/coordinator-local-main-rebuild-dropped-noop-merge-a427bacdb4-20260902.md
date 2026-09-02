# Local-main rebuild: dropped no-op landing merge `a427bacdb4` — 2026-09-02 18:4x UTC

Human authorised via my role_ask ("You run the rebuild (reset local main to
origin/main + cherry-pick -x ...)"). Inventory came from the specifier's
`backlog/evidence/specifier-commits-to-preserve-across-the-main-rebuild-20260902.md`,
extended by the three commits added after it (a0d66663fd, be9d3c0008, edff8f1069).

## What was done
- Built the new history in a throwaway worktree (`tmp/rebuild`, detached at
  `origin/main` = `a1450efaa3`), `git cherry-pick -x` over
  `git rev-list --reverse --no-merges origin/main..main` (18 commits).
- One came up empty and was `--skip`ped: `d2dd2d7ac2` "Restore the backlog
  half of what an interrupted merge reverted" — its content is already on
  `origin/main`, so nothing was lost.
- Moved `refs/heads/main` from `edff8f1069` to `7700e59c6c` with
  `git update-ref` guarded by the old value (no concurrent commit raced it);
  the shared checkout's working tree was never reset.
- Index re-pointed at HEAD for the five QA-exclusive paths (the specifier's
  unstaged worktree restores were byte-identical to `origin/main`, so they
  became clean rather than being committed twice).

## Verification
- `git branch --contains a427bacdb4` → nothing; `origin/main` is an ancestor
  of the new tip; `main...origin/main` = 17 ahead / 0 behind.
- `git diff --stat <old main> <new main>` = exactly the five QA paths the
  merge had dropped (`deprecate-check.ts`, `deprecateAdjudication.test.js`,
  `deprecateRoutingStampFingerprint.property.test.js`,
  `bl1338RoutingStampFingerprintSteps.js`, `steps/index.js`), +459/−2.
- Human actions preserved: `human_approval: approved` on BL-1344 and
  BL-1345; operator seat `claude-opus-5` in `ancillary_provider_lib.sh:286`.
- Old→new SHA map: 293da7cafe→60ac4e052b, 59f58cee68→4fb0dda801,
  cba2ac2f43→42fb9bb76b, 756a53bfbf→697405b202, 467672de55→6260e024ed,
  ade60c93b7→8086167ed2, 3222685ab3→cffef2b68d, 08b0aa95ef→061060702b,
  57174f3af6→caf0f6c3ac, 3809c99042→a3d25e3c87, d4e356c4fa→5fc4ad8c7c,
  b4e7a18c43→9f4520dae5, 1b41afef11→d877378cd1, faeecf8b1b→37a67d4abb,
  a0d66663fd→0de78df132, be9d3c0008→a32275f7e7, edff8f1069→7700e59c6c.

## Residual: push still refused, different guard
`push-sweep noop-merge-refused` is gone. The next tick logged
`push-sweep qa-refused non-qa-ancestor 7700e59c6c,9f4520dae5,60ac4e052b`:
the three specifier mint commits (BL-1344, BL-1345, BL-1346) touch
`specs/features/*.feature`, and `specs/` is not in
`push_sweep_lib.bb`'s `bookkeeping-only-path?` allowlist (`backlog/`,
`docs/`, `swarmforge/`), so the tip must be reachable from `swarmforge-QA`.
This pre-dates the rebuild (the old SHAs were not QA ancestors either) and
was masked by the noop-merge refusal. Cure is the designed one: QA merges
`main` (`7700e59c6c`) into `swarmforge-QA`; asked QA by note. No guard was
edited.

By coordinator.
