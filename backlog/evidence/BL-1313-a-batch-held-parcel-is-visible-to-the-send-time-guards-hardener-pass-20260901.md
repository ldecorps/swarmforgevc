# BL-1313: hardener pass — 2026-09-01

Reviewed the architect's pass (`ae95433f6d`, forwarding
`d5810a475d`/`5008be4f0c`, the coder's rework after the architect's own
vacuous-property-test bounce) against
`backlog/paused/BL-1313-a-batch-held-parcel-is-visible-to-the-send-time-guards.yaml`.

## BL-149 cooldown gate

All three changed production files are inside the 3-day cooldown window
(host quiet, load 1.70/20 cores):

- `swarmforge/scripts/duplicate_chain_guard_lib.bb` — age 1.46d — `skip-cooldown`
- `swarmforge/scripts/handoff_lib.bb` — age 0.79d — `skip-cooldown`
- `swarmforge/scripts/swarm_handoff.bb` — age 1.46d — `skip-cooldown`

Per the cooldown rule, none is mutation-tested this pass regardless of load.
No `.ts` source touched, so CRAP (`src/*.ts`-scoped) and DRY (`npm run dry`,
`src`-scoped) do not apply to this parcel.

The architect's own D1-remediation empirical check already exercises the
BL-638 hand-mutation fallback that would otherwise be required for these
`.bb` files (no Stryker wiring): swapping `handoff-files-with-batches` for a
`handoff-files` passthrough — the exact regression this ticket fixes — and
confirming both property invariants fail with the precise break named. Not
repeated here; cooldown alone already exempts a fresh sweep this pass.

## Verification run (this worktree, after merging `ae95433f6d`)

- `bb swarmforge/scripts/test/bl1313_handoff_files_with_batches_test_runner.bb`
  → ALL TESTS PASSED
- `bash swarmforge/scripts/test/test_swarm_handoff_inbound_non_forwarding_batch.sh`
  → ALL PASS
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1313-...feature`
  → 7/7 scenarios pass (real `swarm_handoff.bb` CLI via subprocess)
- `npx vitest run --config vitest.properties.config.mjs test/bl1313BatchGuardVisibilityInvariants.property.test.js`
  (from `extension/`) → 3/3 pass, both invariants + generator reachability
  floor

## Housekeeping

Merge of a prior WIP untracked pair in this worktree
(`bl1313_handoff_files_with_batches_test_runner.bb`,
`test_swarm_handoff_inbound_non_forwarding_batch.sh`) conflicted with the
incoming commit's tracked files at the same paths — diffed both: the `.bb`
file was byte-identical, the `.sh` file's only local addition was a
non-functional comment. Removed the stale untracked copies before merging;
no content lost, nothing carried forward.

Swept 62 leaked `bl1313-aps-*` / `bl1313-patched-*` fixture dirs out of
`$TMPDIR`, accumulated across this ticket's full pipeline history
(2026-09-01 11:02–13:56, spanning prior coder/cleaner/architect passes, not
only this one). No live process referenced them
(`pgrep -fl 'node --test|stryker|vitest'` clean before and after); removed
by prefix per the standing fixture-leak discipline.

## Coverage gap found and closed: `some`-fold on the sender's own in_process

This ticket's diff extends `swarm_handoff.bb`'s `inbound-non-forwarding?`
(the Article 2.4 self-check) to fold `non-forwarding?` via `some` over
`my-handoff-files-with-batches`. That exact function, at that exact line,
is the evidence case in my own accepted rule_proposal from 2026-08-31
(BL-1302 lesson, "A predicate the caller FOLDS over a collection needs a
fixture whose members DISAGREE"): a `some`-fold cannot be told apart from
`every?` by any single-member fixture, and the case that matters in
production is a reverse-hop or batch-role inbox holding several parcels at
once with different markers.

Checked all 4 existing scenario outlines (7 examples) plus the bb unit
runner and the property test: every one of them places exactly ONE parcel
in the sender's own in_process for scenarios exercising the self-check.
None discriminates `some` from `every?` on that fold.

Verified empirically before treating it as a gap (not by argument): built a
2-file in_process (one flat non-forwarding, one batch-held ordinary) and
called both `(some ...)` and `(every? ...)` directly against the real
`handoff-files-with-batches` output - `some` → `true` (correct, current
code), `every?` → `false` (would silently allow the send while a
non-forwarding parcel sits unresolved - the exact fail-open BL-1302 warns
about). Current code is correct; the gap is coverage, not a defect.

Added scenario 05 (2 examples) to the feature file plus one new step
handler (`the sender also holds an ordinary inbound for a different ticket
<held>`) placing a second, disagreeing-marker parcel at the OTHER depth
(flat vs batch) from the non-forwarding one. Confirmed non-vacuous by
hand-mutating `some` → `every?` in `swarm_handoff.bb`, re-running: 5/9
scenarios failed (including both new ones and three pre-existing ones,
which strengthens rather than weakens the case for adding it - the mutant
was previously invisible to all of them). Restored the file, confirmed
`git diff` clean, re-ran: 9/9 pass.

This is general test-writing prompted by applying a standing review rule to
this parcel's own diff, not a mutation-tool run - BL-149 cooldown (all
three touched `.bb` files are `skip-cooldown`) governs running the mutation
tool this pass, not adding a test for a gap identified by inspection.

## Decision

Coverage gap found and closed (see above); no other defect found. All
standing suites for this parcel green in this worktree, including the new
scenario. Nothing else to mutation-test or harden this pass beyond that
(cooldown exemption on the tool run + no `.ts`/DRY-scoped surface touched).
Forwarding to documenter.
