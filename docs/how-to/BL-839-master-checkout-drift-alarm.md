# BL-839: Master-Checkout Drift Alarm — Understanding the Alert

**The daemons run off the master checkout's working tree, not a committed
ref.** `handoffd.bb` and `handoffd_supervisor.bb` are invoked as
`bb <repo>/swarmforge/scripts/<script>.bb` — that resolves to whatever bytes
are on disk in the master checkout right now. If those bytes drift from what
landed on `main` (a reverted fix left staged, an uncommitted hand-edit, a
merge that didn't take), the daemons keep running the drifted code and
nothing else notices: a QA-approved fix can sit closed in `backlog/done/`
while the running system quietly executes the pre-fix behavior.

This is the detector for that gap. The **check** itself is still
**report-only / write-free**. Durable daemon-script drift is now
auto-repaired by a separate verb ([BL-1139](BL-1139-master-checkout-drift-auto-repair.md))
when not commit-in-flight — see that how-to for RESTORED notes and
handoffd bounce.

**(BL-1122 / BL-1134 / BL-1137)** While a commit is observably in flight for this
root — `.git/index.lock`, a live `git add` / `git commit` argv naming
the project, or cwd-scoped git under this root — the sweep mutes the false
`:staged-for-reversion` WARN that the add→commit window would otherwise
trigger. Durable staged reversion with no in-flight signal still alarms
(and BL-1139 may restore). See
[BL-1122](BL-1122-master-checkout-drift-mutes-warn-while-commit-in-flight.md),
[BL-1134](BL-1134-master-checkout-drift-mute-covers-post-add-window.md), and
[BL-1137](BL-1137-master-checkout-drift-mute-covers-cwd-scoped-git.md).

## What it watches

The daemon-executed script set is **derived, not hand-listed**: starting from
two seed entrypoints, it walks the same `(load-file ...)` calls those scripts
use to pull in their own dependencies, so the checked set tracks the real
dependency graph as it grows.

| Entrypoint | Why it's a seed |
|---|---|
| `handoffd.bb` | The main coordination daemon — delivery, chase, flow-watchdog, every sweep in its cadence loop |
| `handoffd_supervisor.bb` | Its restarter |

For every script in that closure, the check compares three independent
readings of `swarmforge/scripts/<file>.bb`:

- the content committed on `main`
- the content **staged** in the master checkout's index
- the content on disk in the master checkout's **working tree**

## Verdicts

| Verdict | Meaning |
|---|---|
| `:no-drift` | All three readings agree. Nothing is emitted. |
| `:staged-for-reversion` | The index differs from `main` — one `git commit` away from landing the drift on `main`. Reported as the more urgent case. |
| `:uncommitted-edit` | The index matches `main` but the working tree doesn't — a plain unstaged edit. |
| `:unknown` | Any of the three reads failed (can't resolve `main`, can't read a file). Never reported as clean — `:unknown` outranks both `:drift` and `:no-drift` when rolling up the overall verdict, so one unreadable file can't be masked by the rest reading clean. |

## Where the alarm lands

Runs on the same sweep cadence as the flow watchdog inside `handoffd.bb`, and
reuses its alarm channel (`flow-watchdog-emit-alarm!`) — the durable
Telegram **Operator** topic outbox every other unsuppressable alarm in that
sweep block writes to. No new alerting channel, and the sweep runs
unconditionally (same as the flow watchdog) rather than going quiet under
any pause/wake-suppression state.

## Operator workflow

1. Receive a "MASTER CHECKOUT DRIFT" (or "...COULD NOT RUN") alert in the
   Operator Telegram topic. The alarm text names each affected file and its
   verdict.
2. For `:staged-for-reversion` or `:uncommitted-edit`: inspect the master
   checkout directly (`git -C <repo> diff main -- swarmforge/scripts/`,
   `git -C <repo> status`) to see what actually changed and why — an
   in-flight operator hotfix and an accidental reversion look identical to
   the alarm; only a human reading the diff can tell them apart.
3. Decide by hand whether to land the change (commit it properly, e.g. as a
   certified hotfix — see
   [Certifying an operator hotfix](BL-848-certify-an-operator-hotfix.md)) or
   discard it (`git checkout main -- <path>` / unstage as appropriate).
4. For `:unknown`: the check couldn't resolve `main` or read a file — this is
   itself worth investigating (detached HEAD, corrupt checkout) even though
   no specific file drift was confirmed.

## What it does not do

`check-master-checkout-drift!` never writes: every git call is read-only
plumbing (`show`, `rev-parse --verify`), every filesystem call is a read.
**Auto-restore of durable daemon-executed drift** is a separate verb
([BL-1139](BL-1139-master-checkout-drift-auto-repair.md)) — it never runs
while commit-in-flight, never touches non-daemon paths, and never
auto-commits onto `main`.

Also out of scope, deliberately: cleaning up any specific past reversion
incident as a one-off operator ceremony, and moving the daemons off the
working tree onto a committed ref (a much larger change to how the swarm
boots).

## See also

- [Auto-repair durable daemon-script drift (BL-1139)](BL-1139-master-checkout-drift-auto-repair.md)
- [Flow Watchdog](../reference/Specification.MD) — the alarm channel this
  check reuses (`flow-watchdog-emit-alarm!`, the same Telegram Operator
  outbox).
- [Certifying an operator hotfix](BL-848-certify-an-operator-hotfix.md) — the
  sanctioned path for landing a deliberate hand-made change this check would
  otherwise flag as drift.
