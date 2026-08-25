# BL-1144 — architect pass — 20260825

**Tip:** cleaner `e6ad05e8be` (coder `4a86f69538` + cleaner `bb -e` fix)
**Handoff:** `00_20260825T204308Z_000863_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Cleaner tip stacks BL-1145 lineage; **0 deletes** vs `origin/main`.
Authorize **BL-1144 paths only** (publish lock/rematch lib + land script +
QA prompt + how-to + APS).

## Architecture

- Root cause: concurrent land/close publishers during long QA gates → push
  races and unbounded tip-purity bounce storms (rematch recovers but costly).
- Fix (locked pair): publish-time authoritative rematch (`publish-time-purity-action`,
  max 2 attempts) + land/close lock serialize (`land-close-publisher-admission`).
  Pure lib; `land_main_publish.sh` is impure wiring (`bb -e` decide-only).
- QA.prompt documents BL-1144 land discipline. Tip purity mandatory; no
  force-push; residual recovery stays rematch lander/bookkeeping.

## Verification

| Check | Result |
|-------|--------|
| `master_main_reconcile_lib_test_runner.bb` | ALL TESTS PASS |
| APS BL-1144 feature | 3/3 pass |
| `land_main_publish.sh --decide-only` | EDN decision (no REPL leak) |
| Tip deletes | 0 |

By architect.
