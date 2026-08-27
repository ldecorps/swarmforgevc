# BL-1009 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `b7030ff643` (on coder `a4b9db88b8`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

One pipeline grid for all active tickets; caption swarm badges (`primary`→
`s1`, `second`→`s2`, else wire name) only when >1 distinct swarm is
visible; absent `swarm:` defaults to local via `readSwarmName`; remote
rows never show live held-by-role (forced not-started). `toFoldersSnapshot`
forwards `swarm`; bot tick passes `readBoardProjectRoot`. Cleaner: shared
`ticketMetaFromItem`.

## Architecture

- Matches approval: one grid (not two); caption badges (not matrix cells);
  no-badge mono-swarm parity; remote stage absent not guessed.
- Invariant 1: remote → strip held mark at `buildGridRows`.
- Invariant 2: badges on caption line only; grid column count unchanged
  (scenario 06 / properties).
- Invariant 3: mono-swarm → `captionsNeedSwarmBadges` false.
- Required wiring: `readSwarmName` in `conciergeTick.ts`; steps registered.

## Gates

| Gate | Result |
|---|---|
| Compile | green |
| Unit (`pipelineBoard.test.js`) | **134/134** |
| Properties | **12/12** |
| Acceptance (BL-1009) | **8/8** |
| Stamp-off (BL-1113) | **9/9** |
| Dep-gate | N/A for pass (standing telegram cycle is BL-759; parcel only threads `swarm` through snapshot) |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1009-one-unified-pipeline-grid-across-swarms`.

By architect.
