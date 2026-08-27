# BL-1001 cleaner bounce-refix — 2026-08-24

## Inbound

Merged architect bounce `5c78d3ee21` (undeclared seat on a tier-active stage
must not claim). Ancestry:
`git merge-base --is-ancestor 5c78d3ee21 HEAD`.

## Root cause

`seat-accepts?` treats a nil tier as accept-all (BL-983 legacy). On a stage
where any seat declares `--seat-tier`, that left an undeclared sibling able
to `:claim` high work — spill-down by omission.

## Fix

In `difficulty-claim-decision`, after `stage-tiers-active?`, a nil
`my-tier` is `:skip-ineligible` (declaration required to participate).
`idle-better-fit-sibling?` also requires a declared sibling tier so an
undeclared idle window cannot pull prefer-fit.

## Checks

1. Unit — failing tests first, then green
   (`seat_difficulty_lib_test_runner.bb` ALL PASS).
2. Properties — 4/4 (added undeclared-on-tiered-stage property).
3. Gherkin — 6/6 unchanged.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1001-difficulty-aware-coder-seat-routing`.

By cleaner.
