# BL-1071 — architect pass (BL-1102 spawn-failed re-pass), inventory NONE — 20260824

Reviewed cleaner `257de9b81` (on coder `812b9a9808`) into
`swarmforge-architect`. Merged cleanly; ancestry confirmed. Prior stamp-off
trail (architect pass `ab4b5aa93`, hardener/documenter/QA evidence on
2026-08-23) remains in lineage; this pass re-reviews only the unhold
re-pass that closes the BL-1102 interaction.

## Re-pass context

BL-1102 made `daemon_cycle_guard_lib/sh!` return `{:spawn-failed? true}`
instead of throwing. Missing `tmux` no longer hit `observe!`'s catch and
was classified as `:control-plane-missing` (queues `./swarm ensure`) instead
of `:unavailable`. That broke stamp-off invariant 3 / acceptance scenario
"unreadable → unavailable".

## Scope this tip

- `probe-server!` forwards `:spawn-failed?`
- `observe!` maps spawn-failed → `:unavailable` + `:error` (cleaner DRY:
  shared `base` + `probe-spawn-error`)
- Fixture comment aligned with non-throwing `sh!`

## Architecture

- Correct classification edge: cannot-observe ≠ plane-missing recovery.
- Preserves stamp-off posture (review/confirm, no rewrite of f6b6aef25
  core). No webview/host/secrets issue.
- Stamp-off tip hygiene: HOTFIX_PATHS match `27273f2b0a`; BL-1113 9/9.

## Required hard gate

No `extension/src` production files. Dep-gate N/A (babashka + fixture/
APS only).

## Invariants review (BL-633/BL-654)

Declared stamp-off invariants still hold; this tip specifically restores
invariant 3 under BL-1102's non-throwing spawn:

| # | Invariant | Verified |
|---|---|---|
| 3 | Unreadable probe → unavailable, never absence/missing-plane | Acceptance 10/10 + unit ok |

## Correctness read-through

- `control_plane_lib_test_runner.bb` ok; acceptance 10/10 including
  unreadable→unavailable and observation-throw paths.
- No hitchhikers on BL-1113 surfaces.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix`, commit =
this evidence commit (BL-536 / BL-806).

By architect.
