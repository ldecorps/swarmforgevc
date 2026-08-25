# BL-1123 — architect pass (Article 4.4)

**Date:** 2026-08-25  
**Role:** architect  
**Tip base:** cleaner `116114ade3` (+ Spec Gap evidence `431fc1731a`)  
**Arm:** acceptance feature from main `0d693294a` via path checkout (coordinator
asked merge-main; full merge previously flipped this worktree onto main with a
destructive index — armed by path only, no remint).

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Inventory

| Surface | Status |
|---------|--------|
| `master_checkout_integrity_{cli,lib}.bb` | on tip |
| Unit runner | ALL PASS |
| Tip-floor property | ALL PASS |
| APS steps + index | on tip |
| Feature file | **on tip** (armed) |
| Acceptance | **3/3** |

## Declared invariants

1. **Never leave core.bare=true** — unit heal path + acceptance scenario 01.
2. **Tip below file-count floor refused** — property + unit + acceptance outline.

Architecture: pure `tip-floor-verdict` / `evaluate-tip-move`; `heal-bare-if-needed!`;
combined `run-master-checkout-integrity!`. CLI exit simplified by cleaner.

## Hitchhike / BL-506

Ancestry stacks BL-1118/695/etc. Forward authorizes **BL-1123 paths only**.
Hardener: recreate on tip (`checkout -B`), do not mash stacks.
