# BL-1242 — coder check after "re-dispatch: never started" note, 20260829

Coordinator note: "Re-dispatch BL-1242-merge-never-silently-drops-branch-work:
never started".

## Check performed

1. `swarmforge/scripts/check_merge_deletion.sh` already exists on
   `origin/main` (`cce70d985`), and `swarmforge/git-hooks/commit-msg` already
   calls both `check_ticket_deletion.sh` and `check_merge_deletion.sh`
   (`status=$?`-style, not short-circuiting — matches this ticket's own
   Guardrails posture).
2. Git history on `origin/main` shows this already went all the way through
   the pipeline once: `b6cb7a951` "Merge documenter bcd78251f8 for
   BL-1242-merge-never-silently-drops-branch-work. By QA.", then a QA
   merge-up broadcast (`ae08aabbc`, `c924c11f4` "...merge-up approved
   b6cb7a951b. By coder.").
3. After merging `origin/main` into this coder worktree (same merge as the
   BL-1247 check, see `BL-1247-coder-rebuild-check-20260829.md`), `git diff`
   between my worktree and `origin/main` is empty for every BL-1242 file
   (`check_merge_deletion.sh`, `commit-msg`, `bl1242MergeBranchWorkDeletionSteps.js`,
   `test_merge_deletion_guard.sh`, and the ticket YAML itself) — content is
   byte-identical.

## Conclusion

Same shape as BL-1247-bl593: the fix is fully landed and QA-approved on
`origin/main` already. "Never started" is not correct — nothing for the
coder to rebuild. `backlog/active/BL-1242-merge-never-silently-drops-branch-work.yaml`
still reads `status: todo` on main; the ticket's `notes:` field itself
records the 2026-08-28 coder implementation and QA-verified test results.

## Systemic flag

Two consecutive dispatches to coder this session (BL-1247-bl593 and BL-1242)
were both fully-shipped work re-presented as needing a rebuild. Both tickets
were caught up in the same 2026-08-28 expedite-park dance
(`44514c664` moved BL-1233/1234/1242/1244/1247/1249 active→hold,
`e0a3077dc` cleared them back) — plausibly the coordinator/bookkeeping step
that should have flipped `status: todo` → `done` and moved the YAML to
`backlog/done/` after QA's approval never ran for tickets caught in that
park/clear cycle. Recommend the specifier/coordinator audit the other sibling tickets from
that same park for the same stale-status shape before dispatching any of
them to a worktree role as fresh work. Checked at write time: BL-1233 and
BL-1244 are already correctly in `backlog/done/` on current `origin/main`
(picked up by this same merge); BL-1234 and BL-1249 are still sitting in
`backlog/active/` with `status: todo` and were not independently verified
for landed-vs-not here — worth the same check before re-dispatch.

By coder.
