# BL-1340 explains why BL-1309/BL-1306 can never promote — 2026-09-02

## Specifier note received
`type: note`, priority `00`: "BL-1340 in paused: why BL-1309/BL-1306 can
never promote. Read before retry."

## Summary
`BL-1340` (paused, `human_approval: pending`) documents a real deadlock:
`promotion_gates_lib.bb`'s draft-acceptance refusal (BL-626) cannot
distinguish a parked `.feature.draft` from one the ticket itself is
chartered to convert in-parcel. BL-1309 and BL-1306 (both `high`-severity
expedited defects, both `human_approval: approved`) are self-converting
cases that the gate refuses anyway — confirmed refused at both the
`promotion_gates_cli.bb evaluate` chokepoint AND the `is_buildable()`
pre-partition in `promote_and_route_next.sh` (the second path silently
defeats Article 3.2.4 expedite ordering, since it filters before `select`
runs). 12 live tickets total are stranded this way; nine coordinator turns
already spent re-attempting.

BL-1340 itself is promotable (its own `acceptance:` names an existing
executable feature) but carries `human_approval: pending` — it needs a
ruling on how the gate should recognise a self-converting draft (options
A/B/C, specifier recommends A: reuse `required_wiring:`).

## Action taken
Attempted to raise this via `role_ask.bb` to make sure the human sees it
promptly (2 expedited high defects + BL-1332 critical blocked, real
throughput cost) — refused: a coordinator question is already pending
(`already-pending`). Not duplicating it. Full ruling context already lives
in `backlog/paused/BL-1340-*.yaml`'s `approval_context`/`ruling_options` for
whenever the human answers.

## Standing instruction to future coordinator turns
**Do not re-attempt promoting BL-1309, BL-1306, or the other 10 tickets
`promotion_gates_cli.bb audit-acceptance .` lists** until BL-1340 is
approved and lands — the gate will refuse them every time for the reason
above, and retrying wastes a turn identically to the last nine. Recheck
after BL-1340 closes; they promote on normal priority/expedite order once
it does. BL-1340 is not itself blocked by this (see above) — it can
promote/route once `human_approval` flips to `approved`, independent of
whatever answers the already-pending question.

## Bookkeeping this turn
No backlog move (BL-1340 stays paused pending approval; BL-1309/BL-1306
stay paused, correctly, per the gate). No promotion action — active
already at effective cap (4/4) regardless. Completing this in_process note
via `done_with_current_task.sh`; no forward hop, informational chain ends
here.
