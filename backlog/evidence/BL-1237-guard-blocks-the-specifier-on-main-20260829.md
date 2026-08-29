# BL-1237: the freshness guard now refuses the specifier ON `main` itself

Recorded 2026-08-29 by the specifier. Evidence only — BL-1237 is already
active, `assigned_to: coder`, and its spec and invariant already state the
rule. No amendment made, deliberately: the ticket is in flight and does not
need this to be correct.

## What happened

`ready_for_next.sh` in the master checkout refused with:

```
STALE_REFERENCE_ELABORATION: this worktree has not merged an amendment to the
following swarmforge/constitution/articles/reference file(s) ...
  - swarmforge/constitution/articles/reference/engineering-detailed.prompt
Merge main, then run ready_for_next.sh again.
```

Checked rather than obeyed:

- `git rev-parse --abbrev-ref HEAD` → **`main`**.
- last commit touching that file → `abc603b6e` ("Accept hardender
  rule_proposal: a guard chain must not run under set -e").
- `git merge-base --is-ancestor abc603b6e HEAD` → **YES**.

The checkout already contains the amendment it is accused of missing.

## Why this reading is stronger than the ones already in the ticket

BL-1237 documents the guard refusing pipeline worktrees that are AHEAD of
`main`, where the prescribed remedy is a no-op. This occurrence is one step
past that: the refused checkout **is** `main`. "Merge main, then run
`ready_for_next.sh` again" is not merely ineffective here, it is not a thing
that can be done at all. There is no direction in which this refusal is
satisfiable, and there is no bypass.

## Operational consequence, which is the reason this is surfaced

The specifier seat cannot RECEIVE work while this stands — the guard runs
pre-turn, so every `ready_for_next.sh` is refused before any parcel is
dispatched. The two parcels handled this shift (documenter's BL-1247
fix-vs-retirement race, hardener's live-gate question) were both already
`in_process` when the seat came up; a genuinely new parcel would not reach it.
Surfaced to the coordinator as a stall, per Article 1.1.

Not patched and not reverted, per the standing direction on this guard: it is
BL-1237's fix to make, and a local workaround in the master checkout would
mask the very stall the ticket exists to remove.

## Incidental, not this ticket's business

`git rev-list --left-right --count main...origin/main` → **27 47**. Local
`main` is 27 commits ahead of origin and 47 behind. Recorded here only because
unpushed local commits are the exposure class behind thirteen realised resets;
the reconcile sweep is OFF (`swarmforge.conf:352`) so nothing will discard
them automatically. Reconciling that divergence is coordinator/QA work and the
standing human directive is not to push — noted, not acted on.

By specifier.
