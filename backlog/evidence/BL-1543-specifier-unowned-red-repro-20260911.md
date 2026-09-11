# BL-1543 — specifier unowned-red reproduction, 2026-09-11

Trigger: one coder `unowned-red` note, 18:27Z, priority 00, from the BL-1526
parcel: `unowned-red: test_handoffd_master_checkout_drift_wiring.sh
RESTORED-before-DRIFT` (coder evidence:
`backlog/evidence/BL-1526-unowned-red-coder-20260911.md` in the coder
worktree). No row in `backlog/standing-reds.tsv` for the file; no open ticket
names it (`grep -rl test_handoffd_master_checkout_drift_wiring backlog/active
backlog/paused backlog/hold` empty). Not a fold-in.

## Reproduction on main 41bacc37a1 (`main...origin/main` 0/0)

```
$ bash swarmforge/scripts/test/test_handoffd_master_checkout_drift_wiring.sh
Traceback (most recent call last):
  File "<stdin>", line 7, in <module>
AssertionError: alarm text missing the stakes statement: 'MASTER CHECKOUT DRIFT RESTORED: swarmforge/scripts/handoffd_supervisor.bb'
exit 1
```

Deterministic (same line the coder saw). No process naming the fixture root
survived the run (`pgrep -af <root>` empty afterwards).

## Cause: the test asserts BL-839's detect-only contract, which BL-1139 superseded

The test (BL-839, landed 4858d75ca7 on 2026-08-07) boots the REAL
`handoffd.bb` against a disposable repository holding an uncommitted edit to
`swarmforge/scripts/handoffd_supervisor.bb`, then asserts:

- case 01: the first OPERATOR-topic outbox line containing
  `MASTER CHECKOUT DRIFT` names the path AND carries the stakes phrase
  `not the code` (BL-839 scenario 03's alarm text);
- case 02: the drifted file still shows as modified afterwards ("the check
  never repairs", BL-839 scenario 05).

BL-1139 (`849e9fc4e6`, landed 2026-08-25, human directive 2026-08-25: "the
swarm must deal with durable daemon-script drift without human
intervention") made the daemon's `master-checkout-drift-sweep!` call
`repair-master-checkout-drift!` instead of the write-free check. On durable
drift with no commit in flight that verb:

1. runs the check SILENTLY (`:emit-alarm! nil`, so no `MASTER CHECKOUT
   DRIFT:` WARN is ever written for the episode);
2. `git checkout main -- <path>` for every drifted path inside the
   daemon-executed closure;
3. re-checks; on `:no-drift` emits ONE `MASTER CHECKOUT DRIFT RESTORED:
   <paths>` line through the same `flow-watchdog-emit-alarm!` outbox
   (`handoffd.bb` `master-checkout-drift-sweep!`, `:emit-restored!`);
4. defers a bounce: a thread sleeps 2 s then runs the REAL
   `start_handoff_daemon.sh <root>` (`defer-handoffd-bounce-after-drift-repair!`).

So on today's daemon the fixture's only `MASTER CHECKOUT DRIFT` line IS the
RESTORED note (case 01's grep matches it, the `not the code` assertion
fails), and case 02 would fail next because the file was restored. The
coder's reading ("either the DRIFT alarm never landed before the repair
fired, or ordering in the outbox is not what the test assumes ... a
race/ordering bug in the wiring") is not right: no WARN is emitted on a
successful repair by design (`run-repair-attempt!` passes the silent
result to `finish-successful-restore!`, which emits only the RESTORED
note). The wiring is doing exactly what BL-1139 specified; the TEST is the
stale half. BL-1139's own acceptance drives the lib with fakes
(`bl1139MasterCheckoutDriftAutoRepairSteps`), and nothing re-tensed the
BL-839 wiring test that boots the real daemon - BL-1006's shape (the
successor slice never retired the boundary its predecessor froze).

## Red since 2026-08-25

- BL-1122's cleaner/architect/coder evidence (2026-08-25, before BL-1139
  landed the same day) records the test ALL PASSED.
- BL-1273's QA pass (`backlog/evidence/BL-1273-qa-pass-20260829.md` line
  143) lists it among 7 handoffd wiring tests red on a detached
  `origin/main` worktree on 2026-08-29 and rules them pre-existing; it
  was never minted.
- Coder note 2026-09-11 18:27Z (above).

`first_seen` in the register: 2026-08-25.

## Hazard the re-tensed test must handle: the bounce spawns the real launcher

`defer-handoffd-bounce-after-drift-repair!` resolves `start_handoff_daemon.sh`
beside the REAL `handoffd.bb` and runs it against the FIXTURE root, 2 s
after the restore. The wiring test exports `SWARMFORGE_ALLOW_TMP_DAEMON=1`,
so on a fixture where the daemon outlives those 2 s the launcher would start
a second real handoffd + supervisor rooted in a `mktemp` directory the test
then deletes - the leaked-fixture-daemon shape babysitterd has already
mistaken for the live daemon. The launcher honours `SWARMFORGE_SKIP_DAEMON=1`
(`start_handoff_daemon.sh` line 32: prints "Skipping handoff daemon", exits
0) AFTER writing its audit line
`start_handoff_daemon invoked root=<root> pid=<pid> SKIP_DAEMON=1 caller=...`
to `<root>/.swarmforge/daemon/daemon-start-audit.log` (line 48), and
`handoffd.bb` itself never reads that variable (grep empty), so the test
can export it, keep its own directly-spawned daemon, and observe the bounce
request as that audit line without anything being started.

## In-flight branch, for the second fixture

`commit-in-flight?` is true when `<root>/.git/index.lock` exists
(`index-lock-present?`). Then `repair-master-checkout-drift!` takes
`:skip-in-flight`, runs the check WITH `emit-alarm!`, and
`should-alarm-on-result?` answers true for an `:uncommitted-edit`
(only a lone `:staged-for-reversion` is muted, BL-1122) - so the real
daemon writes the `MASTER CHECKOUT DRIFT: the code the daemons are RUNNING
is not the code ...` WARN and restores nothing. That is where BL-839's
"not the code" assertion still holds and belongs.

By specifier.
