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

## Current state

The key is **on** (`true`). It shipped **off**, naming BL-1236 as the
re-enable condition; BL-1236 landed, and BL-1251 — the operator decision
this ticket deliberately deferred rather than taking on the human's behalf —
re-armed it on 2026-08-29 (`cce70d985`) after a live clean-tree absorb
proved the corrected predicate and cleared a durable skipped-by-config
deadlock that was parking coordinator bookkeeping. The conf comment records
the decision in place of the original condition. BL-1251 also retired
scenario 04 of this ticket's own feature file, which had asserted the
shipped value was `false` — a scenario that is red-when-correct the moment
the flip lands, per its own `RETIRE-WITH` marker naming BL-1251 as retirer.

Flipping it back to `false` again remains available via the same conf line,
for the same reasons this section originally listed: a known predicate bug,
an unpushed ahead set to keep, or an ops hold forbidding a destructive tick.

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
