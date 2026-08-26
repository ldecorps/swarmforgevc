# BL-1031 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `8ad9e36125` (on coder `b03e1263bb`) into
`swarmforge-architect`. Merged cleanly; ancestry confirmed.

## Scope

Empty the BL-1022 spawn-reachable banned-API ratchet by routing all seven
call sites in `handoff_inject_lib`, `pre_qa_gate_gather_lib`, and
`salvage_lib` through `daemon-cycle-guard-lib/sh!`. Acceptance-contract
path: wait-bound (exit 124) fails CLOSED with a named finding (approval
ruling **b**). Cleaner shares `wait-bound-hit-result?`.

## Architecture

- Matches approval: bound the two APS tools; wait-bound ≠ silent fail-open.
- Invariant 1 by construction once ratchet is empty (`[]` in guard runner).
- Invariant 2: `:dir` / opts preserved on salvage and gather sites.
- Invariant 3: wait-bound named at gather + `evaluate` finding branch.
- No webview/host/secrets; stamp-off tip hygiene OK (`27273f2b0a`,
  BL-1113 9/9).

## Required hard gate

No `extension/src` production files. Dep-gate N/A (babashka/APS only).

## Invariants review (BL-633/BL-654) — 3 declared, encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Spawn-reachable calls under chokepoint | feature + ratchet empty | Green |
| 2 | Options/result contract preserved | feature + unit | Green |
| 3 | Wait-bound named, not absorbed | feature + acceptance_contract tests | Green |

## Property-testing support (undeclared)

No new pure TS module. Declared behaviour covered by APS + babashka
runners. No additional undeclared property authored.

## Correctness read-through

- Guard ALL PASS (`spawn-only banned-API debt: []`).
- Acceptance-contract lib ALL PASS; feature 7/7.
- No prior BL-1031 bounce evidence.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1031-bounded-chokepoint-covers-the-spawn-reachable-subtree`, commit =
this evidence commit (BL-536 / BL-806).

By architect.
