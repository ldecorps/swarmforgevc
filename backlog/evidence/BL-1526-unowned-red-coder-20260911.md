# BL-1526 coder pass — unowned red in test_handoffd_master_checkout_drift_wiring.sh, 2026-09-11

While implementing BL-1526 (every daemon spawn target resolves statically),
running `bash swarmforge/scripts/test/test_handoffd_master_checkout_drift_wiring.sh`
(named in the ticket's own `qa_e2e_procedure` neighbourhood — it exercises
`master_checkout_drift_lib.bb`, the file this ticket edits) surfaced a
pre-existing failure:

```
Traceback (most recent call last):
  File "<stdin>", line 7, in <module>
AssertionError: alarm text missing the stakes statement: 'MASTER CHECKOUT DRIFT RESTORED: swarmforge/scripts/handoffd_supervisor.bb'
```

Scenario 01 filters the daemon's Telegram OPERATOR-topic outbox for the
first line whose text contains `"MASTER CHECKOUT DRIFT"` and asserts it
carries the drifted path and the stakes phrase `"not the code"`. The real
handoffd.bb (BL-1139 auto-repair) fires BOTH a `MASTER CHECKOUT DRIFT:` alarm
and a later `MASTER CHECKOUT DRIFT RESTORED:` line into the same outbox, and
`alarms[0]` picked up the RESTORED line first — either the DRIFT alarm never
landed before the repair fired, or ordering in the outbox is not what the
test assumes. Either way this is a race/ordering bug in the wiring the test
covers, not in the assertion logic itself.

## Why this is not BL-1526's

Reproduced identically against the UNMODIFIED `swarmforge/scripts/handoffd.bb`
(git-show'd from `HEAD` into place, test rerun, same failure) — confirms this
predates every edit in this parcel (the resolver change in
`master_checkout_drift_lib.bb`, and the `launcher`/`script`/`cli` inlining in
`handoffd.bb`/`chase_sweep_lib.bb`). Deterministic across two additional
reruns with the parcel's own changes restored, not a one-off flake.

## Search for an existing owner

Grepped `backlog/standing-reds.tsv` for
`test_handoffd_master_checkout_drift_wiring` and `master.checkout.drift` — no
row (the file itself has only the header comment, no data rows at all).
Grepped `backlog/active`, `backlog/paused`, `backlog/hold` for
`test_handoffd_master_checkout_drift_wiring` and for `RESTORED`/drift-alarm
ordering — nothing open owns this.

## Disposition

Filing as an `unowned-red` `note` (priority 00) to specifier and coordinator
per the standing-red rule (2026-09-05) and continuing BL-1526's own work —
QA will not approve BL-1526 over this unless it is registered with an owning
ticket by the time BL-1526 reaches QA.

By coder.
