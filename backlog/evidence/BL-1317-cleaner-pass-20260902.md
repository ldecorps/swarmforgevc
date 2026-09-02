# BL-1317 — cleaner pass (20260902)

Received: coder commit `cfdb532b64` (BL-1317: self-audit fixes - climb onto
every dial rung, and give the TS anchor a real applier), on top of
`59a8c3eca2` (BL-1317: Adapt tier - a seat's effort climbs on a bounce and
descends only on a clean streak).

## Checklist run

- Compiled TypeScript (`npm run compile`) — clean.
- `extension/test/effortDialAdapt.test.js` — 18/18 pass.
- `extension/test/bl1317AdaptEffortInvariants.property.test.js`
  (`npm run test:properties` config) — 4/4 pass, including the invariant-1
  property (no outcome sequence ever rewrites the pack conf on disk).
- `swarmforge/scripts/test/handoff_lib_test_runner.bb` — ALL TESTS PASSED.
- `swarmforge/scripts/test/seat_difficulty_lib_test_runner.bb` — ALL PASS.
- `swarmforge/scripts/test/test_bl1317_effort_ladder_parity.sh` (BL-897
  cross-language constant parity gate) — ALL PASS: the TypeScript
  `ADAPT_EFFORT_LADDER`/`ADAPT_DEFAULT_CLEAN_STREAK` and the Babashka
  `adapt-effort-ladder`/`adapt-default-clean-streak` agree.
- Mutation-site count (BL-485) on the one new production TS file:
  `extension/src/tools/effortDialAdapt.ts` → 83 sites, `within` the 100
  threshold. No split warranted or needed.
- `jscpd` over the new TS production + test files: 0 clones, 0% duplication.
- Confirmed `required_wiring` anchors are real, not aspirational:
  - `effortDialAdapt.ts::decideAdaptEffort` exists, pure (no IO), imports
    BL-236's `EFFORT_LEVELS` directly rather than restating it.
  - `handoff_lib.bb::record-effort-adapt!` is wired as the sole IO edge,
    called from `done_with_current_task.bb` at the same completion moment
    the lifecycle ledger already observes (`record-effort-adapt-for!`).
  - The active-ticket-mutation-cost lookup was already de-duplicated by the
    coder's self-audit commit into `handoff-lib/active-ticket-mutation-cost`,
    shared by both `ready_for_next_task.bb` (BL-1316 claim-time) and
    `done_with_current_task.bb` (BL-1317 Adapt baseline) — no drift risk
    between the two call sites.
- `adaptRoleEffort` (the TS "real applier" the self-audit commit added) has
  no production caller today — the acceptance feature drives the real
  bb-only completion path (`specs/pipeline/steps/bl1317AdaptEffortSteps.js`),
  not this TS function. This satisfies the ticket's own
  `required_wiring` line literally (a pure `decideAdaptEffort` + an apply
  edge "UI and launch paths call it, never embed a second policy" — no such
  TS launch path exists yet for Adapt, machine-driven, not a UI action, so
  there is nothing for it to be wired into out of scope for this ticket).
  Not treated as dead code: it is exercised by
  `extension/test/effortDialAdapt.test.js` and exists to hold the single
  TS-side policy the moment such a caller is added, matching how BL-1316's
  analogous apply edge is structured.
- No duplication introduced beyond the two required, gate-checked mirrors
  (TS decision / bb decision) — that duplication is the ticket's own
  required_wiring shape (two languages, one policy, parity test as the
  gate), not an accidental copy.
- Architecture: pure decision (TS + bb) kept separate from the one IO edge
  in each language (`adaptRoleEffort` TS-side, `record-effort-adapt!`
  bb-side); no policy embedded at either call site.

## Verdict

No defect found in cleaner's domain (coverage, CRAP-adjacent complexity,
DRY, module structure/boundaries). Clean sweep — forward unchanged.

By cleaner.
