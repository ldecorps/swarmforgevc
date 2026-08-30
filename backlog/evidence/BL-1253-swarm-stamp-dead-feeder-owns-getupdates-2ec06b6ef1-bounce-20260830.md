# BL-1253 — QA bounce, 2026-08-30

Full inventory (Article 4.4) — one item, everything else checked and clean.

## D1 — scenario 06 ("A recovered feeder gets the token back") has no step handler at all; the acceptance suite is 7/8, not 7/7

1. **Failing command**, exactly as run:

   ```
   bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1253-swarm-stamp-dead-feeder-owns-getupdates-2ec06b6ef1.feature
   ```

2. **Commit hash checked out and tested**: `c12a9caf82c9e2e04fbfcac83e78c313af22ae7f`
   (`Merge documenter BL-1253 b0c4f73d8f into QA`), this ticket's own tip in
   the QA worktree.

3. **First error excerpt**:

   ```
   not ok 5 - A recovered feeder gets the token back
     error: 'Scenario "A recovered feeder gets the token back": no step
     handler matched "Given the bridge owns getUpdates because the heartbeat
     was stale"'
     code: 'ERR_TEST_FAILURE'
   ...
   # tests 8
   # pass 7
   # fail 1
   ```

   Confirmed by reading `specs/pipeline/steps/bl1253DeadFeederOwnsGetUpdatesStampSteps.js`
   directly: none of scenario 06's three step texts have a registered
   pattern anywhere in the file (`grep -n "scoped("` lists patterns for
   every other scenario's steps and none of "the bridge owns getUpdates
   because the heartbeat was stale" / "the front-desk poll heartbeat
   becomes fresh again during the run" / "the bridge returns to consuming
   the queue without being restarted"). This is not a flaky failure or a
   partial match — the scenario has zero implementation.

4. **Failure class**: `acceptance`.

5. **Expected vs observed**: expected the acceptance driver to run all 8
   scenarios (7 pre-existing + scenario 06, added by the specifier's
   in-flight amendment) and report 8/8, matching every evidence file's own
   claimed "7/7" (which was true only before the amendment landed — see
   below). Observed 7/8: scenario 06 fails immediately with no step handler
   matched.

## Root cause — a legitimate spec amendment landed after hardener's pass, and nobody implemented what it added

`210677bc4` ("BL-1253: absorb retired BL-1260 - the 90s decision, the
one-poller invariant, and the giveback scenario", **by specifier**,
2026-08-30 05:38:22) added scenario 06 to the feature file per Article 5.3
(BL-1260 was retired as a duplicate stamp-off for the same hotfix, and its
un-answered content — including this scenario — was carried forward rather
than dropped). The ticket's own notes say exactly what this requires:

> WHAT CHANGES FOR WHOEVER HOLDS THIS: one new scenario (06) needs a step
> handler in the same parcel as the other five - none are registered yet,
> so it is one more handler in a set you were writing anyway.

The hardener's own pass (`53b610e71`, before the amendment) ran mutation
against 6 scenarios — confirming the amendment landed strictly after
hardening. Every subsequent evidence file (coder's own
`BL-1253-stamp-2ec06b6ef1-20260830.md`, architect's
`BL-1253-architect-review-20260830.md`) still reports "7/7" and "BL-1253
acceptance | 7/7" — both predate the amendment's arrival on their branch, or
were written before anyone re-ran the suite against the amended feature
file. Whoever merged the specifier's amendment into their branch (per the
constitution's "Amending An In-Flight Ticket's Spec" protocol) forwarded the
parcel without adding the step handler the ticket's own notes said was
needed, and without re-running the acceptance suite to catch the gap.

## What I checked and did NOT find a problem in

- `required_wiring` — the one row (`bl1253DeadFeederOwnsGetUpdatesStampSteps`
  registered in `specs/pipeline/steps/index.js`) holds.
- Ancestry: this ticket's own coder commit (`b2b0d5eb0`) is a genuine
  ancestor of the documenter tip merged into QA.
- Invariant 1 (no hotfix source touched): confirmed by reading the coder's
  own commit's file list directly — it touches only step-handler/property-
  runner/evidence files, none of the three hotfix source paths
  (`cursorBridgeInboundQueue.ts`, `telegramCursorBridgeLive.ts`,
  `start_cursor_bridge.sh`).
- Invariant 2 (ledger never certified/waived by tests): the ledger row for
  `2ec06b6ef1` still reads `state: stamp-open`, `human_decision: null` —
  untouched, matches the property runner's own claim (re-ran
  `bl1253_stamp_ledger_human_decision_property_runner.bb` myself: ALL PASS,
  400 runs, non-vacuous coverage).
- `cursorBridgeInboundQueue.test.js` + `telegramCursorBridgeCore.test.js` —
  137/137, re-run myself.
- `telegramCursorBridgeCore.property.test.js` — 3/3, re-run myself.
- The duplicate stamp-ticket finding (ledger row's `stamp_ticket` briefly
  citing BL-1260 instead of BL-1253) — already resolved; the ledger row
  currently cites BL-1253 correctly, and BL-1260 is retired
  (`closed_as: superseded-by-BL-1253`).
- The outstanding 90-second stall-window human question (carried from
  BL-1260) is explicitly NOT this ticket's gate to close — it belongs to
  the eventual human ledger decision, and `human_approval: approved` was
  deliberately left in place so this ticket isn't stalled on it. Not
  treated as a QA-blocking defect.

## Remediation pointer

`specs/pipeline/steps/bl1253DeadFeederOwnsGetUpdatesStampSteps.js` needs
three step handlers for scenario 06's Given/When/Then, following the same
pattern already used for scenario 02 (the mirror-image mid-run transition:
fresh→stale, restart-free) — scenario 06 is fresh→stale→fresh again, still
one process, still no restart, ending by asserting the bridge consumes the
queue again rather than calling `getUpdates`. Owning role: **coder** (this
file is a normal coder deliverable, and the missing handler is a plain
implementation gap left behind by an in-flight spec amendment, not a
docs/hardener/architect-only defect).

By QA.
