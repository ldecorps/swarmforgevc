# BL-601 — cleaner pass (acyclic rework) — 20260827

## Inbound

Tip-pure cherry-pick of coder `2f777fc11` + `1228838bc3`, then `-s ours`
merge of received tip `1228838bc3` for lineage (no coder hitchhikers).

Architect bounce `88c606593c`: `trend.ts` re-export of
`trendForCompactionCadencePerHour` while `compactionCadence` imports
`computeTrend` — forbidden acyclic pair.

## Checks run

1. **Compile** — PASS.
2. **Vitest unit** — `compactionCadence.test.js`: 7/7 PASS (incl. acyclic lock).
3. **DRY (jscpd)** — 0 clones on compactionCadence / store / trend.
4. **Dep-gate** (scoped `compactionCadence.ts` + `trend.ts`) —
   compactionCadence↔trend cycle **gone**. Remaining failures are
   `humanDecisionLatency`↔trend/stageDwell (**BL-600**, out of parcel).
5. **Mutation-site count** — `compactionCadence.ts` 107 (`over`, soft);
   store 43 / trend 33 (`within`). Left cohesive — split would not improve SoC.

## Cleanup performed

NONE beyond tip-pure integrate of coder rework (cycle already fixed upstream;
no further DRY/structure cuts).

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task `BL-601-acyclic-cycle-bounce`.

By cleaner.
