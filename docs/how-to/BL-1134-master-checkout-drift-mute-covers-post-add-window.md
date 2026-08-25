# Drift mute covers the post-git-add window (BL-1134)

BL-1122 muted MASTER CHECKOUT DRIFT WARNs while `.git/index.lock` was held.
After `git add` finishes the lock is gone, but the index can still disagree
with `main` until `git commit` completes. That post-add gap still classified
as `:staged-for-reversion` and flooded Operator Alerts (seen live after
BL-1122 landed).

## Fix

`commit-in-flight?` in `master_checkout_drift_lib.bb` is still read-only and
still not sticky. It is true when either:

1. `.git/index.lock` exists (BL-1122), or
2. a live process argv looks like `git add` / `git commit` (optionally
   `git -C …`) and mentions this project root (BL-1134).

Cwd-scoped `git add` / `git commit` (root absent from argv) is **not**
covered here — that residual is [BL-1137](BL-1137-master-checkout-drift-mute-covers-cwd-scoped-git.md).

While in flight, `:staged-for-reversion` does **not** WARN. Durable staged
reversion with **no** lock and **no** matching git process still alarms
(BL-839 preserved). `:uncommitted-edit` / `:unknown` are unchanged.

Classifier: `git-add-or-commit-argv-for-root?` (BL-1137 prefers the
cwd-aware process classifier). Tests may inject a process argv snapshot;
production reads `ps`.

## Related

- [BL-1137 cwd-scoped mute](BL-1137-master-checkout-drift-mute-covers-cwd-scoped-git.md)
- [BL-1122 mid-commit mute](BL-1122-master-checkout-drift-mutes-warn-while-commit-in-flight.md)
- [BL-839 drift alarm](BL-839-master-checkout-drift-alarm.md)

Acceptance:
`specs/features/BL-1134-master-checkout-drift-mute-covers-post-add-window.feature`
