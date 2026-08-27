# BL-1041 hardener pass — 2026-08-22

**Parcel:** architect forward `7456f9be3e` (re-fix pass, PASS verdict; D1a
and D1b both independently re-verified fixed end-to-end by the architect
against the real compiled CLI), merged into hardener.

**Verdict: hardened. One real, previously-undiscovered defect found and
fixed, with a regression test.** No Stryker (pure Babashka, no mutation
tool wired per engineering.prompt); no `Scenario Outline:`/`Examples:` in
the feature, so BL-113 not applicable either. Hand-authored surgical
mutation sweep instead.

## The gap: a rescued DELETION can never verify, so its source is retained
forever

`rescue_orphaned_work.bb`'s verify step (invariant 1's third leg - "the
commit's CONTENT was read back and matches") required, for every changed
path: `(git-ok? in-commit)` AND `(fs/exists? on-disk)` AND content equality.
That is correct for an addition or a modification, but a stash entry can
itself be a **deletion** of a tracked file - and a deleted path can never
exist on disk again. `fs/exists?` on it is unconditionally false, so
`verified?` is unconditionally false for any rescue that includes a
deletion, and `source-release-allowed?` (correctly, given the input it was
handed) refuses to drop the stash. The commit is real and correct - the
deletion IS committed - but the stash sits there forever, misreported as
"content not verified", reintroducing exactly the durability failure mode
this ticket exists to close (a real fix, correctly landed, whose source
copy is never released).

Confirmed by hand against the real CLI before touching anything: built a
throwaway repo, tracked and committed `gone.ts`, deleted it and stashed the
deletion, ran `rescue_orphaned_work.bb` against it. Output: `RESCUED ...
source RETAINED - content not verified, nothing dropped`, and the stash
entry was still present afterward. Not a hypothetical - the same class of
"orphaned work" the ticket's own `approval_context` describes (a real fix
sitting in a stash) can trivially be a deletion (e.g. removing a dead code
path, or the kind of "drop the retired X" cleanup this swarm does
routinely).

Neither the architect's two passes nor the coder's original implementation
and re-fix caught this - understandably, since every fixture in
`test_rescue_orphaned_work.sh` (01-06, D1a, D1b) rescues an ADDITION or a
MODIFICATION; none rescues a deletion.

## The fix

`rescue_orphaned_work.bb`'s verify predicate now branches on whether the
path exists in the commit at all (`git-ok? in-commit`): if it does, the
existing content-match check applies unchanged; if it does not (the stash
deleted this path), verification requires the path to be absent from disk
too - which is exactly the fact that makes a rescued deletion legitimately
verified. Both an addition/modification and a deletion now have a real
verify path; neither is a special-cased skip.

Added `07` to `test_rescue_orphaned_work.sh`: a deletion-only stash, run
through the real CLI, asserting the source is released (not retained) and
the deletion actually lands. Confirmed the test discriminates: reverted the
fix, re-ran - `07`'s first two assertions failed exactly as expected
("source RETAINED"/"not verified" both appeared where the fixed code
reports "source released"). Restored the fix, re-confirmed all 8 scenarios
(01-07 plus D1a/D1b) pass.

## Verification re-run live

- `bash swarmforge/scripts/test/test_rescue_orphaned_work.sh` - **ALL
  CHECKS PASSED** (9 scenarios: 01-06, D1a, D1b, and the new 07).
- `bb swarmforge/scripts/test/rescue_lib_test_runner.bb` - **ALL PASS**
  (unaffected - `rescue_lib.bb` itself untouched by this fix, which lives
  entirely in `rescue_orphaned_work.bb`'s impure verify step).
- `bb swarmforge/scripts/test/bl1041_rescue_durability_property_runner.bb`
  - **300 runs, ALL PROPERTIES HOLD** (unaffected, as expected).
- `node specs/pipeline/cli.js
  specs/features/BL-1041-a-rescue-never-makes-orphaned-work-less-durable.feature`
  - **4/4**.

— By hardener.
