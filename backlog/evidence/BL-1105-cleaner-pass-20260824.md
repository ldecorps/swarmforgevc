# BL-1105 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `4eabe0b9aa` (duplicate ticket id refused at mint in
specifier hygiene gate; local + published corpora; fail-closed) into
`swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 4eabe0b9aa HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/backlog_hygiene_lib_test_runner.bb`:
   all passed (including BL-1105 duplicate-id / fail-closed cases).
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1105-a-duplicate-ticket-id-is-refused-at-mint.feature`:
   8/8 pass.

## Cleanup performed

- `bl1105DuplicateTicketIdSteps.js`: extracted `gateEnv` so both gate-run
  steps share one BACKLOG_HYGIENE_* seam setup.

## Findings beyond that

NONE. Id-field keying, pool coverage, published-corpus seam, and epic/milestone
coexistence unchanged. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1105-a-duplicate-ticket-id-is-refused-at-mint`.

By cleaner.
