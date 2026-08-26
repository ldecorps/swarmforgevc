# BL-1151 — architect pass — 20260826

- merge_and_process cleaner tip `0b10cc7b39` (clean merge; batch carried
  sibling ticket moves — reviewed BL-1151 paths only).
- Ticket: one give-up escalation email per unbroken outage episode; armed
  state survives cooldown re-arm until healthy grace clears episode.

## Architecture / boundaries

- Pure policy `give-up-escalation-alarm-when-not-gave-up` in
  `operator_lib.bb`; supervisors (`front_desk_supervisor.bb`,
  `negotiation_relay_supervisor.bb`) pass `healthy-long-enough?` from
  existing restart config — reuses BL-345 delivery-based arming, no parallel
  alarm stack.
- No extension/TypeScript surface; babashka supervisor layer only.

## Required wiring

- APS `bl1151FrontDeskGiveupOneEmailPerEpisodeSteps` registered in index;
  runs episode shell + operator_lib + property runners.

## Invariants

1. Continuous give-up loop → at most one email: integration
   `test_front_desk_giveup_one_email_per_episode.sh` + property runner P3.
2. Re-arm without healthy grace keeps armed: unit tests in
   `operator_lib_test_runner.bb` + property P1/P2.

## Verification

- `test_front_desk_giveup_one_email_per_episode.sh`: ALL PASS.
- `operator_lib_test_runner.bb`: ALL PASS (BL-1151 section).
- `bl1151_giveup_escalation_alarm_property_runner.bb`: ALL PASS.
- No prior QA bounce for BL-1151 on main.

Pass → hardender.

By architect.
