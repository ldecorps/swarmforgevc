# BL-1543 spec gap: case 05's audit-line premise is false under the ticket's own constraints

## What the ticket assumes

The ticket's "How" section states:

> Export `SWARMFORGE_SKIP_DAEMON=1` for the whole test: `handoffd.bb` never
> reads it (so the test's own daemon is unaffected) while
> `start_handoff_daemon.sh` writes its audit line and then exits 0 without
> starting anything (lines 32-48).

Case 05 of the acceptance criteria requires the fixture's
`.swarmforge/daemon/daemon-start-audit.log` to carry
`start_handoff_daemon invoked root=<fixture root> ... SKIP_DAEMON=1` after
the daemon's repair bounces `start_handoff_daemon.sh`.

The `qa_e2e_procedure`'s negative control assumes the SAME audit line is
written even when `SWARMFORGE_SKIP_DAEMON` is unset — just with
`SKIP_DAEMON=` empty instead of `=1` — and treats "audit line missing" as
the failure signal for a dropped `SKIP_DAEMON=1` export.

## What the code actually does

`swarmforge/scripts/start_handoff_daemon.sh` lines 32-48, read in order:

```bash
32  if [[ "${SWARMFORGE_SKIP_DAEMON:-}" == "1" ]]; then
33    echo "Skipping handoff daemon (SWARMFORGE_SKIP_DAEMON=1)."
34    exit 0
35  fi
36
37  mkdir -p "$DAEMON_DIR"
...
42  AUDIT_LOG="$DAEMON_DIR/daemon-start-audit.log"
44  audit() { ... }
...
48  audit "start_handoff_daemon invoked root=$WORKING_DIR pid=$$ SKIP_DAEMON=${SWARMFORGE_SKIP_DAEMON:-} caller=..."
```

The `SWARMFORGE_SKIP_DAEMON=1` branch (32-35) `exit 0`s BEFORE `AUDIT_LOG`
is even defined (42) or `audit` is called (48). Empirically verified:

```
$ SWARMFORGE_SKIP_DAEMON=1 bash swarmforge/scripts/start_handoff_daemon.sh /tmp/skiptest
Skipping handoff daemon (SWARMFORGE_SKIP_DAEMON=1).
$ cat /tmp/skiptest/.swarmforge/daemon/daemon-start-audit.log
cat: ... No such file or directory
```

No audit log is written at all when `SWARMFORGE_SKIP_DAEMON=1` — the file
is never even created. And the reverse holds too: with
`SWARMFORGE_SKIP_DAEMON` unset, the script does NOT stop at auditing — it
falls through past line 48 and actually starts a real `handoffd.bb` +
supervisor. The described negative control ("drop the export, audit line
reads `SKIP_DAEMON=` empty") would leak a real daemon process, not just
flip one field in an audit line.

## Why this blocks case 05 as specified

The ticket is a **test-only parcel**: `start_handoff_daemon.sh` is
explicitly out of scope ("Test-only parcel: `handoffd.bb`,
`master_checkout_drift_lib.bb` and `start_handoff_daemon.sh` are not
edited"). Case 05 as written can never pass against the real script's
current behavior — not a flaky timing issue, a structural ordering one:
the exit-early skip branch precedes the audit machinery unconditionally.

Writing the test to assert what case 05 currently describes would produce
a test that is red by construction, or would require silently loosening
case 05's assertion (e.g. asserting the auditless-exit behavior instead),
which is a spec change, not a test-tensing.

## Options for the specifier to adjudicate

1. Amend case 05 to assert the script's real contract (silent skip, no
   audit line, `SKIP_DAEMON=1`'s only observable is the empty outbox/log
   dir) — a genuine re-tensing, not a fold into scope-creep.
2. Split off a follow-up ticket that reorders
   `start_handoff_daemon.sh` lines 32-48 (move `audit()`/`AUDIT_LOG`
   above the skip check) so the skip path leaves an audit trail before
   exiting, and have BL-1543 depend on it — this touches the
   out-of-scope file, so it cannot ride this parcel.
3. Retire case 05 entirely and prove the bounce reached the launcher a
   different way that doesn't depend on the audit line (e.g. asserting no
   second daemon PID exists / no listener bound) if the audit-line
   observable is judged not worth the file edit.

No implementation attempted against case 05 pending this ruling. Cases
01-04 do not depend on this contract and are unaffected.
