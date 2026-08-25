# Master-checkout drift mutes WARN while a commit is in flight (BL-1122)

BL-839 correctly WARNs when daemon scripts in the master checkout disagree
with `main`. On a busy `main`, every `git add` / `git commit` creates a
brief window where the index differs from `main` even though the staged
bytes are the **forward** change about to land. That looked like
`:staged-for-reversion` and flooded Operator with false MASTER CHECKOUT
DRIFT alarms.

## Fix

`master_checkout_drift_lib.bb` observes `.git/index.lock` via
`commit-in-flight?` (read-only). While that signal is present, the sweep
does **not** emit the MASTER CHECKOUT DRIFT WARN for
`:staged-for-reversion`. When the lock is gone, the next sweep classifies
normally — durable staged reversion still alarms (BL-839 preserved). The
mute is not sticky and the check never writes the index/worktree.

`:uncommitted-edit` / `:unknown` are unchanged.

## Related

- [BL-839 drift alarm](BL-839-master-checkout-drift-alarm.md)

Acceptance:
`specs/features/BL-1122-master-checkout-drift-mutes-warn-while-commit-in-flight.feature`
