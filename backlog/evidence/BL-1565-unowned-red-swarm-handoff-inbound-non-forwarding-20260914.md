# Unowned reds found while working BL-1565 (coder, 2026-09-14)

Three standing-lane test files fail on `main`, independent of this ticket's
own change (each confirmed below). None has a row in
`backlog/standing-reds.tsv` as of this commit.

## 1. test_swarm_handoff_inbound_non_forwarding.sh

`swarmforge/scripts/test/test_swarm_handoff_inbound_non_forwarding.sh` (lane:
shell, standing per `suite-manifest.tsv`) fails deterministically on `main` at
its third case ("an ordinary (non-marked) inbound alone does not block the
forward").

## Repro

```
bash swarmforge/scripts/test/test_swarm_handoff_inbound_non_forwarding.sh
```

Cases 01/02 PASS. Case 03 FAILS:

```
FAIL: ordinary-only in_process: expected exit 0, got 1: ...
AUDIT_REQUIRED
HANDOFF_NOT_QUEUED
...
```

## Root cause (traced, not fixed - out of BL-1565's scope)

The test's `run_send` calls `swarm_handoff.bb` exactly ONCE per case. A
`git_handoff` send always goes through the two-call self-audit challenge
(`submit-after-audit!`): the FIRST call for any (sender, task-id) always finds
no matching `previous` candidate, so it ALWAYS prints `AUDIT_REQUIRED` /
`HANDOFF_NOT_QUEUED` and, since BL-1529, exits non-zero - it queues nothing.
The test's single-call design predates that BL-1529 exit-code change (its own
header names only BL-1302) and was never updated to the two-call protocol, so
case 03's `[[ "$rc3" -eq 0 ]]` can never pass as written.

Independently, even a second identical call would still not reach exit 0 in
this fixture: `run_send` exports `SWARMFORGE_SKIP_DAEMON=1` but the fixture
never creates a `.swarmforge/tmux-socket` file, so `deliver-parcel!` always
throws `"tmux socket file missing"`; caught and non-fatal WITHOUT
`SWARMFORGE_SKIP_DAEMON`, but fatal (exit 1) WITH it (`swarm_handoff.bb`
-main's `(skip-daemon?) (exit! 1 ...)` branch). The established escape from
this (`test_mailbox_only_delivery.sh`'s pattern) is
`SWARMFORGE_MAILBOX_ONLY=1` with `SWARMFORGE_SKIP_DAEMON` left UNSET, which
routes through the `:skipped` sync-result instead of a real tmux attempt.

## Confirmed unrelated to BL-1565

`git diff HEAD -- swarmforge/scripts/swarm_handoff.bb` at the point this was
found touches only two new early-exit branches (the BL-1565 recipient guard)
that never fire for this test's `to: coder` drafts; the self-audit and
delivery code paths this red lives in are untouched by this parcel.

## What BL-1565's own new shell test does differently

`test_swarm_handoff_refuses_coordinator_git_handoff.sh` avoids both traps:
its refusal cases exit before either code path is reached, and its one
allowed-send case does the two-call audit dance and uses
`SWARMFORGE_MAILBOX_ONLY=1` (unset `SWARMFORGE_SKIP_DAEMON`) for the
delivery leg.

## 2. test_dispatch_gap_autoroute.sh

`swarmforge/scripts/test/test_dispatch_gap_autoroute.sh` fails at its first
assertion, a pure data-shape check of `chase-sweep-lib/dispatch-gap-items`
(no `swarm_handoff.bb` send involved):

```
Assert failed: unexpected gaps: [{:id "BL-217", :assigned-to "coder", :status "todo"}]
(= [{:id "BL-217", :assigned-to "coder"}] gaps)
```

`dispatch-gap-items` (via `read-active-items`) now returns a `:status` key
the test's exact-equality assertion never expected. `chase_sweep_lib.bb` is
untouched by this parcel's diff - confirmed unrelated.

## 3. test_operator_runtime_hotfix_certification_sweep.sh

`swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh`
fails at "the pre-seeded pending entry (no stamp ticket) triggered a
coordinator nudge" - the nudge never lands in the fixture's runtime log.
The nudge itself is a `type: note` / `to: coordinator` send
(`operator_runtime.bb`'s `send-hotfix-cert-mint-nudge!`), which this
ticket's own guard never touches (git_handoff only). Confirmed unrelated by
re-running this test with BL-1565's changes to `swarm_handoff.bb` and
`git_handoff_recipient_guard_lib.bb` stashed out: identical failure against
the pristine tree.

Reported per the standing-red rule (2026-09-05): no row for any of the three
exists in `backlog/standing-reds.tsv` as of this commit.
