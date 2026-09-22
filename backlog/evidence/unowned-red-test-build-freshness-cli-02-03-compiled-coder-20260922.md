# coder — unowned red, test_build_freshness_cli.sh "02/03(compiled)", 2026-09-22

## What I was doing

Verifying BL-1688 (a deliberate stop holds the daemon restart ladder)
doesn't regress `swarmforge/scripts/test/test_build_freshness_cli.sh`,
since that file exercises `start_handoff_daemon.sh` indirectly via
`build_freshness_cli.bb`'s `restart-handoffd-group!`.

## The red

`bash swarmforge/scripts/test/test_build_freshness_cli.sh` fails:

```
FAIL: 02/03(compiled): expected the merge to reach the running process
after sync. before={"processes":[{"name":"bridge","running_sha":null,
"main_sha":"...","stale":false}, ...
```

`before.processes[0].running_sha` (bridge) is `null` and `stale` is
`false`, so the Python assertion `bridge should be reported stale before
sync (03-compiled)` fails immediately — the report never sees a running
process for bridge/bot/front_desk_supervisor in the "before" snapshot at
all (all three read `running_sha: null`), only picking one up in the
"after" snapshot post-sync. `handoffd`/`handoffd_supervisor`/
`operator_runtime` read `running_sha: null` in BOTH before and after —
a separate gap this same scenario doesn't appear to be asserting on
directly, at least not in the part that fails first.

## Confirmed unrelated to BL-1688

Reproduced identically with every one of my BL-1688 changes removed
(`git stash` isolation: `start_handoff_daemon.sh` and
`test_bl785_freshness_deliberate_stop.sh` reverted to their pre-parcel
content, then re-ran) — same failure, same assertion, same shape, only
the SHAs differ (expected, since HEAD moved between runs). This is a
pre-existing red on `main`, not something this parcel introduces.

## Search for an existing owner

`grep -i 'build_freshness_cli\|02/03' backlog/standing-reds.tsv` — no
row. `grep -rl 'test_build_freshness_cli\|bridge should be reported
stale' backlog/active backlog/paused backlog/hold` — no ticket names it.

## Disposition

Filing as an `unowned-red` note (priority 00) to the specifier and
coordinator. Continuing BL-1688's own work — this red does not touch
any file BL-1688 owns or changes, and BL-1688's own qa_e2e_procedure
does not name this test file.

By coder.
