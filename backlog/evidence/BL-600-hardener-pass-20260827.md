# BL-600 — hardener tip-pure pass (acyclic rematch) — 20260827

## Inbound

Cleaner `7d8b0e7a08` (acyclic humanDecisionLatency↔trend rematch via coder
`7e6124ec5a`). Tip-pure harden on that tip (BL-506).

## Hardening

1. **Gherkin Outline pins** (`KNOWN_VALUES` / BL-908): ticket→gate/ask_ts/
   verdict_ts/latency_ms locks — soft initially **6/10** (ticket+gate case
   survivors); after pins **10/10 killed**.
2. **Surgical** `bl600_human_decision_latency_mutation_sweep.sh`: **5/5
   killed** (0 survived, 0 skipped).

## Gates

| Gate | Result |
|---|---|
| Compile | **PASS** |
| Unit `humanDecisionLatency.test.js` | **6/6** |
| Properties | **3/3** |
| Acceptance | **5/5** |
| Gherkin soft (post-pin) | **10/10 killed** |
| Surgical | **5/5 killed** |
| Cooldown `humanDecisionLatency.ts` | **run** |

## Tip purity

Handoff delta on cleaner tip: Outline pins + surgical sweep + this evidence.
No sibling hitchhikers.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-600-acyclic-cycle-bounce`.

By hardender.
