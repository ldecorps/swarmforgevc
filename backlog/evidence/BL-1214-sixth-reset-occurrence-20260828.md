# BL-1214 — sixth observed `reset: moving to origin/main`, 2026-08-28 ~03:13Z

Recorded by the specifier, who was the one whose commit it ate. This is
evidence for the ACTIVE ticket BL-1214 (`absorb-dispatch-plan` resolves
behind>0 + ahead>0 to `:ff-absorb`, but the executor runs `git merge --ff-only`
and falls through to `git reset --hard origin/main`). No new ticket.

## What happened

Local `main` was 8 ahead / 0 behind while `origin/main` had moved 21 ahead.
On a two-way divergence the reset fired and hard-discarded the local eight.

Reflog, in the order they were destroyed:

| commit | subject | author |
|---|---|---|
| `21fabca09` | Close BL-1198: move to done | coordinator |
| `45d46fd39` | Promote BL-1214: paused → active for coder | coordinator |
| `5954dccb9` | BL topic record for BL-1198 | bot |
| `68e4a5371` | Promote BL-1204: paused → active for coder | coordinator |
| `7f8ffce8b` | BL topic record for BL-1214 | bot |
| `f1ac66113` | BL topic record for BL-1224 | bot |
| `921bbdad7` | BL topic record for BL-1225 | bot |
| `a4de5f647` | spec(BL-1224, BL-1225): split the double-restart intake | specifier |

All eight verified destroyed, not merely rewritten:
`git merge-base --is-ancestor <c> HEAD` answered false for every one.

## Why this one is worth recording separately

The five prior occurrences are already in the incident record. This one adds
two facts.

**1. The window is now under three minutes.** `a4de5f647` was committed at
03:13:09 and was no longer an ancestor of HEAD by the time the very next
command in the same turn ran. The previous shortest observed window was
"minutes"; this is the tightest yet, and it means the existing advice —
*push in the same turn you commit* — is not conservative, it is the minimum.

**2. It silently un-did live routing state, not just spec text.** The two
promotions and the close were the coordinator's, and their loss left the
backlog lying in a way nothing announces:

- BL-1198 read `active/` after being closed — it is the ticket that owns the
  push gap that makes this whole failure mode survivable.
- BL-1204 and BL-1214 read `paused/` after being promoted and assigned to the
  coder. **BL-1214 is the ticket that owns this defect.** The reset destroyed
  the promotion of its own fix.

A role reading the backlog at that moment would have seen three tickets in
the wrong pool with no indication anything had gone wrong.

## A second finding, not owned by BL-1214

The specifier's first recovery attempt was `git merge --no-ff origin/main`,
the merge BL-1214 says the tool should be doing. The `main` pre-commit guard
refused it:

    Commit refused: staged change touches pipeline code on `main`:
      - specs/pipeline/steps/bl1213ParcelRollbackGuardSteps.js
      - specs/pipeline/steps/index.js
    Pipeline code ... may only land on main via QA (Article 1.8/4.2, BL-247).

The guard is correct in substance — pipeline code must reach `main` through QA
— but the content it refused had *already* reached `main` through QA: it was
sitting on `origin/main`, and the merge was a pure sync bringing local `main`
level. So a non-QA role that needs to push cannot first sync, and cannot push
without syncing. The only exits are to abandon the local commits or to work
around the guard.

That is a real gap in the push path BL-1198 owns, and it is the mechanism that
keeps `main` ahead of `origin` — which is the precondition this reset needs.
Left unticketed here rather than minted blind: it belongs to whoever holds
BL-1198's fix, and the specifier flagged it to the coordinator rather than
minting a sibling that would race that work.

## Recovery performed

Standard recipe from the incident record, executed in one turn:

1. `git branch -f rescue/coordinator-bookkeeping-20260828-0313 921bbdad7` —
   one ref captured all seven, the chain being linear.
2. Specifier's own commit restored first by `git cherry-pick a4de5f647`
   (clean; touches only `backlog/` and `specs/features/`, so the pipeline-code
   guard did not apply) → **pushed immediately**, `c527581e0`.
3. The seven coordinator/bot commits cherry-picked in original order onto that
   → **pushed immediately**, `86e9d0885`. All clean; no conflict, because
   nothing newer had moved any of the three tickets in the meantime.
4. Parity verified `0 0`, and every restored fact read back off `origin/main`
   rather than off local `main`: BL-1198 in `done/`, BL-1204 and BL-1214 in
   `active/` with `assigned_to: coder` and `human_approval: approved` intact,
   and all five topic records present.
5. Rescue ref deleted only after the content superset test (`git diff
   --name-status <ref> origin/main` showing additions only) — never on
   ancestry alone, per the standing rule.
