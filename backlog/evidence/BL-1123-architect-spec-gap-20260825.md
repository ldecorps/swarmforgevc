# BL-1123 — architect disposition: Spec Gap (missing feature on tip)

**Date:** 2026-08-25  
**Role:** architect  
**Tip reviewed:** `116114ade3` (cleaner rematch)  
**Handoff:** `00_20260825T101211Z_000761_from_cleaner_to_architect_for_architect.handoff`

## Verdict

**Spec Gap** — implementation + APS + unit/property on tip look sound, but
`specs/features/BL-1123-guard-master-checkout-against-bare-and-collapsed-tip.feature`
is **not in `116114ade3`**. Mint/normalize commits (`e0e8b08e1` / `398a1821d`) are
not ancestors of this tip. An untracked disk copy was present and removed so
judgment is tip-honest.

## Tip inventory

| Surface | On tip? |
|---------|---------|
| `master_checkout_integrity_{cli,lib}.bb` | yes |
| Unit + tip-floor property runners | yes (ALL PASS) |
| APS steps + index | yes |
| Feature file | **NO** |

## Invariants (once feature lands)

1. **Never leave core.bare=true** — unit encodes heal path (PASS).
2. **Tip below file-count floor refused** — property + unit (PASS).

## Required next

Coder/specifier: land feature on tip (checkout from mint `e0e8b08e1` or
normalize `398a1821d`), rematch cleaner → architect. Do not forward to hardender
until feature is in the tip commit.

## Hitchhike

Ancestry stacks BL-1118/695/etc. (BL-506). Forward (when armed) authorizes
BL-1123 paths only; hardener recreate on tip.
