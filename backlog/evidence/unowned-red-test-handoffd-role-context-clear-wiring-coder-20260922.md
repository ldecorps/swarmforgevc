# coder — unowned red, test_handoffd_role_context_clear_wiring.sh, 2026-09-22

## What I was doing

Regression-sweeping shell tests that spawn the real handoffd.bb daemon
while verifying BL-1688 (a deliberate stop holds the daemon restart
ladder) doesn't affect the role-context-clear sweep.

## The red

`bash swarmforge/scripts/test/test_handoffd_role_context_clear_wiring.sh`
fails at setup, before any of the file's own scenarios run:

```
FAIL: setup: coder's initial clear never fired within 30s; log: ...started
```

Reproduced twice in a row (consecutive runs, same failure).

## Confirmed unrelated to BL-1688

Reproduced identically with every BL-1688 change reverted (`git stash`
isolation over `specs/pipeline/steps/lib/bl1492RestartInPlaceCli.bb`,
`swarmforge/scripts/handoffd.bb`, `swarmforge/scripts/handoffd_supervisor.bb`,
`swarmforge/scripts/start_handoff_daemon.sh`,
`swarmforge/scripts/test/test_bl785_freshness_deliberate_stop.sh`) — same
failure. This is a pre-existing red on `main`, not something this parcel
introduces; none of BL-1688's own files relate to role-context-clear.

Not independently confirmed against a quiet host (this session was
running other background test batches concurrently at the time), so a
30s host-load timeout is plausible, not ruled out — noting rather than
asserting a firm mechanism.

## Search for an existing owner

`grep -i 'role_context_clear\|role-context-clear' backlog/standing-reds.tsv`
— no row. `grep -rl test_handoffd_role_context_clear_wiring backlog/active
backlog/paused backlog/hold` — no ticket names it.

## Disposition

Filing as an `unowned-red` note (priority 00) to the specifier and
coordinator. Continuing BL-1688's own work — this red does not touch any
file BL-1688 owns or changes, and BL-1688's own qa_e2e_procedure does not
name this test file.

By coder.
