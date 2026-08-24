# BL-1105 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `c6de99505e` (on coder `4eabe0b9aa`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

Corpus-level duplicate-id refusal in the existing specifier hygiene gate:
local pools + published `origin/main` (seam for fixtures), keyed on `id:`,
fail-closed on unreadable corpora; epic/milestone checks still compose.
Cleaner: shared `gateEnv` in acceptance steps.

## Architecture

- Matches approval: published-corpus half included; stale ref fails safe
  (miss, never invent).
- Pure `duplicate-id-violations` over subjects + indexes; git/dir IO behind
  thin seams (`BACKLOG_HYGIENE_*`) — CLI `main` stays a dispatcher.
- Invariant 1: gate reports only (no rename/move/rewrite).
- Invariant 2: local/published errors surface as fail-closed kinds, never
  empty-corpus success.
- No new call site / `required_wiring`; arms at the mint gate already in
  the specifier prompt.

## Gates

| Gate | Result |
|---|---|
| Unit (`backlog_hygiene_lib_test_runner.bb`) | all passed |
| Acceptance (BL-1105 feature) | **8/8** |
| Stamp-off (BL-1113) | **9/9** |
| Dep-gate | N/A (babashka/APS; no `extension/src` production) |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1105-a-duplicate-ticket-id-is-refused-at-mint`.

By architect.
