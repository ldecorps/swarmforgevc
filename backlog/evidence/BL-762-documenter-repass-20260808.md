# Documenter re-pass — BL-762 (2026-08-08, QA-bounce re-entry)

## Context

Re-entry after QA bounced BL-762 (sibling of BL-681, same batch commit
`c785a890f7`) for D1: `swarmforge/scripts/finish_shift_lib.sh` referencing
the retired `onboarding-facilitator-supervisor.pid` name without being
added to `ALLOWED_EXACT_PATHS` in `extension/test/onboarderResidualAllowlist.js`
— see `backlog/evidence/BL-681-BL-762-qa-bounce-20260808.md`. Owned by
coder, not documenter; nothing here asks me to redo doc work.

Received `git_handoff` from hardender (task BL-762, commit `0d2f948009`),
already an ancestor of my current tip via the BL-681 parcel processed
immediately prior in this same turn (both handoffs named the same
hardener re-pass commit, merged once).

## Fix verification

`extension/test/onboarderResidualAllowlist.js:28` now lists
`'swarmforge/scripts/finish_shift_lib.sh'` in `ALLOWED_EXACT_PATHS`.

## Complete review pass — doc content re-checked, no new defect

`git log --oneline c785a890f7..HEAD -- docs/` is empty: nothing under
`docs/` changed since my prior doc commit (`c785a890f7`, "Document
BL-574, BL-681, BL-762"), which already:

- Added `docs/how-to/BL-762-finish-shift-bedtime-vs-lights-out.md`'s
  cross-reference into `BL-637-lifecycle-script-scope.md`'s stop-verb table
  and `docs/index.md`.

Re-read against the now-fixed tree: `./finish-shift` / `finish_shift_lib.sh`
behavior (the bedtime-vs-lights-out keep-vs-kill distinction the doc
describes) is unchanged by D1's fix — D1 only adds an allowlist entry for a
legitimate backward-compat dual-clear line already present when I wrote the
doc; it does not alter what the script does. No new documentation defect
found. NONE.

## Blocked checks

None.

## Disposition

Forwarding BL-762 to QA, naming this commit, so the full downstream gate
re-runs against the corrected lineage.

By documenter.
