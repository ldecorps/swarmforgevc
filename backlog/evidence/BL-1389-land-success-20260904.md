# BL-1389 — LAND SUCCESS, 2026-09-04

The structural fix minted from this session's own BL-1386 land escalation
(`backlog/evidence/BL-1386-land-escalate-adjudication-20260904.md`).

## Verification

- `npm run compile` — clean.
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — 2 failures,
  both the already-ticketed `BL-1388` fixture rot (a tree-guard fixture
  still asserting the hand-maintained-registry model BL-1371 retired) —
  confirmed by grep (`backlog/paused/BL-1388-...yaml` exists) and by
  hardener's own evidence (coder/cleaner/architect all independently hit
  and attributed the same two failures). Not caused by BL-1389.
- `npx vitest run --config vitest.properties.config.mjs` on both
  `bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js` (3/3,
  all three declared invariants) and
  `bl1308SiblingDetectorCoversReplay.property.test.js` (2/2, the widened
  consumer unaffected) — 5/5 total.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1389's feature — 5/5.
- Both `required_wiring` anchors confirmed live: `land_step_cli.bb`'s
  `EXCLUDED_SIBLING_PATH` literal (2 occurrences), and
  `bl1389UnlandedSiblingPathNeverRidesSteps.js::registerSteps`.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- No `extension/src` touched — CRAP/DRY N/A, matches hardener's own note.
- No orphaned test/mutation processes in this worktree (a concurrent
  `node --test` under `/home/carillon/swarmforgevc/.worktrees/coder`
  belongs to that role's own session, not reaped — not this worktree's
  orphan).

## Hand-built tip-pure commit, rebuilt once mid-build

Built in scratch worktree `/tmp/land-bl1389`, off `origin/main` at
`438951f8e8` (the tip left by this session's BL-1385 land). Own-paths (18
files) from the coder/cleaner/architect/hardener/documenter evidence
trail, cross-checked against `git diff --name-only origin/main <QA-tip
4e99318dc6>`. `docs/index.md` and `docs/reference/Specification.MD`
line-spliced (both shared, append-only) — BL-1389's own single-line
`docs/index.md` extension and its top-of-stack `Specification.MD` entry,
no foreign content in either diff this time (BL-1367 already landed, so
its files no longer rode).

**Rebuilt once**: while committing, concurrent specifier/coordinator
activity (BL-1390/1391 minting, and — per this session's own merge-up
notes — the coordinator's bookkeeping closing BL-1385 and BL-1367 to
`done/`) advanced `origin/main` out from under the scratch worktree's
original base. Caught by `git log --oneline <old-base>..origin/main --
<each own-path>`: only `backlog/topics/BL-1389.json` (a Telegram-topic
chat log, inert bookkeeping) had diverged, and origin/main's copy was
already the fuller one (two messages vs. my stale one) — took origin's
copy unchanged rather than re-adding my own. No other own-path's content
differed. Re-verified (compile, both property test files, acceptance,
guard) on the rebuilt tree before the actual commit.

## Landed

- Tip-pure commit `3ccd66af9a` off `origin/main` at `f9e90a024e` (the
  fresher tip reached during the rebuild). `land_main_publish.sh
  --decide-only` read `:next :push`, `origin-advanced-since-gate: false`.
  Pushed `f9e90a024e..3ccd66af9a`.
- No `abandoned_commits` follow-up: `land_step_cli.bb`'s own attempt on
  this ticket never produced a replay commit (`LAND_ESCALATE` fired at
  "nothing to commit... own-paths identical to origin/main" — the
  separate, known merge-tip first-parent-attribution gap, not what this
  ticket fixes).
- Push went through `land_main_publish.sh --acquire-lock` /
  `--decide-only` / `--release-lock` (BL-1144 discipline), run from the
  scratch worktree.
- Scratch worktree `/tmp/land-bl1389` removed after push.

## Not a GH-seeded ticket

`BL-1389`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.
