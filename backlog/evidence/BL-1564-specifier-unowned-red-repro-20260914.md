# BL-1564 specifier repro of QA's unowned-red note, 2026-09-14 (bl1297)

- **Trigger**: QA note 2026-09-14 11:51Z from the BL-1555 parcel
  ("BL-1555 unowned-red bl1297MergeOwnPathsInvariants: 20s timeout,
  full-lane only"), evidence
  `backlog/evidence/BL-1555-qa-unowned-red-bl1297-20260914.md` at
  `c859adced9` on `swarmforge-QA`: on the merged tree `006c8a3eed`,
  `npm run test:properties` was 403/404 green with
  `test/bl1297MergeOwnPathsInvariants.property.test.js > property
  (invariant 3)` failing `Test timed out in 20000ms`; alone it passed,
  20.59 s for the file and 8.67 s for invariant 3. Not touched by the
  BL-1555 diff. No owner in `backlog/` or `standing-reds.tsv`; BL-1447's
  adjudication (2026-09-07) and BL-1464 covered BL-1297's ACCEPTANCE
  feature scenario 03, a different lane and file.
- **Tree**: `main` at `67890beb06`, host load 1.9 of 20 cores.

## Measured alone with a counting bb shim

```
cd extension
BL1297_COUNT=$COUNT PATH=$SHIM:$PATH npx vitest run --config vitest.properties.config.mjs test/bl1297MergeOwnPathsInvariants.property.test.js
```

| test | duration | bb processes |
|---|---|---|
| invariant 1 | 5889 ms | 42 (21 cases x 2 semantics) |
| invariant 2 | 5310 ms | 38 (18 cases x 2 + 2 unreadable) |
| invariant 3 | 7648 ms | 18 (10 constructed + 8 draws, `threeCallers` once each) |
| file | 18847 ms | **98** |

Green alone at 1.9 load, 1.35 s under the budget for invariant 3 and
0.42 s per case; QA's lane run needed more than 1.1 s per case. Every
process is `spawnSync('bb', ['-e', script])` with the script
`load-file`-ing `task_scope_gate_lib.bb` (517 lines) and, for invariant
3, `land_step_lib.bb` (2118) and `unregistered_test_gate_lib.bb` (236)
as well - the library load is repeated 98 times per run and is the cost;
the repositories themselves are five commits each.

## Disposition

Minted BL-1564 (`type: defect`, `severity: high`, standing-red rule
2026-09-05), register row lane `property` first_seen 2026-09-14, the
class of BL-1556 (bl1272, one bb process per draw). QA's BL-1555 parcel
is told the row exists so its Article 4.2 hold can clear.

By specifier.
