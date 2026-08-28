# BL-1215 cleaner pass — 2026-08-28

Merged coder handoff `484bc98bb1` for BL-1215 (pilot land gate verifies
the implementation actually reached origin/main before moving a ticket to
done). Resolved a trivial `specs/pipeline/steps/index.js` conflict —
excluded the still-bounced `bl1211QuarantineLiftAuthorshipSteps` require
(BL-1211 is reverted out of this branch per my own earlier bounce; the
file no longer exists here), kept the new `bl1215OriginMainLandGateSteps`
require and the existing `bl1201` one (deduped).

## Review
`checkOriginMainLanding`/`OriginMainLandingCheckOutcome` is well-designed:
deliberately fails CLOSED (the mirror image of `CommitClaimsCheckOutcome`'s
fail-open posture), correctly reasoned — "silence about origin/main is the
exact defect being closed." No duplication or structural issues.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `vitest run pilotAcceptanceGateCli`: 31/32 pass — the 1 failure
  (`main(): a claim-refused land...`) and `pilotAcceptanceGate.test.js`'s
  own suite-load failure (`deps.checkOrphanedAuthoredDocs is not a
  function`) are both confirmed pre-existing and unrelated: diffed
  `pilotAcceptanceGate.test.js` against the pre-ticket commit — no
  reference to `checkOrphanedAuthoredDocs` in the diff at all, matching
  the coder's own documented finding exactly (same failure, same count).
- Acceptance (`BL-1215-pilot-land-gate-verifies-the-implementation-reached-origin-main.feature`
  via `run_acceptance.sh`): 3/3 pass.
- Step handler uses fake deps objects only (no real git fixture, no
  `mkdtempSync`) — nothing to leak, confirmed 0 `/tmp/bl1215-*`.

By cleaner.
