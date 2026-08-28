# BL-1217 cleaner pass — 2026-08-28

Merged coder handoff `bd9dfee09e` for BL-1217 (RC repair gates on the
effective `config remote_control off` setting, not only the persisted
launch script — a deliberately-disabled seat was being fought and
respawned by every repair path). Resolved a trivial `index.js` ordering
conflict.

## Review
`expected-rc-name` gates through the existing shared resolvers
(`backlog-depth-lib/conf-file-path`, `coordinator-config-lib/raw-config-value`)
rather than a third hand-rolled conf reader. Fails open on an unreadable
conf file (never a spurious `:off`). Every real repair call site inherits
the gate with zero changes, since `classify`/`actionable?` already treat a
nil expected name as `:off`. No duplication or structural issues.

## Verification
- `test_remote_control_health.sh`: all 22 scenarios pass (5 new).
- Acceptance (`BL-1217-rc-repair-gates-on-config-not-only-the-launch-script.feature`
  via `run_acceptance.sh`): 8/8 pass, 0 leaked `/tmp/bl1217-*` directories.
- `tsc --noEmit`: clean (no TS files touched, checked for regression only).

By cleaner.
