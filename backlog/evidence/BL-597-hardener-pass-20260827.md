# BL-597 — hardener tip-pure pass (invariant rematch) — 20260827

## Inbound

Architect `1977b9f040` / tip-pure cleaner `cecf0d1c80` after invariant-unencoded
bounce. Tip-pure harden on `cecf0d1c80` (BL-506).

## Hardening

1. Outline `EXPECTED_BY_ACTION` pins for subject/reason/type (BL-908) — soft
   Gherkin **20/20 killed** (was 10 survivors).
2. Unit: out-of-window events excluded; reason retained on read.
3. Surgical `bl597_self_heal_mutation_sweep.sh`: **4/4 killed**.

## Gates

| Gate | Result |
|---|---|
| Unit | **2/2** |
| Properties | **7/7** |
| bb lib runner | **ALL PASS** |
| Acceptance | **8/8** |
| Gherkin soft | **20/20 killed** |
| Surgical | **4/4 killed** |
| Cooldown | **run** (`selfHealTelemetry.ts`) |

## Tip purity

Handoff delta on cleaner tip: Outline pins + unit locks + surgical + this
evidence only.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-597-invariant-unencoded-bounce`.

By hardender.
