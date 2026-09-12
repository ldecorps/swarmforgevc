# BL-1543 - specifier adjudication of the coder's spec-gap note, 2026-09-12

Trigger: coder `note` 16:21Z, priority 00: "BL-1543 spec gap: case 05's
audit-line premise is factually false". Coder evidence
`backlog/evidence/BL-1543-coder-spec-gap-skip-daemon-audit-ordering-20260912.md`
(coder worktree 820215c1e8). The coder built nothing against case 05 and
waited - the right call.

## Verified: the coder is right, the mint was wrong

`swarmforge/scripts/start_handoff_daemon.sh` on main 445b104ed3:

- lines 32-35: `if SWARMFORGE_SKIP_DAEMON == 1 -> echo Skipping ...; exit 0`
- line 37: `mkdir -p "$DAEMON_DIR"`
- line 42: `AUDIT_LOG=...daemon-start-audit.log`
- line 48: `audit "start_handoff_daemon invoked root=... SKIP_DAEMON=${SWARMFORGE_SKIP_DAEMON:-} ..."`

The skip branch exits before the audit log is defined or the directory
created. The mint's "How" said the launcher "writes its audit line and then
exits 0 ... (lines 32-48)" - I read the line range and not the order. The
mint's repro evidence carried the same misreading ("AFTER writing its audit
line").

Second check, whether any OTHER trace of the bounce exists under the skip
flag: `handoffd.bb` `defer-handoffd-bounce-after-drift-repair!` runs the
launcher through `daemon-cycle-guard-lib/sh!`, which is
`process/process ... {:out :string :err :string}` - the launcher's
"Skipping" stdout is captured and dropped; the thread `log!`s only on
exception. `master_checkout_drift_lib.bb` `finish-successful-restore!` emits
the RESTORED note and calls the bounce fn, nothing else. So under
`SWARMFORGE_SKIP_DAEMON=1` the bounce is unobservable by any file or process
state a test can read. Case 05 had no honest observable without a
production change.

Also wrong in the mint: `qa_e2e_procedure` step 4 (drop the SKIP export as
a negative control). Without the export the bounce starts a real handoffd
+ supervisor rooted in the mktemp fixture - the leaked-fixture-daemon shape.
Withdrawn.

## Ruling: split (coder's option 2, adjusted)

- **BL-1543 (active, coder)**: case 05 dropped; four cases; scenario 01
  reads "exactly 4 passed cases"; "How" corrected; e2e step 4 replaced by a
  read-the-source check; approval_context annotated (the audit-line half of
  the approved FIRM sentence moves to BL-1548 with intent preserved; the
  "never by letting a second daemon start" half stays and is what the leak
  invariant gates). Constraints unchanged: test-only, launcher untouched.
  No re-pend (BL-1455). Register row text updated.
- **BL-1548 (paused, depends_on BL-1543)**: the launcher audits the
  invocation BEFORE honouring the skip flag (still starts nothing, still
  does not clear the BL-785 stopped marker), then case 05 is added to the
  wiring test. Its own approval, since it edits a file BL-1543's approval
  marked out of scope.

Not chosen: option 1 (assert the silent skip) - the only observable is
absence, fail-open by construction (BL-1445's shape); option 3 (retire
case 05 with a PID-based negative) - already BL-1543's leak invariant,
proves nothing about the bounce having been requested.

## Who holds the parcel

Coder `inbox/in_process` and `inbox/new` are empty at 16:40Z: the coder
completed its routing note after sending this one and is idle. The
amendment note to the coder is what re-activates it (merge main, re-read
the ticket and feature, build four cases).

By specifier.
