# BL-601 — hardener tip-pure pass (acyclic rematch) — 20260827

## Inbound

Architect `e7aa38561d` (acyclic compactionCadence↔trend rematch). Tip-pure
harden on that tip (BL-506).

## Hardening

1. **Gherkin Outline pins** (`KNOWN_VALUES` / BL-908): `EXPECTED_BY_ROLE` locks
   role/model/ts/util_pct/input_tokens/tokens_at — soft mutation **12/12 killed**.
2. **Unit**: non-detectable role with existing records stays NA (locks the
   `detectableRoles.includes` gate).
3. **Surgical** `bl601_compaction_cadence_mutation_sweep.sh`: **5/5 killed**.

## Gates

| Gate | Result |
|---|---|
| Unit | **8/8** |
| Properties | **4/4** |
| Acceptance | **6/6** |
| Gherkin soft | **12/12 killed** |
| Surgical | **5/5 killed** |
| Cooldown | **run** (compactionCadence + store) |

## Tip purity

Handoff delta on architect tip: Outline pins + NA unit + surgical + this
evidence. No sibling hitchhikers.

## Forward

`git_handoff` to `documenter`, priority `00`, task `BL-601-acyclic-cycle-bounce`.

By hardender.
