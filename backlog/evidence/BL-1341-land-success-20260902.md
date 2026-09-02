# BL-1341 — LAND SUCCESS, 20260902

Follows `BL-1341-qa-approval-20260902.md` (full independent verification,
APPROVE, `f27ad4b607`).

## Same discipline as BL-1317/BL-1340/BL-1343 earlier today

`land_step_cli.bb`'s replay could not be trusted for this land either —
BL-1332 (the mirror over-inclusion case) is still open, so `own-paths`
still sweeps in untagged/shared paths beyond this ticket's own. Hand-built
the tip-pure commit from BL-1341's own pipeline commits instead, each path
individually diffed against `origin/main` before staging.

One near-miss caught before committing this time (BL-1340's mistake, not
repeated): `docs/index.md`'s whole-file checkout from `swarmforge-QA`
diffed dirty against `origin/main` — it carried BL-1056's unrelated line
again. Edited just the one BL-1242 index line by hand instead of checking
out the whole file. `docs/reference/Specification.MD`'s diff was checked
too and came back clean (its changelog-prepend pattern is inherently
additive-only).

## Verification (against the final tip-pure tree, before commit)

- `bash swarmforge/scripts/test/test_merge_deletion_guard.sh` — ALL PASS
  (14/14).
- Acceptance (`specs/features/BL-1242-merge-never-silently-drops-branch-work.feature`):
  12/12.
- Full commit diff against `origin/main` verified to match the intended
  16-file own-paths list exactly, `docs/index.md`'s diff confirmed to be
  exactly 2 lines (the one edit), before pushing.

## Landed

- Tip-pure commit `246138fffe` pushed to `origin/main`
  (`b01e686cfb..246138fffe`), after a bounded rematch: `origin/main` had
  advanced by 6 unrelated commits (BL-1332/BL-1271/BL-1343 bookkeeping)
  between building the commit and pushing; diffed clean of any BL-1341
  file overlap, cherry-picked (`-x`) onto the new tip, content verified
  byte-identical, pushed.
- `swarmforge-QA` merged up to `246138fffe` at `5d1e03ce02`. No conflicts.
- `abandoned_commits: [f27ad4b607]` recorded on the ticket YAML — the
  originally QA-approved commit is superseded by this tip-pure replay.

By QA.
