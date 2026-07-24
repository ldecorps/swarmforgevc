# BL-531 — architect review, PASS (2026-07-24)

Parcel: `6ed07fe785` (cleaner) — rework of architect send-back `4da499ea3b`.
Reviewed on architect review-merge `8e8df5c194`.

## What the rework changed

`pre_qa_gate_gather_lib.bb` condition 5 (`no-dropped-work?`). The shipped
version excluded only a merge with a literal EMPTY first-parent diff, or a
commit whose tree is identical to the cited commit. Neither shape is an
ordinary role ticket-naming merge, whose first-parent diff is the whole
incoming parcel and whose tree also carries the branch's own prior content —
the exact shape of `3a57a807fe` that my send-back reproduced.

`empty-diff-against-first-parent?` is gone, replaced by
`merge-introduces-nothing-unique?`: a 2+-parent commit whose COMBINED diff
against all parents (`git diff-tree -m --cc`) is empty. The old test is the
degenerate case of the new one, so nothing was lost by deleting it.

## Verification performed

1. **The send-back reproduction now passes on its own merits.** With this
   ticket's `abandoned_commits:` escape hatch temporarily blanked to `[]` —
   the condition under which the previous build refused and flagged
   `3a57a807fe` — `pre_qa_gate.sh BL-531-pre-qa-durability-wiring-gate <HEAD>`
   returns `OK`, exit 0. The hand-added sha is no longer load-bearing.
2. **Non-vacuous.** Neutering `merge-introduces-nothing-unique?` to `false`
   fails acceptance examples **[1]** (empty first-parent diff) and **[3]**
   (merge into a branch with unrelated prior content) while **[2]**
   (tree-identical, non-merge) stays green — i.e. the new check, not the
   surviving tree check, is what excludes the newly-covered shape. Restored.
3. **The widening does not blanket-exclude merges.** Verified the git
   semantics independently in a scratch repo (git 2.43.0): a clean merge
   yields a 0-byte combined diff (excluded), an evil merge that adds content
   of its own yields 108 bytes (still a finding). So a merge that genuinely
   carries dropped work is still refused.
4. Acceptance `specs/features/BL-531-pre-qa-durability-wiring-gate.feature`:
   **16/16** (was 15/15; the third Example is new).
5. `bb swarmforge/scripts/test/pre_qa_gate_lib_test_runner.bb`: ALL PASS.
6. Live send path unaffected: `test_swarm_handoff_sync_deliver.sh` and
   `test_swarm_handoff_daemon_backup.sh` both ALL PASS.
7. `npm run test:properties`: 32/32 across 10 files.

## Architecture

- **Dependency gate (hard gate): PASSED** — full-repo scan,
  `node extension/out/tools/dependency-gate.js`, no forbidden edges.
- Layering unchanged and correct: the change is confined to the git/fs
  ADAPTER (`pre_qa_gate_gather_lib.bb`). The pure decision layer
  (`pre_qa_gate_lib.bb`) still receives `no-dropped-work-set` as injected
  plain data and knows nothing about git. Policy stays independent of the
  IO detail that moved.
- No dead code: the superseded helper was deleted rather than left orphaned.
- Scope clean (BL-506): the rework touches only this ticket's own four files
  — ticket YAML, feature, step handler, gather lib. The untracked
  `swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh` in
  this worktree is operator hot-sync residue, has no BL-531 ticket, and was
  deliberately left unstaged.
- Co-change (informational, no auto-bounce): step handler ↔
  `pre_qa_gate_gather_lib.bb` at 3, flagged SUSPECTED COUPLING. Intended and
  documented — the ticket states the git-facing gather layer is covered end
  to end through the Gherkin fixture rather than a scratch-git `.bb` runner,
  so its fixture necessarily moves with it.

## Property testing

No property test is warranted by this rework and none was added. The touched
production module is a Babashka git adapter; fast-check applies to the pure
TS/JS modules only, and the pure decision surface here is Clojure with its
own `.bb` unit runner. Manufacturing a property here would be vacuous.

## Observations carried forward (neither blocks the parcel)

1. **Spec authorship.** The ticket YAML's condition-5 wording and its
   `acceptance:` section were amended by the **coder**, not the specifier.
   The edit is faithful to what my send-back demanded and it STRENGTHENS the
   QA procedure (step 9 now also requires the second merge shape), so it is
   not a defect. But one clause is the coder justifying, inside its own
   acceptance criteria, why `no-dropped-work?` needs no separate `.bb`
   runner. The specifier should ratify (or restate) that clause rather than
   inherit it unreviewed. Flagged here rather than bounced: the parcel is
   correct, and the amendment travels WITH it, so no role is left on a stale
   copy.
2. **Docstring/behaviour drift (cosmetic).** `no-dropped-work?`'s docstring
   says "a NON-MERGE commit whose tree is identical to the cited commit",
   but the tree branch is applied to every commit, merges included. The
   behaviour is a harmless superset of the documented one.
3. **Fixture nit.** The new Example-3 fixture leaves the coder worktree
   checked out on the scratch branch `bl531-other-content-side` instead of
   returning to the role branch the way Example 1 does. The candidate is
   still discovered (proven by the neuter run above, which fails that
   example), because the gate keys on "branch checked out at the worktree",
   not on the branch's name — so the test is meaningful, just a slightly
   looser analogue of the real `3a57a807fe`.

## Verdict

PASS — forwarded to hardender at the same task name.

By architect.
