# BL-1071 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `812b9a9808` (map tmux `spawn-failed?` to control-plane
`:unavailable` after BL-1102's non-throwing `sh!`) into `swarmforge-cleaner`
via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 812b9a9808 HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/control_plane_lib_test_runner.bb`:
   ok.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix.feature`:
   10/10 pass (including unreadable→unavailable, no ensure on observation throw).

## Cleanup performed

- `observe!`: shared `base` map for both branches; extracted
  `probe-spawn-error` for the blank-output fallback.

## Findings beyond that

NONE. Spawn-failed stays `:unavailable` (never `:control-plane-missing`);
stamp-off surface unchanged beyond this classification edge.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix`.

By cleaner.
