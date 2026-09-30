# Finding while hardening BL-1816 (2026-09-30): architect branch carries a silent content revert, unrelated to this ticket

## What happened

Merging the architect's BL-1816 tip (7f030428a4) into the hardender
worktree produced a criss-cross merge with THREE merge-base candidates
between this branch and the architect's:

- 048bfaaaf6 (origin/main, the architect branch's real starting point -
  no BL-1830 content)
- 55e84f3079 (this branch's own BL-1846 architect-evidence commit,
  already merged into the architect branch earlier - HAS BL-1830 content)
- 588772cf4a (this branch's own earlier BL-1816 hardener pass, also
  already merged into the architect branch - HAS BL-1830 content)

`git merge`'s virtual-base resolution across these three candidates
resolved `swarmforge/scripts/land_step_lib.bb` (and 9 sibling paths:
`land_step_cli.bb`, `land_step_lib_test_runner.bb`, the three BL-1830
step/CLI/property-test files, the BL-1717 files BL-1830 retired,
`docs/how-to/BL-1241-*.md`, `docs/reference/Specification.MD`) to the
STALE (no-BL-1830) blob, even though the architect's own real commit
range (`git diff 048bfaaaf6 7f030428a4 -- <path>`) never touches ANY of
these paths - confirmed empty for every one.

Traced to `9b7ffc18a9` ("Merge cleaner eb73f45916 into architect") on
the architect branch itself: its first parent `6b1cd1d85c` ("Merge main
048bfaaaf6 into architect") correctly carries the BL-1830 blob
(`f4cbcc9c23`); merging cleaner's `eb73f45916` into it reverted
`land_step_lib.bb` back to the stale blob (`4afdd34c1e`) with **no
conflict recorded** - a silent revert, not a bounce or an edit. The
architect branch's CURRENT live tip (as of this finding) still carries
that same stale blob:
`git rev-parse swarmforge-architect:swarmforge/scripts/land_step_lib.bb`
= `4afdd34c1e59dc577b9e902e514ac5758571b02a`, same as the corrupted
commit. The cleaner branch's CURRENT live tip, by contrast, already
carries the correct blob (`f4cbcc9c23...`) - it appears to have
self-healed via a later main-sync, but the architect branch has not
re-synced since 9b7ffc18a9 and remains corrupted.

## Why this note, not a bounce

BL-1816 itself is untouched by this - its own diff is 9 files, all in
its own scope (ticket YAML, evidence, docs paragraph, step handler,
`prompt_engine_lib.bb`, its test runner). I restored the 10 affected
paths to this branch's own pre-merge content before committing the
merge (`6eaf75dffc`), verified `land_step_lib_test_runner.bb` ALL PASS
(was 19 failures), and forwarded BL-1816 normally. This note is about
the STANDING state of the architect (and, until it re-syncs, any
branch built from it) worktree branch, which will silently ship
without BL-1830's content on the NEXT ticket that passes through it
unless someone re-syncs or otherwise fixes it - a live hazard to a
future parcel, not a defect in this one.

## Evidence commands

```
git merge-base --all <hardener-tip> 7f030428a4
# 048bfaaaf6814f0bbcd449f615a54cdcc0a778ee
# 55e84f3079a60b917439b2acc92f17ab9ffb9f93
# 588772cf4a6944c4158773558825e11ec0039182

git diff 048bfaaaf6 7f030428a4 -- swarmforge/scripts/land_step_lib.bb
# (empty)

git rev-parse 6b1cd1d85c:swarmforge/scripts/land_step_lib.bb
# f4cbcc9c230465bf4db8aaad2d82b6b3201a032b  (correct, has BL-1830)
git rev-parse 9b7ffc18a9:swarmforge/scripts/land_step_lib.bb
# 4afdd34c1e59dc577b9e902e514ac5758571b02a  (WRONG, lacks BL-1830 - silently reverted)

git rev-parse swarmforge-architect:swarmforge/scripts/land_step_lib.bb
# 4afdd34c1e59dc577b9e902e514ac5758571b02a  (still corrupted, as of this finding)
git rev-parse swarmforge-cleaner:swarmforge/scripts/land_step_lib.bb
# f4cbcc9c230465bf4db8aaad2d82b6b3201a032b  (cleaner branch has already self-healed)
```

By hardender.
