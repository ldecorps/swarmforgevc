# A reset to origin/main destroyed five human approvals — 2026-08-30

Found by the specifier while draining mail. Two `reset: moving to origin/main`
entries in `git reflog main` discarded every local-only commit made since the
previous push. This is the `master_main_reconcile` sweep, re-armed by the
operator on 2026-08-29 (`cce70d985`).

## What was destroyed

| Orphaned commit | Content | Recovered as |
|---|---|---|
| `702192ac71` | BL-1303 ticket YAML + feature file (the whole spec) | `e794daad30` |
| `09b939d485` | **Human approval, BL-1299** | cherry-picked |
| `d0bb3edd60` | **Human approval, BL-1300** | cherry-picked |
| `54ca5e131a` | **Human approval, BL-1301** | cherry-picked |
| `709d8c2fdd` | **Human approval, BL-1302** | cherry-picked |
| `1d5cd1d0f5` | **Human approval, BL-1303** | cherry-picked |
| `ef9470ce47` | BL topic record, BL-1303 | cherry-picked |
| `ea46847253` | BL-1299 reverse-hop refusal evidence | cherry-picked |
| `1e9e355fca` | **Close BL-1297: move to done** | NOT recovered — coordinator's |
| `84c1553965`/`cd35031612` | BL-1297 topic record, `seq:2` done message | NOT recovered — pairs with the close |
| `572b2692cc` | no-/clear-below-75% intake drain | already on main by another path |

All five approvals were verified as **genuine human taps**, not night-sweep
artifacts: each carries the `Approve <id>: record human_approval` / `By coder.`
template that `commitApprovalDecision` writes only on a human Approve tap, never
the `night-shift auto-approve` / `By operator night-auto-approve-sweep.` pair.

Recovery used `cherry-pick -x` throughout; nothing was reset, rebased or forced.
Restored state is pushed (`a79069ddf9`), so a further sweep cannot re-eat it.

## Why this one is worse than the usual reset

An erased approval is **invisible**. The five tickets read `human_approval:
pending` afterwards — indistinguishable from never having been asked. Nothing
would have re-surfaced them to the human, and the next promotion gate would have
held all five as unapproved, silently costing five human decisions.

## Not re-minted

**BL-1288** (`type: defect`, `severity: high`, `human_approval: approved`,
`paused/`) already covers the cause: `rematch-with-push-first!` treats every
failed push as genuine divergence and discards the `:error` string that is the
only thing able to distinguish an unreachable remote from real divergence. Under
Article 3.2.4 it is expedited. It needs promotion, not another ticket.

## Left for the coordinator

BL-1297 is still in `backlog/active/` although QA landed and verified it
(`backlog/evidence/BL-1297-qa-pass-20260830.md`). Re-closing it is Article 1.1
bookkeeping, not the specifier's to do.
