# BL-1399 — hardener pass 2 (spec amendment), 2026-09-04

Merged coder amendment `01d04e31e3`, adopting the specifier's spec-gap
correction: the feature's Background no longer claims "a one-row conf"
(false — the fixture also carries a derived row per supervisor since the
first pass), and a new invariant 2b is proven: dropping a derived
supervisor row makes the guard refuse naming it, and the fixture's row
set equals the live glob's basenames at test time. Nothing built changes
— no guard, checker, or live conf touched.

## Own merge-time finding (already fixed in the prior pass this session)

The specifier's earlier stand-alone Background re-tense commit
(`9b5442f553`, merged and fixed in this session's prior turn — see
`backlog/evidence/BL-1399-hardener-pass-20260904.md`'s companion turn)
had broken all 3 acceptance scenarios by leaving the step handler's regex
stale. That fix (commit `0d5c64d975`) is what this amendment's own step
handler edit builds on top of — confirmed the two changes are consistent
(same regex, this amendment's diff is purely the multi-line formatting
variant, resolved as a merge conflict, no functional difference) rather
than assuming.

## Checks re-run, all independently

- `test_bl1399_freshness_fixture_own_registry.sh` — 8/8 ALL PASS,
  including the two NEW 2b checks: "dropping a derived supervisor row
  makes the guard refuse, naming that supervisor" and "the fixture's
  supervisor rows equal the live glob's basenames at test time".
- `run_acceptance.sh` on the BL-1399 feature — 3/3 pass (same scenario
  count; richer assertions inside the "every property holds" scenario,
  now asserting 4 claims instead of 2).
- `check_feature_handler_registration.sh` — rc 0.

## No property test change in this amendment

`git show --stat 01d04e31e3` touches only the step handler and the e2e
shell script — no `extension/test/*.property.test.js` file. The two
property suites re-verified in the prior BL-1399 hardener pass
(`bl1012FreshnessSelfInflictedIncidents`, `bl1399FreshnessFixtureOwnRegistry`)
are unaffected by this amendment and were already confirmed green.

## No production code in scope — mutation N/A

Same as the prior pass: no `.bb`/`.sh` production file changes (the
guard, checker, and live conf are explicitly confirmed untouched by the
e2e's own "unmodified" check, re-verified above).

## CRAP / DRY

No `extension/src` file in this amendment's diff. N/A.

## Process / fixture hygiene

No orphaned `node --test`/mutation processes. Clean working tree.

## Result

The specifier's amendment (invariant 2b: derived rows genuinely derived,
not merely present) is proven by two new, non-vacuous e2e checks;
re-verified all checks clean. Forwarding directly to QA per the ticket's
own stage skip (documenter also skipped), superseding my earlier BL-1399
forward (`2ecdd6341e`) with this amended commit.

By hardener.
