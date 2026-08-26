# BL-1123 — hardener pass — 2026-08-25

Architect tip: `39e10b773d` (recreated `swarmforge-hardender`).

## Scope

- `swarmforge/scripts/master_checkout_integrity_lib.bb` (+ CLI)
- Unit: nil-count refuse + default tip-floor
- APS: exact Examples prose for size/verdict
- Feature soft Gherkin stamp

## Gates

| Check | Result |
|---|---|
| Unit | ALL PASS |
| Tip-floor property | ALL PASS |
| Acceptance | **3/3** |
| Surgical | nil-count / default-floor / bare-never-heal killed (floor body skip on format) |
| Gherkin soft | **4/4 killed**, stamped |
| CRAP / Stryker TS | N/A (Babashka) |

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-1123-guard-master-checkout-against-bare-and-collapsed-tip`.
BL-1123 paths only (stacked hitchhike ancestry).

By hardener.
