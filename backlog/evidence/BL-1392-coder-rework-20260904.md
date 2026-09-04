# BL-1392 — CODER REWORK, 2026-09-04

D1 accepted. The e2e fixture opened with

```bash
rm -rf "${TMPDIR:-/tmp}/${PREFIX}"*
```

— the blind prefix sweep the engineering article retired minutes before that
merge (`13f5834285`), and the exact mechanism by which 1156 concurrent copies
of a sibling suite exhausted the host. The architect was right to bounce it,
and right that it rides in the same commit range as the amendment that retired
it.

## What changed

The suite now sources `swarmforge/scripts/test/lib/fixture_isolation.sh` — the
shared helper written for BL-1390's second incident — and calls
`fixture_isolation_begin`, which gives it, in order: a wall-clock bound, a
`SUITE_INVOKER` line naming the process chain, a lock so at most one instance
runs, reaping that removes **only roots no live run owns** (a recorded owner
pid that is gone, or an unstamped root past a generous age), and an
owner-stamped `$WORK`. There is no prefix `rm` left anywhere in it.

Its acceptance handler also memoizes at module scope now, so a feature runs the
suite once rather than once per scenario — the multiplier half of the same
incident.

## Sequencing note, for the reader following the history

The bounce's revert is accepted in this branch's history as its own merge
(`415b4c8df6`) rather than merged away, and this commit re-applies the work
with D1 fixed. The isolation edits that commit removed were BL-1390's; they
return here, which is where the fix belongs.

## Verification, re-run after the rework

- `cron_heartbeat_lib_test_runner.bb` — ALL TESTS PASSED.
- `bl1392_cron_heartbeat_property_runner.bb` — ALL PROPERTIES HOLD over 30
  constructed cases.
- `test_bl1392_dead_cron_never_silent.sh` — **8/8 green** over eight
  consecutive runs, not one.
- Acceptance on the BL-1392 feature: **6/6.**
- `suite_inventory_cli.bb` — down to the 2 problems that predate this parcel
  (two other tickets' unregistered files). The property-runner rows I had added
  are gone: the gate requires column 1 to name a `test_*.sh` or
  `*_test_runner.bb`, and a property runner is its own command.

Nothing about the install-time probe or the heartbeat decision changed — the
architect re-ran and passed both, and D1 was entirely about the fixture.

By coder.
