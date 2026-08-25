# Drift mute covers cwd-scoped git add/commit (BL-1137)

BL-1134 muted MASTER CHECKOUT DRIFT when a live `git add` / `git commit`
argv mentioned this project root (or used `git -C <root>`). Agent commits
on main almost always run as cwd-scoped `git add` / `git commit` with the
root **absent** from argv — those never matched, so the ~45s drift sweep
still flooded Operator Alerts with `:staged-for-reversion` during real
edits.

## Fix

`commit-in-flight?` remains read-only and non-sticky. It is true when any of:

1. `.git/index.lock` exists (BL-1122), or
2. a live `git add` / `git commit` argv mentions this project root /
   `git -C …` (BL-1134), or
3. a live `git add` / `git commit` process has cwd exactly this project
   root or under `root/` (BL-1137).

Classifier: `git-add-or-commit-process-for-root?` (argv-only helper
`git-add-or-commit-argv-for-root?` delegates with nil cwd). Production
best-effort reads process cwd via `process-table-lib`.

While in flight, `:staged-for-reversion` does **not** WARN. Durable staged
reversion with **no** lock and **no** matching git process still alarms
(BL-839). Foreign-cwd git does not mute this root.

## Related

- [BL-1134 post-add argv mute](BL-1134-master-checkout-drift-mute-covers-post-add-window.md)
- [BL-1122 mid-commit mute](BL-1122-master-checkout-drift-mutes-warn-while-commit-in-flight.md)
- [BL-839 drift alarm](BL-839-master-checkout-drift-alarm.md)

Acceptance:
`specs/features/BL-1137-master-checkout-drift-mute-covers-cwd-scoped-git.feature`
