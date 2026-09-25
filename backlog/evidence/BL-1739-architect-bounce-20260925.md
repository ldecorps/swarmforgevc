# BL-1739 — architect bounce, 2026-09-25

## D1 — scenario-15 rebuild not done (spec-conformance, coder)

The specifier's ruling on the coder's note 002139 (ticket amendment
`5f68af5510`, landed on `main` while this parcel sat at the cleaner —
merged into this worktree this pass) retired the feature step "Then the
only matches are the deterministic daemon, its salvaged pure libraries,
docs, and history" and requires the handler to be rebuilt:

> deletes that step's definition, `isAllowedBabysitterMatch` and the
> `offenders` scan, including the allowlist lines this parcel added; makes
> the remaining step ("no babysitter.prompt role, LLM launch path, or wake
> runtime remains") assert two things: no `RETIRED_FILE_PATHS` entry is
> tracked (as today), AND no live-code file matches
> `FORBIDDEN_RETIRED_PATTERNS`. Live code means tracked files under
> swarmforge/scripts (not test/), swarmforge/roles, swarmforge/packs,
> extension/src, and the root launch scripts.

Read `specs/pipeline/steps/bl611BabysitterdLifecycleSteps.js` as it stands
in this parcel: neither half of the rebuild happened.

- `isAllowedBabysitterMatch` (line 262), the `offenders` scan inside
  `scanRepoForBabysitter()` (line 465), and the step definition matching
  "the only matches are..." (lines 1039-1044) are all still present —
  dead code the ruling explicitly names for deletion. It is harmless only
  by accident: the Gherkin text it matched no longer exists in the
  feature file (confirmed: `git show 5f68af5510` removed that line), so
  the step is simply never invoked. The feature currently passes 27/27
  because of that accident, not because the rebuild happened.
- The remaining step ("no babysitter.prompt role, LLM launch path, or
  wake runtime remains", line 1046) still checks only `st.scan.forbidden`
  (the pre-existing `RETIRED_FILE_PATHS` tracked-file-existence check).
  `FORBIDDEN_RETIRED_PATTERNS` exists in the file (line 421) but is used
  ONLY by scenario 16's own separate step (checking script stdout/stderr
  content, line 1077) — nothing anywhere applies it as a live-code
  CONTENT scan over the directories the ruling names
  (`swarmforge/scripts` non-test, `swarmforge/roles`, `swarmforge/packs`,
  `extension/src`, root launch scripts). That check does not exist. A
  real regression (e.g. a new file under `swarmforge/scripts/` naming
  `babysitter_lib.bb` in its own source) would pass this scenario clean
  today, which is exactly the gap the ruling's rebuild exists to close.

**Failing command**: none — the feature currently passes 27/27, which is
why this needs stating explicitly rather than showing as a red. The
defect is a missing/incomplete implementation of the specifier's own
ruling, not a currently-failing assertion.

**Expected vs observed**: expected the dead allowlist apparatus removed
and the remaining step extended to check `FORBIDDEN_RETIRED_PATTERNS`
against live code in the five named surfaces; observed the pre-ruling
allowlist code (`isAllowedBabysitterMatch`, `offenders`, its orphaned step
definition, and `da235a4c38`'s ~140-file allowlist additions) untouched,
and no live-code pattern check added anywhere.

**Failure class**: spec-gap-unimplemented (the coder was directly assigned
this rebuild by the specifier's own ticket note — "the parcel was at the
cleaner when the ruling landed... the coder rebuilds the scenario-15
handler" — so this is not a fresh spec-gap for the specifier to dispose
of; it is unfinished assigned work).

**Blamed role**: coder.

**Remediation pointer**: delete `isAllowedBabysitterMatch`
(lines 262-398), the orphaned "the only matches are..." step definition
(lines 1039-1044), and the `offenders` half of `scanRepoForBabysitter`
(keep `forbidden`/`RETIRED_FILE_PATHS` as-is). Extend the remaining step
(line 1046) or `scanRepoForBabysitter` itself to also walk tracked files
under the five named live-code surfaces and test each against every
`FORBIDDEN_RETIRED_PATTERNS` entry, throwing the same shape of error
`forbidden` does today. Verify zero hits on the current tree (the ruling's
own "zero hits on main at the ruling" claim), then re-run the full
BL-611 feature (27/27 expected) and this ticket's own qa_e2e steps.

## Other items checked, no defect

- Item 1 (scenario 07, rotate-not-honored): fixture now declares
  `'rotation-router?': true` — matches `check-rotate-not-honored`'s real
  gate (BL-1129) and the scenario's own premise. Correct.
- Item 2 (scenario, aged in_process claim): fixture now sets
  `'abandoned?': true` on the aged claim, matching `motion-in-process?`'s
  real key since BL-1109. Correct.
- Full feature run: 27/27 (confirms items 1/2's fixes hold; item 3's
  omission is not currently visible as a red, per D1 above).
- `git diff main...HEAD --name-only`: only the Scope file
  (`bl611BabysitterdLifecycleSteps.js`) plus evidence — no feature file
  touched by this parcel itself (the one feature edit was the specifier's
  own ruling commit, already on `main`).

## record-bounce.js revert-check note

`record-bounce.js`'s revert-check flagged commit `506b20aec3` (this
worktree's own "Merge main 5f68af5510 into architect", which brought the
specifier's ruling itself onto this branch) as `"verdict": "violation"`
with remedy `git revert --no-edit 506b20aec3`. NOT acted on: that commit
IS the specifier's ruling (the ticket amendment + the feature-file
scenario-15 step retirement) — reverting it would undo the ruling this
bounce is enforcing, not the defect. This is an OMISSION bounce (the
rebuild the ruling calls for was never done); per the workflow rule "A
Bounce Must Be Reverted Out Of The Bouncing Branch", an omission bounce
reverts nothing. The tool's generic heuristic does not distinguish a
main-sync merge from the producing role's own defective commit; judged by
hand instead.

By architect.
