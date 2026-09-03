# BL-1339 — LAND SUCCESS, 20260903

Follows `BL-1339-qa-approval-20260903.md` (full independent verification,
APPROVE, `7ec9a42a12`).

## Tried land_step_cli.bb first — timed out

Since this parcel fixes the exact `record-land-approval!`/
`is_qa_ancestor.sh` mechanism used on every land this session, tried it as
the primary land path. It timed out after 2 minutes (BL-1332's
over-inclusion issue is still open — a large replay diff over the current
entangled sibling set is the plausible cause, consistent with earlier
`LAND_ESCALATE` runs this session naming dozens of siblings). Confirmed no
stray scratch worktree or `land-replay/*` branch was left behind before
falling back to the hand-build discipline used for every other land today.

## Verification (against the final tip-pure tree, before commit)

- Compile: clean.
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb`: ALL PASS.
- Acceptance
  (`specs/features/BL-1339-a-land-approval-record-lands-where-the-predicate-reads.feature`):
  7/7.
- Full diff against `origin/main` verified to match the intended 13-file
  own-paths list exactly before pushing.

## Landed

- Tip-pure commit `aeb31b00f4` pushed to `origin/main`
  (`fc946d174c..aeb31b00f4`), after a bounded rematch: `origin/main` had
  advanced by unrelated bookkeeping commits between building the commit
  and pushing; diffed clean of any BL-1339 file overlap, cherry-picked
  (`-x`) onto the new tip, content verified byte-identical, pushed.
- `swarmforge-QA` merged up to `aeb31b00f4` at `aa06fec9d2`. No conflicts
  (`specs/pipeline/steps/index.js` auto-merged cleanly).
- `abandoned_commits: [7ec9a42a12]` recorded on the ticket YAML.

## Note for future lands

With this fix now on `main`, `record-land-approval!` writes to the shared
target root rather than the caller's own worktree — future QA lands from
this worktree should now correctly produce a land-approval record every
downstream consumer (handoffd's push sweep, the babysitter's Article 4.2
sweep, the deploy freshness gate) can actually read, rather than one that
silently reaches nobody.

By QA.
