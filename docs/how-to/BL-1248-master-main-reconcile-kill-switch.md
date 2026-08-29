# Disable (or re-enable) the master-main-reconcile sweep from config (BL-1248)

## When you need this

The handoff daemon's master-main-reconcile sweep can absorb or rematch
`origin/main` onto the master checkout's local `main`. When that path is
unsafe — a known predicate bug, an unpushed ahead set you must keep, or an
ops hold that forbids restarting into a destructive tick — turn the sweep
**off** with one conf line. Drift logging and dirty-blocked / conflict
surfacing still run; only the reconcile **action** (`:merge!`) is skipped.

## The switch

In `swarmforge/swarmforge.conf`:

```text
config master_main_reconcile_enabled false
```

| Conf value | Sweep action |
|---|---|
| exact token `true` | runs (reconcile may fire) |
| `false`, absent, empty, malformed, anything else | **does not run** (fail closed) |

Only the exact three-token line `config master_main_reconcile_enabled true`
enables it. Trailing garbage (`true true`), case variants (`True`), and
near-affirmatives (`1`, `yes`) all stay disabled.

When a tick skips the action, the daemon log records
`master-main-reconcile skipped-by-config`.

## Shipped default

This repo ships the key **off** (`false`). The conf comment names BL-1236
as the original re-enable condition. BL-1236 has landed; whether to flip
the switch back on is a separate operator decision tracked as **BL-1251** —
do not flip to `true` casually after thirteen realised commit losses and
before the corrected predicate has live production ticks behind it.

## What it does not silence

- Drift ahead/behind log lines
- Dirty-overlap / conflict notes and escalation to the operator
- Other cadence sweeps (push-sweep, post-qa-branch-sweep, …)

Placing a guard at `handoffd`'s `run-sweep!` call site would silence those
notifications too. The guard lives inside
`master-main-reconcile-lib/sweep!` on the `:should-reconcile` branch only.

## Related

- [Master-Main Reconcile Sweep — Understanding the Note](BL-891-master-main-reconcile-sweep.md)
- [Reconcile conflict prediction trusts git's verdict](BL-1236-reconcile-conflict-prediction-from-git-verdict.md)
