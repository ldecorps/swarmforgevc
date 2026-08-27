# BL-1173 cleaner pass — 2026-08-27

## Inbound

Cherry-picked coder `062f2a4825` tip-pure (6 paths). Conflict in
`specs/pipeline/steps/index.js` resolved without BL-1169 hitchhiker require.
Added `specs/features/BL-1173-deprecator-freshness-gate-cli.feature` from
`main` for acceptance.

## Checks run

1. **Compile** — `npm run compile` in `extension/`: PASS.
2. **Vitest unit** — `test/deprecateCheck.test.js`: 7/7 PASS.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1173-deprecator-freshness-gate-cli.feature`:
   5/5 pass.
4. **Shell syntax** — `bash -n promote_and_route_next.sh`: OK.

## Cleanup performed

NONE. CLI, promote wiring, and steps are cohesive.

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1173-deprecator-freshness-gate-cli`.

By cleaner.
