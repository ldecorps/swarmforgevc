# BL-1123 — hardener pass (1123-only rematch) — 2026-08-25

Architect tip: `fb092a052e` on cleaner rematch `c87e0ec27b` (1123-only on
`origin/main`). Recreated `swarmforge-hardender` on tip. BL-506: **BL-1123
paths only**.

## Gates

| Check | Result |
|---|---|
| Unit integrity lib | ALL PASS |
| Tip-floor property | ALL PASS |
| Acceptance | **3/3** |
| Gherkin soft | stamp retained (**4/4**; re-run skip-stamp, outcome pass) |
| Surgical lib mutants | **6/6 killed** |

### Surgical detail

1–3. `tip-floor-verdict` always-allowed / always-refused / invert  
4. nil tree-count → allow  
5. `default-tip-floor` 500 → 1  
6. skip `set-core-bare!` heal  

## CRAP / Stryker TS

N/A — Babashka parcel.

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-1123-guard-master-checkout-against-bare-and-collapsed-tip`, commit = this tip.

By hardener.
