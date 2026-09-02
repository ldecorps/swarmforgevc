# BL-1343 — LAND SUCCESS, 20260902

Follows `BL-1343-qa-approval-20260902.md` (full independent verification,
APPROVE, `7f9ca8fa99`).

## Dogfooding the fix on its own land

Ran `bb swarmforge/scripts/land_step_cli.bb
BL-1343-replay-drops-the-tickets-own-path 7f9ca8fa99` from this worktree
(whose own copy of `land_step_lib.bb` already carries the fix). It returned
`:replay` with **34** own-paths — most of them unrelated to this ticket
(done-file moves for BL-1330/BL-1338/BL-1340, BL-1323 paused/active/topic
files, coordinator evidence files, `handoff_lib_test_runner.bb`).

**This is expected, not a regression.** The ticket's own description is
explicit that it is the mirror of BL-1332 (a path dropped OUT of the
replay), not a fix for BL-1332 itself (a shared/untagged path taken IN
whole) — and the coder's own evidence (`qa_e2e_procedure` answer 5) states
plainly: "this fix is not expected to reduce the sibling count by itself...
The count collapse... would come from the attribution walk, which the
constraints keep out of scope here." `own-paths`' inclusion side (what
counts as this ticket's own contribution when NOT solely attributed to an
unlanded sibling) is unchanged by BL-1343 — only the exclusion side's
silence is fixed. Confirmed by reading `land-plan`: `own-paths` returned
non-nil here (34 paths), so `land-plan` picked `:action :replay`, never
`:escalate` — the specific silent-full-exclusion misreport this ticket
targets did not fire, because it wasn't the failure mode present.

So `land_step_cli.bb`'s own replay output could not be trusted for landing
BL-1343 either, for the same reason it couldn't be trusted for BL-1317 or
BL-1340 earlier today: BL-1332's over-inclusion is a separate, still-open
defect. Hand-built the tip-pure commit instead, from BL-1343's own pipeline
commits, each path individually diffed against `origin/main` to confirm no
contamination — the diff of the resulting commit against `origin/main`
matched my intended own-paths list exactly (16 files, verified before
push).

## Verification (against the final landed tree)

- Compile: clean.
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS.
- Acceptance (`specs/features/BL-1343-replay-drops-the-tickets-own-path.feature`):
  6/6.
- Property invariants
  (`extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js`):
  2/2.
- `test/docsStructureRealTree.test.js`: 5/5 — no orphaned doc (this ticket
  added no new doc file, only amended existing ones).

## Landed

- Tip-pure commit `d8a86b7f9a` pushed to `origin/main` (`5e28f4e588..d8a86b7f9a`).
- `swarmforge-QA` merged up to `d8a86b7f9a` at `03993424b6`. One conflict in
  `specs/pipeline/steps/index.js`: purely additive on both sides
  (BL-1056's require line only on QA, BL-1343's own line already on both) —
  kept both.
- `abandoned_commits: [7f9ca8fa99]` recorded on the ticket YAML — the
  originally QA-approved commit is superseded by this tip-pure replay.

By QA.
