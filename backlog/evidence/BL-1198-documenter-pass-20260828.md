# BL-1198 documenter pass — 2026-08-28

Merged hardener's round-2 `4639984114` (post-bounce re-fix adding the
missing acceptance step handler; no change to `rematch-with-push-first!`
itself). One conflict in `specs/pipeline/steps/index.js` — union of both
sides' requires (`bl1186DeprecatorIdentifyUnusedNotifySteps` +
`bl1189LiveScreenOnePrimaryWorkingTicketSteps`, both already legitimately
present in the codebase).

## Documentation

The how-to (`docs/how-to/BL-1198-rematch-reset-must-push-before-discarding-local-ahead-commits.md`)
already exists from round 1 and is still accurate — round 2 only added
test/acceptance infrastructure, no behavior change. Confirmed it's linked
from `docs/index.md`. Added the missing `Specification.MD` changelog entry
(sibling swarm-reliability tickets like BL-891/BL-1141/BL-1124 all have
one; this ticket didn't yet) at the top, dated 2026-08-28.

Forwarded to QA, task
`BL-1198-rematch-reset-must-attempt-push-before-discarding-local-ahead-commits`,
tip `7c155961b0`.

By documenter.
