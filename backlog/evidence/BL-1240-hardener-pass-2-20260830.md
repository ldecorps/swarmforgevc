# BL-1240 — hardener pass (second round), 2026-08-30

Reviewed the architect-forwarded commit `b5be16686e` (COMPLIANT verdict,
second round) — the rework of the architect's own D1 bounce (a
fixture-closure fix that mishandled the repo-root `swarmforge scripts
name.bb` load-file idiom).

## Tool-scope check (this ticket's `mutation_cost: medium`)

The rework's only behavior change is in
`extension/test/helpers/pinnedRepoFixture.js` (`resolveDepPath`,
`SCRIPTS_ROOT_ANCHOR`). This is test-fixture infrastructure under
`extension/test/`, not compiled production code:

- **Stryker**: `extension/stryker.config.json`'s `mutate` is scoped to
  `out/**/*.js` only (compiled from `src/*.ts`). A plain `.js` file under
  `test/` is never in that glob.
- **CRAP**: scoped to `src/*.ts` (the inverse convention, per the
  engineering rules). `pinnedRepoFixture.js` is neither `src/` nor `.ts`.

So despite `mutation_cost: medium` on the ticket, neither wired tool can
reach the file this rework actually changed. Per the "no tooling configured"
fallback, did a best-effort hand-mutation check instead of skipping
hardening outright.

### Hand-mutation (applied to the working tree, observed, reverted)

`resolveDepPath`'s anchored branch, `if (anchored) return
path.posix.normalize(anchored[1])` → `if (false) return ...`: 4 of 16 tests
in `extension/test/pinnedRepoFixture.test.js` went RED immediately
(including the exhaustive live-tree sweep and the architect's own repro
test). Reverted; `git diff` on the file is empty (byte-identical to before
the mutation), confirmed with a clean 16/16 re-run afterward.

Did not attempt to mutate the whole function (the exhaustive live-tree walk
test — "no load-file target in the live tree is resolved to the wrong
anchor", with its own `multiSegment > 100` non-vacuity assertion — already
covers the class of defect this rework exists to fix, per the architect's
own re-verification; one confirming hand-mutation is sufficient for a
tool-out-of-scope file backing an already-doubly-reviewed bounce fix).

## Suites re-run (all green)

- `cd extension && npx vitest run test/pinnedRepoFixture.test.js` → 16/16
- `npx vitest run test/telegramFrontDeskBotCli.test.js
  test/commitIntegrityRunner.test.js` → 281/281
- `npx vitest run --config vitest.properties.config.mjs
  test/telegramFrontDeskBotCli.property.test.js
  test/bl1038PinnedFixture.property.test.js` → 5/5
- `bb swarmforge/scripts/test/unregistered_test_gate_lib_test_runner.bb` →
  ALL PASS
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1240's feature → 4/4
- `cd extension && node out/tools/dependency-gate.js` → PASSED, no
  forbidden edges

No Scenario Outline in this ticket's feature file (all four scenarios are
plain `Scenario`s) — BL-113 Gherkin mutation is inapplicable (BL-638).

## Process note (recorded, not re-escalated)

This session's merge chain briefly diverged around this same ticket's
in-progress state (the first, bounced fixture-closure rework was still
un-reverted on the architect branch this hardener received for the
UNRELATED BL-1272 ticket, ahead of this parcel arriving). Resolved by
merging the architect's own corrective revert; recorded in
`backlog/evidence/BL-1272-hardener-pass-20260830.md`. Not a defect in this
BL-1240 parcel itself — the second-round rework received here is clean.

## Verdict

CONFIRMED. No src/*.ts touched (CRAP/Stryker not applicable); one
confirming hand-mutation against the actual behavior change, all suites
green. Forwarding to documenter.
