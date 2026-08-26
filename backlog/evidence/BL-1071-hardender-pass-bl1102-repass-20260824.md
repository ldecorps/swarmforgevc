# BL-1071 — hardener pass (BL-1102 spawn-failed re-pass), 2026-08-24
# (batch with BL-1114)

## Inbound

Merged architect `96f6a9d9c2` (on cleaner `257de9b81` / coder
`812b9a9808`) into `swarmforge-hardender`.

## Scope

`observe!` maps `:spawn-failed?` → `:unavailable` with `:error` (never
`:control-plane-missing`). Touches `control_plane_lib.bb`.

## Host / BL-149

`control_plane_lib.bb`: **skip-cooldown** (age ~1.6d). Host quiet. No
Stryker (babashka). Surgical this pass. Prior full Gherkin harden
(2026-08-23) soft-skipped clean (`total=0 skipped=10`, BL-460).

## BL-113 Gherkin (soft)

Stamp skip confirms prior 10/10 kill; re-pass behaviour covered by surgical
+ unit.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| Never forward `:spawn-failed?` | killed |
| Drop spawn-failed branch (always classify) | killed |
| Classify spawn-failed as `:control-plane-missing` | killed |
| Blank output → empty `:error` | killed (after unit assert) |

Survivors: 0.

## Process fix this pass

Unit assert: blank spawn-failed output → exact `"tmux spawn failed"`.

## Verification

- Unit ok; acceptance 10/10

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix`.

By hardender.
