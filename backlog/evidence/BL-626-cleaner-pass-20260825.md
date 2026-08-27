# BL-626 cleaner pass — 2026-08-25

## Inbound

Coder tip `59811fbfb1` ancestry vs `origin/main` was hitchhiked (INTAKE /
done/M8 / acpHostClient / hotfix-ledger / …). Tip commit surface alone is
BL-626-only (7 paths).

Cleaner recreated `swarmforge-cleaner` on `origin/main` and cherry-picked
`59811fbfb1` (hitchhike-free rematch tip `ea14fa303`). Did **not** merge
the dirty tip ancestry.

Hitchhike gate:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN.

## Checks run

1. **Unit** — `bb swarmforge/scripts/test/promotion_gates_lib_test_runner.bb`:
   ALL PASS.
2. **Property** —
   `bb swarmforge/scripts/test/bl626_acceptance_executable_property_runner.bb`:
   200 runs; ALL PROPERTIES HOLD.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-626-promotion-gate-rejects-unmaterialized-feature-draft.feature`:
   7/7 pass.

## Cleanup performed

- `promotion_gates_lib.bb`: extract `acceptance-refusal` /
  `missing-feature-refusal` so `acceptance-executable-refusal` stays
  CC-bounded and does not repeat the gate map literal.
- `bl626PromotionGateSteps.js`: shared `writeRel` / `runGatesCli` /
  `withCleanup` helpers; no behavior change.
- `bl626_acceptance_executable_property_runner.bb`: unjam the shape/`swap!`
  line, use the seeded LCG `pick` for post-floor shapes, extract
  `assert-shape!` / `eval-opts`.

## Findings beyond that

NONE. Shell `is_buildable` preference filter still mirrors the authoritative
bb gate for draft/dangling pointers (ranking only); chokepoint remains
`promotion_gates_cli.bb`.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-626-promotion-gate-rejects-unmaterialized-feature-draft`.

By cleaner.
