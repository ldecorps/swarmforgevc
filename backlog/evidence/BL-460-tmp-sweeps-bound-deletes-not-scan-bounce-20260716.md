# BL-460 QA Bounce — 2026-07-16

1. **Failing command**: `git merge-base --is-ancestor f368bc771f 41efd493d7`
   (per QA.prompt's "commit you are about to APPROVE actually contains THIS
   ticket's own work" check, and the constitution's "Forwarded Commits Carry
   Their Lineage" rule) — exits non-zero (not an ancestor).

2. **Commit hash checked out and tested**: `41efd493d7` (documenter's
   git_handoff to QA, task `BL-460-tmp-sweeps-bound-deletes-not-scan`).

3. **First error excerpt**:
   ```
   $ git log --oneline -1 --format="%H %P" 41efd493d7
   41efd493d70392b3e925a1a04e666e6556309964 35ce467620f97fcc5ebba31d024c7d70e349b22a

   $ git ls-tree -r 41efd493d7 --name-only | grep bounded_delete
   (no output — file absent)

   $ git ls-tree -r 353da203 --name-only | grep bounded_delete
   swarmforge/scripts/bounded_delete_sweep_lib.bb
   swarmforge/scripts/test/bounded_delete_sweep_lib_test_runner.bb
   ```
   `41efd493d7` has exactly ONE parent — `35ce4676` (QA's own prior merge
   commit for an unrelated ticket, BL-434) — not the hardener's `f368bc77`.
   None of the coder/cleaner/architect/hardener BL-460 commits
   (`353da203`, `df82595d`, `d7c0c424`, `d156a4f6`, `f368bc77`) are ancestors
   of `41efd493d7`. The commit that reached QA is a docs-only diff
   (`docs/reference/Specification.MD`, +3/-1) with none of the actual fix:
   `bounded_delete_sweep_lib.bb` does not exist in the tree, and
   `swarmforge/scripts/operator_runtime.bb` / `fixture_reaper_sweep_lib.bb`
   carry none of the cursor/windowing change described in the ticket.

4. **Failure class**: `integration` — the parcel forwarded to QA does not
   contain the ticket's implementation at all (a lineage/merge failure, not
   a broken build or a behavior mismatch in the actual fix, which was never
   received).

5. **Expected vs observed**: Expected — QA's checked-out commit contains the
   full BL-460 chain (coder's `bounded_delete_sweep_lib.bb` windowing fix,
   cleaner's dedupe, architect's review, hardener's Gherkin-mutation-killed
   acceptance) as ancestors, ready for the final gate. Observed — the
   documenter's forwarded commit is a docs-only commit built on QA's own
   prior unrelated merge (`35ce4676`, BL-434), never merging the hardener's
   `f368bc77` (or anything upstream of it) into its own worktree first. The
   real fix work is intact in git history at `f368bc77` and below — it
   was simply never merged forward before the documenter committed and
   forwarded.

This is Operator-URGENT-expedite work (BL-460 fixes a live production wedge:
76 orphan processes untouched, /tmp growing +21/min) — the missing merge
means the actual fix has NOT reached QA and cannot be verified, let alone
landed on `main`.
