# BL-952 hardener pass (round 2, post QA-bounce D1 fix) — 2026-08-19

## Reviewed commit
`869f4c0960` ("BL-952: architect pass 2 (post QA-bounce D1 fix) - clean,
forwarding to hardener"), merged into hardener as this parcel.

## Merge note (own worktree hygiene, not the parcel's own defect)
Merging this commit hit a genuine "revert-of-a-revert" trap: my own
earlier merge of QA's BL-620 broadcast had carried QA's legitimate revert
of BL-952's (then-bounced) content, reverting `is_qa_ancestor.sh`,
`push_sweep_lib.bb`, `handoffd.bb`, both `push_sweep_lib_*_runner.bb`, and
my own `test_is_qa_ancestor_yaml_store.sh` back to their pre-BL-952 state
in my worktree. The architect's re-approval branch (this commit) never
saw that revert — it descends directly from the original, un-reverted
BL-952 work plus the coder's new D1 fix. Git's mechanical 3-way merge
(merge-base = BL-951's architect commit, which itself already had the
original fix) saw only MY side as "changed relative to base" (the revert)
and silently propagated it, discarding the re-validated fix with no
conflict reported. Caught by grepping for `bounce_history` in
`is_qa_ancestor.sh` post-merge and finding it absent. Fixed by hand:
restored all 6 files' content from the incoming commit directly (`git
show 869f4c0960:<path> > <path>`), re-added the `bl952...Steps` registry
line to `index.js` (union of both branches' entries, not a replacement),
and verified every restored file byte-matches the incoming commit before
committing the merge. Re-ran my own `test_is_qa_ancestor_yaml_store.sh`
immediately after as a sanity check — 4/4 pass.

## What changed since my round-1 pass
Only `specs/pipeline/steps/bl952BouncedParcelNeverApprovedSteps.js` — the
production logic (`is_qa_ancestor.sh`, `push_sweep_lib.bb`, `handoffd.bb`)
I already hardened in round 1 is untouched by this delta, so this pass
does not re-litigate it.

## Checks run (complete inventory, not first-failure-stop)

1. **Merge integrity, independently re-verified** (own hardening
   judgment, given the revert-of-a-revert trap above): diffed every
   restored file against the incoming commit — all 8 (6 restored + the
   step handler + `index.js`'s union) confirmed either byte-identical to
   the incoming commit's content (for the 6 restored files and the step
   handler) or a correct superset (`index.js`, which legitimately carries
   more entries than the incoming branch alone).
2. **Direct reproduction of QA's own environment** (the whole point of
   this fix): ran the acceptance feature with `SWARMFORGE_ROLE=QA`
   explicitly set — **10/10 PASS**, including scenario 10 (the exact
   scenario QA's bounce evidence named). My own `SWARMFORGE_ROLE` this
   session is `hardender`, which is exactly why round 1 (mine and the
   architect's) never saw this defect — running under the specific role
   that will always invoke this suite in production is the only way to
   catch it, so this is not a redundant re-run of what round 1 already
   did.
3. **Own read of both fixed subprocess spawns**: confirmed
   `neutralizedEnv()` is the single shared helper both `askPredicate`
   (Consumer 1) and the Consumer 2 guard spawn now route through,
   deleting `SWARMFORGE_ROLE` before applying any per-call override
   (`GITHEAD_<sha>` for Consumer 2) — a complete, consistent fix across
   both leak sites the bounce named, not a partial patch of one.
4. **Own coverage-gap test re-confirmed**: `test_is_qa_ancestor_yaml_store.sh`
   (round 1's own addition, restored via the merge-integrity fix above)
   — 4/4 PASS.
5. **Scope-boundary check on generalizing the fix**: grepped this
   codebase for other `...process.env` subprocess spawns in
   `specs/pipeline/steps/` — found this pattern extremely widely used
   (100+ files), which is expected and correct for step handlers that
   legitimately need to pass through the real environment. Auditing all
   of them for the same SWARMFORGE_ROLE-leak-into-a-simulated-caller
   shape would be unbounded scope creep well beyond this ticket; the
   defect class is specific to a scenario that simulates a GENERIC
   caller and happens to invoke a script with a role-specific early
   exit, not a general pattern to sweep for here.
6. **Leak/process check**: `git status --short` clean; no stray tmux
   servers.

## Outcome
No defects found in the D1 fix itself — independently reproduced under
QA's own exact environment (`SWARMFORGE_ROLE=QA`), 10/10 including the
previously-failing scenario 10. Caught and corrected a genuine merge
hazard in my own worktree (a mechanical git merge silently discarding
the re-validated fix in favor of an unrelated earlier revert) before it
could have shipped this parcel with the bounce's own fix missing.

Forwarding to documenter.

By hardener.
