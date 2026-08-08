# BL-839: Master-Checkout Drift Alarm — Understanding the Alert

**The daemons run off the master checkout's working tree, not a committed
ref.** `handoffd.bb` and `handoffd_supervisor.bb` are invoked as
`bb <repo>/swarmforge/scripts/<script>.bb` — that resolves to whatever bytes
are on disk in the master checkout right now. If those bytes drift from what
landed on `main` (a reverted fix left staged, an uncommitted hand-edit, a
merge that didn't take), the daemons keep running the drifted code and
nothing else notices: a QA-approved fix can sit closed in `backlog/done/`
while the running system quietly executes the pre-fix behavior.

This is the detector for that gap. It is **report-only** — see "What it does
not do" below.

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

This check never writes: every git call is read-only plumbing (`show`,
`rev-parse --verify`), every filesystem call is a read. It does **not**
auto-restore the master checkout to match `main` — an auto-repair would
discard a human's or another role's uncommitted work without asking, which
is exactly the "surfaced, not swept" failure the constitution's handoff
discipline exists to prevent. If the drift is real, a human resolves it by
hand per the workflow above.

Also out of scope, deliberately: cleaning up any specific past reversion
incident (a one-off operator action, not this ticket's job), and moving the
daemons off the working tree onto a committed ref (a much larger change to
how the swarm boots).

## See also

- [Flow Watchdog](../reference/Specification.MD) — the alarm channel this
  check reuses (`flow-watchdog-emit-alarm!`, the same Telegram Operator
  outbox).
- [Certifying an operator hotfix](BL-848-certify-an-operator-hotfix.md) — the
  sanctioned path for landing a deliberate hand-made change this check would
  otherwise flag as drift.
