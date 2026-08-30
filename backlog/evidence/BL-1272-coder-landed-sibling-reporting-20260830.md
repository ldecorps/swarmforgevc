# BL-1272 — coder pass, 2026-08-30

The land step no longer names an already-landed sibling as still entangled.
The check did not get looser and the step's action is untouched.

## What changed

`swarmforge/scripts/land_step_lib.bb`

- `sibling-landed?` — pure over injected facts. A sibling is landed ONLY when
  the attribution walk RAN COMPLETELY, attributed at least one path, and every
  attributed path is byte-identical between the cited commit and
  `origin/main`. `paths` nil (walk failed) and `paths` empty (nothing
  attributed) both mean the question went unanswered, and an unanswered
  question reports the sibling as entangled.
- `attribution-complete?` — new, and NOT belt-and-braces. See the fail-open it
  closes, below.
- `landed-siblings` — the live wrapper. Attribution reuses
  `task_scope_gate_lib.bb`'s own walk (BL-1192), the same one `own-paths`
  delegates to; content comparison is blob-id equality per path, with a path
  absent on both sides counting as identical (a sibling whose landed content
  was a deletion really is landed). `paths-fn` is injectable so a walk-failure
  row is drivable without corrupting a repository.
- `entangled-siblings` now returns `:landed` and `:unlanded` alongside
  `:entangled`. **`:entangled` is still the FULL set** and is still what
  `land-plan` decides on — invariant 2.
- `entanglement-note` names only the still-unlanded siblings, and says so
  plainly when every ancestor sibling has already landed.

`swarmforge/scripts/land_step_cli.bb` — prints `ENTANGLED_SIBLING <id>` for the
unlanded and `LANDED_SIBLING <id>` for the landed, and builds the escalation
note from the unlanded set. `required_wiring` row 2 satisfied: the distinction
reaches the line QA reads.

Deliberately NOT done, per `out_of_scope`: `land-plan` still returns `:replay`
when every ancestor sibling has landed. The sibling's ORIGINAL commit object is
still an ancestor and may carry content the replay deliberately excluded, so
flipping to `:land` would resurrect what the replay severed.

## A fail-open found while building this, and closed

`task-tagged-changed-paths` signals failure with nil ONLY when the commit walk
itself fails. A single commit whose diff cannot be computed contributes no
paths and silently SHRINKS the attributed set. So a sibling whose readable half
was already on `origin/main` would have been reported as landed on a check that
never saw its other half — invariant 1's "partial" row, fail-open, and not
visible from the outside. `attribution-complete?` probes each attributed
commit's diff explicitly and refuses to call the sibling landed if any probe
fails. The pure unit test
`"a partial attribution walk -> not landed, however identical what it saw"`
pins it.

## Verification

| Command | Result |
|---|---|
| `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` | ALL PASS (new BL-1272 cases + every BL-1241 case unchanged) |
| `run_acceptance.sh` on BL-1272's feature | 6/6 |
| `run_acceptance.sh` on BL-1241's feature | 4/4 — the ticket it extends is not disturbed |
| `npm run test:properties` on this ticket's file | 3 pass |

The acceptance runs the REAL `land_step_cli.bb` over a REAL repository with a
REAL bare origin, with the sibling's content landed as a DIFFERENT commit
object — which is what a tip-pure replay produces, and the only shape in which
this defect exists at all. Observed at the CLI surface:

| sibling state | exit | ENTANGLED_SIBLING | LANDED_SIBLING |
|---|---|---|---|
| byte-identical | 0 | — | BL-9002 |
| absent | 0 | BL-9002 | — |
| partially present | 0 | BL-9002 | — |
| unreadable (tree object deleted) | 1 | named in the escalation note | — |

The `unreadable` row escalates rather than replaying, because deleting a
commit's tree also breaks its child's `--first-parent` diff — in a linear
chain no corruption can break one commit's attribution alone. It is still
fail-closed and the sibling is still named as needing adjudication, in the
escalation note. The isolated per-sibling walk failure is covered at the lib
level, where it can be exhibited exactly.

## Invariants (BL-654)

Both declared invariants carry coder-authored property tests in
`extension/test/bl1272LandedSiblingInvariants.property.test.js`.

**Invariant 1** is driven over generated attribution results — path sets that
may be empty or nil, a completeness flag, and a per-path identical/differing
verdict — and asserted as an EQUIVALENCE, so neither direction can rot, plus
the fail-closed half on its own so a refactor cannot hide it behind an
accidentally-true equivalence.

**Invariant 2** enumerates every subset of the ancestor siblings (a finite,
tiny space — a reach floor asserted after a random draw could miss the
all-landed subset, which is the subset this invariant is about) and asserts the
action is constant across all four, that `:entangled` is unchanged, and that
only `:landed`/`:unlanded` move. Each case builds a real repository.

### Non-vacuity

| Mutation | Result |
|---|---|
| `sibling-landed?` drops the `complete?` guard | invariant-1 property RED |
| `land-plan` branches on `unlanded` instead of `entangled` | invariant-2 property RED |

Both mutations were applied to the working tree, observed, and reverted.

## Surfaced, not acted on — the prose half is GONE from main

The ticket's own note records that `swarmforge/roles/QA.prompt` documents the
CLI's exit contract as of commit `16062880b`, and that BL-1272 must add
`LANDED_SIBLING` to it.

**`16062880b` is not an ancestor of `main` or of `origin/main`.** `QA.prompt`
on `main` contains no mention of `land_step_cli.bb`, `LAND_REPLAY`,
`ENTANGLED_SIBLING`, or `LAND_ESCALATE` at all — the whole BL-1241 prose half
was reset away, not just the BL-1272 addition. So QA currently has no
instruction to run the land step in the first place, and the new
`LANDED_SIBLING` line has nothing to attach to.

This is the specifier's own claimed prose half (BL-798), and role-prompt files
are the specifier's domain (Article 1.2), so it is not fixed here. A `note` at
priority `00` went to the specifier. `docs/how-to/BL-1241-entangled-tip-at-the-land-step-has-a-reachable-remedy.md`
still documents the BL-1241 contract and IS on main, so the how-to is the
surviving description — the documenter will want to add `LANDED_SIBLING` there
regardless of what happens to `QA.prompt`.
