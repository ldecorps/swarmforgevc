# BL-577 — architect bounce (commit d92138649f)

Verdict: **architecturally COMPLIANT, bounced on a correctness defect.**
Read the "What passed" section — the design is right, the fix is small and
local to `flow-watchdog-emit-alarm!` + `run-sweep!`'s state write.

## Defect (blocking): the alarm is recorded as sent on ATTEMPT, not on a confirmed write

This is the BL-333 failure shape verbatim — the alarm for a silent failure
fails silently — and it lands in the one ticket whose entire thesis is
"alarm path is unsuppressable by design."

`handoffd.bb:1460` (`flow-watchdog-emit-alarm!`):

```clojure
(try
  (fs/create-dirs (fs/parent reply-outbox))
  (spit (str reply-outbox) ... :append true)
  (log! "flow-watchdog-alarm" text)        ; <-- INSIDE the try, AFTER the spit
  (catch Exception e (log! "flow-watchdog-telegram-error" (.getMessage e))))
```

`flow_watchdog_lib.bb:292` (`run-sweep!`):

```clojure
((:emit-alarm! adapters) text)             ; <-- return value ignored
(assoc acc-state (keyword (:id parcel))
       (assoc ... :tier (name tier) :alarmedAt now-ms))   ; <-- recorded regardless
```

### Failure scenario

The outbox append throws (ENOSPC — this swarm already runs a disk-space
alarm on this very file; also a permissions/EIO fault on
`.swarmforge/operator/`).

1. `spit` throws. The exception is swallowed by the `catch`.
2. `(log! "flow-watchdog-alarm" text)` **never runs** — it sits after the
   throwing `spit`, inside the same `try`. Only a
   `flow-watchdog-telegram-error` line is written.
3. `emit-alarm!` returns normally, so `run-sweep!` cannot tell the write
   failed and records `:tier "warn"`.
4. Next sweep: `decide-tier` sees `highest-tier-alarmed = :warn` and
   returns `:none`. **The warn alarm is permanently suppressed.**
5. At escalate the same write fails again and is likewise recorded, so the
   escalate alarm is permanently suppressed too.

Net: a stalled parcel produces zero alarms and zero alarm records, leaving
only two `*-telegram-error` log lines that nothing reads proactively — the
exact "chase-escalations.json is read by nothing proactively" failure mode
this ticket was written to eliminate.

### Why this is not covered by the ticket's stated blind mode

`out_of_scope`/blind-mode 2 covers the **bridge dead** case, where the write
SUCCEEDS and the alarm sits durably queued. Its stated mitigation is:

> every alarm is also written to handoffd's log and the state file

For the write-**fails** case that mitigation is not implemented: the log
call is inside the failing `try`, so there is no log record either. No
acceptance scenario covers a failed alarm write, so this is an unhandled
path rather than an accepted risk.

### Contrast with the precedent this code claims to mirror

