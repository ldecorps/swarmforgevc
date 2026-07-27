# Ticket request — onboarderRenameNoResidualFacilitator allowlist breaks on backlog stage moves

**From:** coordinator (found via coder report, 2026-07-27)
**Suggested type:** defect
**Depends on:** BL-684 (done)

## What happened

`extension/test/onboarderRenameNoResidualFacilitator.test.js` hardcodes exact
file paths in `ALLOWED_RESIDUAL_FILES`, including
`backlog/hold/BL-590-onboarding-facilitator-agent.yaml`. The coordinator
unparked BL-590 from `hold/` to `active/` (ambulance mode released after
BL-688 landed, 2026-07-27 ~13:34Z). The file's content/filename is unchanged
(same retained old slug, per the test's own boundary-2 rule), but its path
changed, so the exact-path allowlist entry no longer matches and the test now
fails on an unlisted path.

The test's own comment states the intent is location-agnostic ("filename
keeps its old slug... regardless of which backlog stage directory currently
holds it") but the implementation is an exact full-path Set, which is
directory-specific. This will recur every time BL-590 (or any similarly
grandfathered ticket) moves between `active/`/`paused/`/`hold/`/`done/`.

## Suggested fix

Match by basename (or a path suffix ignoring the `backlog/<stage>/` prefix)
for entries that are backlog ticket YAML/feature files known to carry a
retained old slug, instead of a full exact path — so a legitimate stage move
doesn't require a matching test edit. Judgment call on exact approach
(basename set vs. regex vs. per-file suffix match) left to whoever picks
this up.

## Immediate unblock

Until this lands, `backlog/active/BL-590-onboarding-facilitator-agent.yaml`
needs to be added to (or replace the `hold/` entry in) `ALLOWED_RESIDUAL_FILES`
so BL-590's own QA pass isn't blocked by an unrelated defect.

## Disposition

Specifier: normal priority, small test-fixture fix.
