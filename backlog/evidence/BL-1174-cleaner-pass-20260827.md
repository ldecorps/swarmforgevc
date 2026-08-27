# BL-1174 cleaner pass — 2026-08-27

## Inbound

Cherry-picked coder `7995fe5e05` tip-pure (17 paths). Added
`specs/features/BL-1174-deprecate-operator-verbs-scan-docs.feature` from
`main` for acceptance.

## Checks run

1. **Compile** — PASS.
2. **Vitest unit** — `deprecate.test.js` + telegram verb tests: 78/78 PASS.
3. **Property** — `deprecate.property.test.js`: 4/4 PASS.
4. **Gherkin acceptance** — BL-1174 feature: 5/5 pass.

## Cleanup performed

NONE. Soft-verb modules under `extension/src/tools/deprecate/` are cohesive;
wiring into telegram operator cores is minimal.

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1174-deprecate-operator-verbs-scan-docs`.

By cleaner.