`handoffd.bb:886` (`endless-loop-halt`, cited in the new code's own comment)
gets the ordering right:

```clojure
(log! "endless-loop-halt" role reason)     ; OUTSIDE + BEFORE the try
(try
  (fs/create-dirs ...) (spit ...)
  (log! "endless-loop-telegram" role)      ; only the *delivery* confirmation is inside
  (catch ... (log! "endless-loop-telegram-error" ...)))
```

The alarm record survives a Telegram failure there; in BL-577 it does not.

### Remediation

1. Log the alarm **before** attempting the outbox write (match the
   `endless-loop-halt` ordering), so the log backstop the ticket promises
   exists on the failure path.
2. Give `:emit-alarm!` a success signal — return `true` only after the
   append succeeds, `false` from the `catch` — and in `run-sweep!` record
   the `:tier`/`:alarmedAt` entry **only** when the emit succeeded. A failed
   write then re-alarms on the next sweep instead of being permanently
   silenced. (This keeps the no-repeat-within-tier guarantee intact: state
   is still written once per *successful* alarm.)
3. Add the acceptance/unit coverage for it: an `:emit-alarm!` adapter that
   throws must leave the parcel's state entry absent and must re-alarm on
   the following sweep.

## Secondary (fix in the same parcel, not independently blocking)

`flow_watchdog_lib.bb:155` — `read-state`'s docstring documents the entry
shape as `{:tier :alarmedAt :snoozed?}`, but `snoozed?` at line 174 reads
`:snoozed`, and the unit tests pin `:snoozed` as the on-disk key. The
ticket's design prose also says `snoozed?`. Align the docstring to
`:snoozed` so the later snooze-**writer** slice does not write a key this
reader ignores (which would silently defeat the human ack).

## Informational only — no action required for this bounce

- `flow-watchdog-emit-alarm!` is the third verbatim copy of the same
  outbox-append block in `handoffd.bb` (lines 885, 922, 1461). Folding it
  into a shared helper (`daemon_alarm_lib.bb` is the natural home) would
  make remediation item 1 a one-place fix for all three alarms.
- `flow_watchdog_lib/list-handoff-files` is a fourth copy of mailbox
  traversal, alongside `handoff-lib/handoff-files` + `batch-dirs`,
  `chase_sweep_lib/collect-in-process`, and
  `chase_sweep_lib/list-handoff-files-with-batches`. The co-change tool
  ranks `handoffd.bb` ↔ `chase_sweep_lib.bb` at 12 co-changes (SUSPECTED
  COUPLING), which is consistent with this duplication.

## What passed (do not rework these)

- **Dependency gate (BL-259 hard gate)**: PASSED on the parcel's changed JS
  (`../specs/pipeline/steps/bl577...Steps.js`, `../specs/pipeline/steps/index.js`)
  and on a full-repo scan. No forbidden edges.
- **Layer boundary**: correct. Pure decision core (`decide-tier`,
  `decide-verb`, `parse-ms-config`, `parcel-age-ms`, `humanize-age-ms`,
  `format-alarm-text`, `prune-progressed-entries`) is separated from the
  impure `run-sweep!`, and all environment access enters through injected
  adapters (`:live-session?`, `:emit-alarm!`). handoffd holds only the thin
  environment-specific wiring.
- **Structural no-suppression guarantee**: genuinely structural, not policy.
  `decide-tier` binds exactly the five allowed keys, and
  `tier-decision-input-keys` pins the set under test. `decide-verb` is
  correctly kept outside the tier decision so role/mailbox liveness informs
  the *prescription* without ever gating *whether* to alarm.
- **Shared-resolver discipline (BL-128)**: role enumeration goes through
  `handoff-lib/mailbox-dir`, which resolves per-role subdirectories, so
  master-resident and worktree mailboxes are both covered with no
  double-scan. Header parsing reuses `handoff-lib/header-field` rather than
  adding a second, drifting parser.
- **Sweep placement**: correct — inside the `chase-sweep-every-cycles`
  cadence gate but outside `outbound-wakes-suppressed?`, which is what the
  ticket requires and what the "no tmux wake, read-only alarm" rationale
  justifies.
- **Config degradation**: absent / malformed / zero / negative all fall back
  to the defaults via `backlog-depth-lib/conf-file-path`; the watchdog is
  never disabled by config. Thresholds are single-sourced in the lib and
  correctly left commented-out in `swarmforge.conf`.
- **Age precedence**: `enqueued_at` then `created_at`, never mtime; nil age
  fails closed. Matches the ticket and `mono_router_lib`'s `note-aged?`.
- **BL-441 draft guard**: honored — the `.feature.draft` was renamed to a
  live `.feature`, handlers wired in `specs/pipeline/steps/index.js`, and
  the ticket's `acceptance:` path updated in the same commit.
- **BL-506 scope**: clean. Every file in the parcel commits belongs to
  BL-577; no ticket-less functional files folded in.
- **Tests green as received**: `flow_watchdog_test_runner.bb` → `ALL PASS`;
  `test_handoffd_flow_watchdog_wiring.sh` → both wiring assertions pass
  against the real daemon.

## Property testing

Not run this round — the property pass follows a passing architectural
review. `parcel-age-ms`/`humanize-age-ms` and the `decide-tier` monotonicity
invariant are good property candidates; I will assess them on the rework.

## Branch hygiene note for the rework

Per BL-490/BL-495 the bounced merge was reverted out of `swarmforge-architect`
(revert commit `0faa8c4c6`). Before merging the rework I will revert that
revert first, so the base BL-577 content is not silently missing.
