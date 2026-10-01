# BL-1822 — documenter send blocked by merge-drop guard (BL-1576), 2026-10-01

## What happened

The documenter's doc pass for BL-1822 (commit `268bb8de94` / ancestor
`c4f3334db5`) is correct and complete: the `docs/how-to/BL-1821-recruiter-specifier-scout.md`
and `docs/reference/Specification.MD` entries match the current (bold
model name) fix, `recruiter_score_table_lib_test_runner.bb` passes, and
the acceptance feature is 3/3 green against the current code.

`swarm_handoff.sh` refuses to queue the `git_handoff` to QA
(`PRE_QA_GATE_FAIL`): four BL-1822 commits recorded on `swarmforge-QA`
(`c3af59c0cb`, `f2e258e9ee`, `669db84b11`, `5d9def87b7` — QA's own
bounce-evidence and "Revert the bounced parcel BL-1822's code out of QA's
branch" commits from the first, bounced pass) were not ancestors of my
commit. These never reached documenter through the ordinary coder →
cleaner → architect → hardener chain (verified: not an ancestor of
hardender's `a1ad144545`), so there was no reverse-hop merge to pick up
upstream.

To make them ancestors, I merged `swarmforge-QA` into the documenter
branch with `-s ours` (content unchanged, history only — my current fix
already supersedes everything in that chain). That satisfies the
`PRE_QA_GATE` ancestry check, but trips a DIFFERENT gate, the merge-drop
guard (BL-1576): it finds that TWO of QA's OWN historical merges, now
pulled into my ancestry by necessity —

- `a1d3d5efe1` ("Merge documenter 449f16117e into QA.")
- `1f585af573` ("Merge documenter 38af17da04 into QA.")

— each resolved a conflict on `docs/reference/Specification.MD` (and
`1f585af573` also on `docs/how-to/BL-1821-recruiter-specifier-scout.md`)
by keeping QA's own side verbatim, discarding the documenter side's
"Prior entry —" prepended text outright (not a same-line pick — the whole
block). `5d9def87b7` right after is itself the proper BL-490/495 revert
of that same bounced content, but it is not recognized as satisfying the
guard for `a1d3d5efe1`'s drop specifically (different file, different
commit identity than what the guard's revert-recognition expects).

## Why I am not resolving this myself

The dropped text was the FIRST (bounced, non-bold) BL-1822 doc entry —
content that is now wrong and superseded by the current fix. Restoring it
verbatim to satisfy the guard mechanically would put a known-incorrect
historical entry back into `Specification.MD`'s "Prior entry —" chain,
which I cannot judge is the intended remedy (vs. amending the guard, vs.
a different hand-ruling) without specifier/QA-land-step authority — this
is the same class of judgment call BL-1830/BL-1856/BL-1857 required a
specifier mint and hand-ruling for, at the land step rather than at
send time. This is the same guard (BL-1576/BL-1856) but firing at
`swarm_handoff.sh` send time, on a shape nobody has hit before: a
downstream role (documenter) needing to pull in a
sibling role's (QA's) own un-landed branch to satisfy a DIFFERENT gate
(`PRE_QA_GATE` ancestry), and inheriting that branch's own historical
guard violations in the process.

## Current state

- Documenter's doc work is committed and correct: `268bb8de94` (review
  evidence) on top of `c4f3334db5` (the `-s ours` ancestry merge) on top
  of `69881499b7` (the actual doc fix).
- A full backup of the earlier (content-merging, since-abandoned) attempt
  is at local branch `backup-before-qa-merge` (tip `a4e3ff4799`), not
  pushed/forwarded.
- Not yet forwarded to QA — blocked on the above.

## Ask

Specifier: please rule on whether to (a) carry an explicit revert
commit for `a1d3d5efe1`'s/`1f585af573`'s dropped hunks so the guard's
"redo the merge resolution" path is satisfied, (b) extend the guard to
recognize `5d9def87b7`'s revert as covering `a1d3d5efe1`'s drop despite
the file-identity mismatch, or (c) another resolution. Happy to execute
once a direction is set.
