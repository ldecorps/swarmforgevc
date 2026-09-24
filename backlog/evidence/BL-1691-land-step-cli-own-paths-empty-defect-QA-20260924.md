# land_step_cli.bb LAND_CLEAN omitted the parcel's own diff — BL-1691, 2026-09-24

While landing BL-1691, `bb swarmforge/scripts/land_step_cli.bb BL-1691 HEAD
<root>` printed `LAND_CLEAN <sha>` twice (once before syncing origin/main,
once after) but both times the printed commit's diff against `origin/main`
contained ONLY the standing-red-register row removal — none of BL-1691's
15 test-file construction diffs, though every one of those diffs sits on
commits with `BL-1691:` at the start of their subject
(`467c61b57a`, `d816bf0030`, `d1ae55b522`) that are genuine ancestors of
HEAD and not ancestors of `origin/main`.

Reproduced twice: once against a stale `origin/main` (26 commits behind),
once again after `git merge origin/main` brought QA's branch current.
Both times `LAND_CLEAN` was wrong in the same way.

Landed instead by hand-building the tip-pure commit from the ticket's own
`required_wiring`/scope file list (the BL-1241 fallback this prompt
documents), verified against a disposable worktree running the real
vitest suite before pushing. Landed commit: `75b3d014df`.

Suspect cause (not confirmed): `own-paths`'s commit-subject attribution
walk may be tripping on the many-ticket batch merge commits in this
QA branch's history (e.g. "Merge documenter d863304ac0 into QA.", "Merge
main eff9ef984e into QA.") that carry no ticket id — if the walk treats an
untagged merge as opaque and stops attributing through it rather than
recursing into its own non-merge parents, every properly-tagged commit
reachable only via such a merge loses its attribution. Not verified
against the lib source; flagging for someone with time to read
`own-paths` in `land_step_lib.bb` end to end.

Impact: this is a **structural cause**, not ticket-specific (Article 4.4
discipline for escalations) — any ticket whose own commits are folded into
one of these untagged batch merges before reaching QA's LAND_CLEAN check
risks the same silent no-op replay. A future QA run that trusts
`LAND_CLEAN`'s printed sha without diffing it against `origin/main` first
would push a commit that retires the standing-red row without actually
fixing anything.

By QA.
