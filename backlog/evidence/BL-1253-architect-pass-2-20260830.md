# BL-1253 — architect pass (second round), 2026-08-30

Reviewed the cleaner-forwarded commit `7906677a01` (coder's rework of QA
bounce D1, cleaner merge with no additional cleanup).

## Verdict: COMPLIANT — forwarded to hardender

## D1 re-verification

QA's bounce: scenario 06 had no step handler, 7/8 not 8/8. The coder's
rework did not write new code — it carried forward commit `026ae2aa3`
(already on the coder's own branch, never part of what reached QA) that adds
the three step handlers plus invariant 3's property test. Verified rather
than trusted:

- `git merge-base --is-ancestor 026ae2aa3 HEAD` → true (on my branch now).
- `grep -n` for all three of scenario 06's step texts in
  `specs/pipeline/steps/bl1253DeadFeederOwnsGetUpdatesStampSteps.js` →
  all three present (`bl1253DeadFeederOwnsGetUpdatesStampSteps.js:264,271,276`).
- Re-ran the acceptance suite myself:
  `specs/pipeline/scripts/run_acceptance.sh` on BL-1253's feature → **8/8**.
- Re-ran the property test myself: `cd extension && npx vitest run --config
  vitest.properties.config.mjs test/bl1253TokenOwnershipInvariants.property.test.js`
  → 4/4 pass.
- Re-ran the ledger property runner: `bb swarmforge/scripts/test/bl1253_stamp_ledger_human_decision_property_runner.bb`
  → ALL PASS, 400 runs/case, non-vacuous coverage buckets.

## Invariants re-checked directly (not from the evidence file alone)

- **Invariant 1** (no hotfix source touched): read `git show 026ae2aa3
  --stat` myself — only an evidence file, the property test, and the step
  handler file are touched; none of `cursorBridgeInboundQueue.ts`,
  `telegramCursorBridgeLive.ts`, `start_cursor_bridge.sh`. Confirmed the last
  change to any of those three predates this ticket (`eee0e843f`, BL-1235).
- **Invariant 2** (ledger never certified/waived by tests): read the ledger
  row directly — `state: stamp-open`, `human_decision: null`,
  `stamp_ticket: BL-1253` (the earlier BL-1260 stamp-ticket mislabel is
  already resolved). Untouched by this rework.

## Dependency-rule gate (BL-259, hard gate)

Full-repo scan: `cd extension && node out/tools/dependency-gate.js` →
`Dependency-rule gate PASSED: no forbidden edges.`

## Co-change tool (BL-255)

Ran against the step-handler file and the new property test — no suspected
coupling reported.

## Required wiring

`specs/pipeline/steps/index.js::bl1253DeadFeederOwnsGetUpdatesStampSteps` —
confirmed registered (`index.js:889`), exercised by the 8/8 acceptance run
above.

## Process note (not a defect in this parcel, recorded per the coder's own
write-up)

The coder's evidence documents a real gap in the amendment protocol: a
spec-amendment's IMPLEMENTATION commit can land on the author's own branch
strictly AFTER the parcel that needed it has already moved downstream,
so the feature-file amendment and its handler travel by different routes
and can arrive at QA out of sync even though every intermediate role
honestly reported the suite count for the tree it held. Not something for
me to fix at the architect stage; the coder recorded it rather than
proposing a rule from one instance, which is the right call here.
