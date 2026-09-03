# BL-1337 — LAND SUCCESS, 20260903

Follows `BL-1337-qa-approval-20260903.md` (full independent verification,
APPROVE, `1411a4ae27`).

## land_step_cli.bb escalated on a known false positive

`bb swarmforge/scripts/land_step_cli.bb BL-1337-a-profile-generates-a-
handshaken-cast 1411a4ae27` returned `LAND_ESCALATE`:
`backlog/active/BL-1337-a-profile-generates-a-handshaken-cast.yaml is
shared with unlanded sibling(s) BL-1344`.

Diagnosed rather than blindly escalated further or blindly overridden:

- `BL-1344` is already in `backlog/done/M8/` **and** confirmed byte-present
  on `origin/main` (`git show origin/main:backlog/done/M8/BL-1344-...yaml`
  succeeds) — it is landed, not entangled.
- `git log --oneline origin/main..1411a4ae27 -- backlog/active/BL-1337-
  a-profile-generates-a-handshaken-cast.yaml` shows the "shared" commit is
  `deca071e56 Merge QA f1e6a3fd92 (BL-1344 merge-up broadcast) into
  cleaner.` — a merge-up-broadcast merge whose SUBJECT names BL-1344,
  which the attribution walk keys on, even though the file it touched here
  is BL-1337's own ticket YAML (mint/approve/promote already on
  `origin/main` independently of this parcel).
- This is the exact class **BL-1354** (paused, `human_approval: pending`,
  depends_on `[BL-1332, BL-1272]`) already exists to fix — its own
  `approval_context` states plainly: "a safety gate that refuses on
  already-landed tickets is a gate the operator routes around - QA has
  stopped trusting its verdict and hand-builds every land." Not a novel
  workaround; the documented current practice for this exact failure mode.
- Positive verification, not absence-based: diffed `origin/main` against
  the approved commit for every file this parcel touches. The ticket YAML's
  diff is exactly the `bounce_history` block this ticket's own bounce
  added, nothing else. The other two shared files
  (`docs/index.md`, `specs/pipeline/steps/index.js`) each diff to exactly
  one line/require added on top of `origin/main`'s unchanged content
  (BL-1328/1344/1345/1346/1351's existing entries and requires all intact).
  No sibling content anywhere in what was about to be landed.

## Hand-built tip-pure commit, own-paths derived and cross-checked

- Own-paths list (21 files) derived by isolating this ticket's file scope
  from the full documenter-lineage diff, then **independently cross-
  checked**: `git diff origin/main 1411a4ae27 --stat -- <the 21 paths>`
  matched the staged tip-pure worktree's diffstat byte-for-byte (21 files,
  1762 insertions, 11 deletions). Also diffed the FULL `origin/main..
  1411a4ae27` range (50 files) and confirmed every one of the other 29 is
  a different ticket's own bookkeeping (BL-1296/1328/1342/1344/1345/1346/
  1351/1353/1354/1355/1356/1359/1317) — no BL-1337 file omitted
  (BL-1317's hand-enumeration-omission trap, checked for and not present).
- Built on temp worktree/branch `bl1337-landtry`, off `origin/main` at
  `0fee5cc2e4`. `git checkout 1411a4ae27 -- <21 paths>` — `git status`
  confirmed exactly those 21 files staged, nothing extra.
- Re-verified on the tip-pure tree before commit (symlinked
  `node_modules` from this worktree, compiled fresh against
  `origin/main`'s own TypeScript source): compile clean;
  `bl1337_profile_cast_test_runner.bb` ALL PASS; acceptance 7/7 (BL-1337)
  and 3/3 (BL-1181, the extended sibling); `bl1337ProfileCastInvariants`
  property test 3/3; `bob_starting_cast_test_runner.bb` and
  `model_steward_test_runner.bb` ALL PASS.

## Landed

- Tip-pure commit `9e6ae3743e` built on `bl1337-landtry` off `origin/main`
  at `0fee5cc2e4`. `origin/main` had not advanced between building and
  pushing (re-fetched and confirmed immediately before push) — no rematch
  needed.
- Pushed: `0fee5cc2e4..9e6ae3743e` to `origin/main`.
- `swarmforge-QA` merged up to `9e6ae3743e`. No code conflicts (the merge
  pulled in unrelated concurrent bookkeeping: BL-1354/1356 promoted to
  active, BL-1328 moved to done, BL-1359 minted).
- `abandoned_commits: [1411a4ae27, 23b489d554]` recorded on the ticket
  YAML — the original QA-approval commit and the actual
  `last-handoff-commit` (`task-scope-gate-lib/last-handoff-commit`
  resolved it to the hardener merge, not the documenter's own commit).
- Temp branch `bl1337-landtry` and its worktree removed;
  `.swarmforge/land-main.publish.lock` released.

By QA.
