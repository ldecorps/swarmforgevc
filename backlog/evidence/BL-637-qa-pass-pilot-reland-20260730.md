# BL-637 QA pass (re-land adapted, cursor-as-expeditor /pilot)

Date: 2026-07-30

Prior land dropped off main; stale cherry-pick conflicted (babysitterd start deleted,
kill_all body diverged). Re-implemented against current tip.

## Checks

- `test_lifecycle_script_scope.sh` 14/14
- Acceptance 8/8 via `bl637Only.js`

## Result

Pass. Ticket paused→done.
