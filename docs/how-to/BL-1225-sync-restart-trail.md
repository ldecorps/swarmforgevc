# A build-freshness sync's restarts leave a readable trail (BL-1225)

*How-to. Task-oriented: understand what changed in the audit trail a sync
leaves behind, and how to read it during a post-mortem.*

`bb swarmforge/scripts/build_freshness_cli.bb <root> sync` restarts two
process groups when the build is stale: the operator runtime and the
handoff daemon. Both restarts had a forensic gap that made a post-mortem
after the fact harder than it needed to be; both are now closed.

## `runtime.log` is appended, never truncated

`restart-operator-group!` used to spawn the replacement
`operator_runtime.bb` with a path *string* in babashka.process's `:out` —
which truncates the file. Every sync therefore erased whatever the
previous runtime had written to `.swarmforge/operator/runtime.log`, and a
sync runs frequently (once per QA merge). A post-mortem investigating a
crash window could only ever see the log since the *last* restart, never
the run that actually crashed.

The spawn now goes through `build-freshness-lib/operator-log-spawn-opts`,
which opens the log with `:append true` — the same append behaviour
`start_operator_runtime.sh` already gets from a plain `>>`. After a sync,
`runtime.log` keeps growing: the previous runtime's last lines are still
there, followed by the replacement's own startup output.

## A sync-initiated handoffd restart is attributable

`start_handoff_daemon.sh` has always read `SWARMFORGE_DAEMON_START_CALLER`
and printed it into its `.swarmforge/daemon/daemon-start-audit.log` start
line — but nothing ever set the variable, so every daemon start audited as
`caller=unknown`, sync-initiated or not. Tying a start back to a sync
meant correlating timestamps by hand against when a sync ran.

`restart-handoffd-group!` now passes
`SWARMFORGE_DAEMON_START_CALLER=build_freshness_cli` (the value of
`build-freshness-lib/daemon-start-caller`, a shared constant rather than a
duplicated literal) as extra environment to `start_handoff_daemon.sh`, so
the resulting audit line reads:

```
start_handoff_daemon invoked root=<root> pid=<pid> SKIP_DAEMON= caller=build_freshness_cli
```

Only the sync's own start sets it — a `start_handoff_daemon.sh` invocation
from anywhere else (a direct run, `./swarm ensure`, a manual restart) still
audits as `caller=unknown`, so the label means something when you see it.

## What did not change

- Which process groups a sync restarts, or the order it restarts them in.
- BL-433's graceful stop-file, `status.json` deletion before relaunch, and
  bounded settle-wait for a fresh `build_sha` — all untouched.
- The restart still spawns `operator_runtime.bb` directly rather than
  going through `start_operator_runtime.sh` (that consolidation is
  deferred as a remaining slice on epic BL-539 — it carries a behaviour
  question about `SWARMFORGE_SKIP_OPERATOR` this ticket does not answer).

## Where it lives

| Piece | Location |
| --- | --- |
| Spawn-opts helper | `build-freshness-lib/operator-log-spawn-opts` (`swarmforge/scripts/build_freshness_lib.bb`) |
| Caller constant | `build-freshness-lib/daemon-start-caller` = `"build_freshness_cli"` (`swarmforge/scripts/build_freshness_lib.bb`) |
| Wired from | `restart-operator-group!` / `restart-handoffd-group!` (`swarmforge/scripts/build_freshness_cli.bb`) |
| Acceptance | `specs/features/BL-1225-sync-initiated-restart-leaves-a-readable-trail.feature` |

## Related

- BL-1224 — the sibling half of the same operator intake: stops a
  sync-initiated operator restart from being misread as a crash by the
  operator-runtime watch (see
  [`BL-993-operator-runtime-watch.md`](BL-993-operator-runtime-watch.md)
  "A deliberate restart by something else is adopted, never counted as a
  crash"). That ticket stops the false alarm; this one only preserves the
  evidence a real post-mortem needs.
- BL-433 — the operator restart's stop-file/settle-wait sequencing this
  ticket leaves untouched.

## Verify

```bash
bb swarmforge/scripts/test/build_freshness_lib_test_runner.bb
npx vitest run --config vitest.properties.config.mjs test/bl1225SyncRestartTrailInvariants.property.test.js
specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1225-sync-initiated-restart-leaves-a-readable-trail.feature
```
