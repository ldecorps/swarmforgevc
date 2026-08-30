# BL-1253 — hardener pass (second round), 2026-08-30

Reviewed the architect-forwarded commit `bd3a8accec` (COMPLIANT verdict,
second round) — the QA-bounce rework that added scenario 06's step handler.
My own prior pass (`53b610e71`, `backlog/evidence/BL-1253-hardener-pass-20260830.md`)
ran mutation against the 6-example Scenario Outline before the specifier's
scenario-06 amendment landed; that manifest is untouched by this rework (a
plain `Scenario`, no `Examples:`, so BL-113 does not apply to it) and is
re-verified below, not re-derived.

## Suites re-run (all green)

- `specs/pipeline/scripts/run_acceptance.sh` on the ticket's feature → 8/8
  (was 7/7 before the bounce; scenario 06 now has its handler)
- `extension/test/bl1253TokenOwnershipInvariants.property.test.js`
  (`--config vitest.properties.config.mjs`) → 4/4 (was 3/3; new invariant-3
  case "a recovered front desk always gets the token back" added by the
  rework)
- `bb swarmforge/scripts/test/bl1253_stamp_ledger_human_decision_property_runner.bb`
  → ALL PASS, 400 runs/case, same five-shape coverage as before
- `extension/test/telegramCursorBridgeCore.test.js` +
  `extension/test/cursorBridgeInboundQueue.test.js` → 137/137, unchanged

## BL-113 Gherkin mutation manifest — unchanged, re-checked not re-run

`grep -o '"Total"...' specs/features/BL-1253-*.feature` still reads
`Total:6 Killed:6 Survived:0 Errors:0` for the one Scenario Outline
("Queue mode is gated on front-desk feeder liveness") — this rework did not
touch that scenario's examples, so the manifest from my prior pass is still
valid evidence, not stale. Scenario 06 itself carries no `Examples:`, so it
is out of BL-113's scope entirely (a plain `Scenario`).

## Standing whole-tree guards — re-run, same three pre-existing reds

Parcel still touches `specs/pipeline/steps/`, so re-ran all 16 non-property
`test/*Guard*.test.js` files: 171/174 pass, same three standing reds as my
first pass (`tempDirTrapGuard`, `socketFixtureShortRootGuard`,
`liveRepoDerivationGuard`) — already ticketed
(`backlog/paused/BL-1289/1290/1291-*.yaml`), none naming this ticket's
files. No new violation from the rework.

## No new mutation-hardening surface

The rework's only new production-adjacent file is the step-handler addition
(`specs/pipeline/steps/bl1253DeadFeederOwnsGetUpdatesStampSteps.js`,
acceptance wiring, not `src/*.ts`) plus the property test. No `src/*.ts`
touched — CRAP/Stryker not applicable, unchanged from my first pass.

## Verdict

CONFIRMED. Forwarding to documenter (this ticket's chain already had a
documenter pass before the bounce; documenter needs to re-confirm the
scenario-06 addition is reflected wherever it described the contract, same
as the first pass).
