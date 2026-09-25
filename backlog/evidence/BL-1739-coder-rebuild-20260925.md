# BL-1739 — coder rebuild pass (specifier ruling on note 002139), 2026-09-25

The specifier ruled on the coder's earlier note (BL-611 scenario 26's
allowlist had drifted ~140 references beyond the ticket's own census):
retired the "only matches" step in `specs/features/BL-611-...feature` on
main (commit `5f68af5510`), and asked the handler to extend the remaining
step to a live-code retired-name check instead of chasing individual
allowlist entries forever.

## What changed

`specs/pipeline/steps/bl611BabysitterdLifecycleSteps.js`:

- Deleted `isAllowedBabysitterMatch` entirely (the per-file allowlist,
  including every entry this ticket's earlier commit added) and the
  step handler for the now-retired "the only matches are..." step.
- `scanRepoForBabysitter` no longer computes `offenders`. It still
  computes `forbidden` (RETIRED_FILE_PATHS existence, unchanged) and now
  also computes `liveCodeMatches`: every tracked file under a new
  `isLiveCodePath` predicate (`swarmforge/scripts/` excluding its own
  `test/`, `swarmforge/roles/`, `swarmforge/packs/`, `extension/src/`, and
  root-level launch scripts) whose CONTENT matches
  `FORBIDDEN_RETIRED_PATTERNS` - the same pattern list scenario 16 already
  used for script-output checking, reused rather than duplicated.
- The remaining step ("no babysitter.prompt role, LLM launch path, or
  wake runtime remains") now asserts both `forbidden` and
  `liveCodeMatches` are empty.

Non-vacuity, checked directly (not left in the commit): planted a retired
reference (`launch_babysitter.sh`) in a scratch file under
`swarmforge/scripts/` (a live-code path) - scenario 26 failed, naming the
scratch file. Removed the scratch file (my own, created this turn) and
re-ran: 27 of 27 again.

## Verification run before forwarding

- `node specs/pipeline/cli.js specs/features/BL-611-...feature`: 27 of 27
  (the ticket's own original bar, now met in full - the specifier's ruling
  changed HOW scenario 26 asserts, not whether all 27 must pass).
- `node specs/pipeline/cli.js specs/features/BL-1129-...feature`: 2 of 2.
- `npm test` (extension/, compile + unit lane): 637 files / 10868 tests,
  exit 0.
- `git diff main...HEAD --name-only` (this parcel's own diff, not the
  whole branch): exactly `specs/pipeline/steps/bl611BabysitterdLifecycleSteps.js`
  - the one Scope file. No `specs/features/` path (the feature was already
    retired by the specifier's own commit on main before this rebuild
    started).

## Scope

Touched: `specs/pipeline/steps/bl611BabysitterdLifecycleSteps.js`, this
evidence file. `backlog/standing-reds.tsv` NOT touched (coder.prompt,
BL-1663). No BL-611 scenario/Examples/narrative edited by this parcel (the
one retired step was retired by the specifier, on main, before this
rebuild). Nothing else in this worktree staged - the unrelated untracked
leftovers (BL-1666/BL-1652) are not this ticket's and are left as found.

By coder.
