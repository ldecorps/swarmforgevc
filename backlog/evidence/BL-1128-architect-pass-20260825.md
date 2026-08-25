# BL-1128 — architect pass — 20260825

**Tip:** cleaner `798c6d630e` (1128-only rematch on `origin/main`)  
**Handoff:** `50_20260825T105016Z_000780_from_cleaner_to_architect_for_architect.handoff`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Tip purity

- `origin/main...HEAD` = **15 paths**, BL-1128-only
- Hitchhike gate CLEAN

## Inventory

| Surface | Status |
|---------|--------|
| Feature | on tip |
| APS + index | on tip |
| `headroom_cap_raise_{cli,lib}.bb` + promotion prefer | on tip |
| Unit (headroom + promotion_gates) | ALL PASS |
| Acceptance | **5/5** |
| how-to + conf | present |

## Architecture

Pure decide-raise / policy read; `apply-raise!` extracted; unhold + audit;
promotion_gates reuses `depth-cap-throttle-ticket?`. Cleaner DRY of prefer
predicate. Ticket has no `invariants:` block — acceptance scenarios encode
the contract (raise / block / unhold / prefer / ceiling+undo).

Hardener: recreate on tip; authorize BL-1128 paths only.
