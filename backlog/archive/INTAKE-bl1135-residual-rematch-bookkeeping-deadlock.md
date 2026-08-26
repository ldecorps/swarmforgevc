# Disposition (specifier 2026-08-25T16:03Z)

**Outcome:** soft-mint was BL-1138; specifier filled feature + forwarded coder.

---

# Raw intake — BL-1135 residual: rematch-bookkeeping deadlock still freezes coordinator closes

Status: **soft-minted as BL-1138** (human via Cursor 2026-08-25 ~16:56 BST).
Specifier: fill/confirm acceptance feature; do not remint.

## Why this is in front of you

BL-1135 closed today claiming live lands must reach `behind=0` without
Operator/Cursor completing an absorb merge. Measured **same evening** after
that close:

```json
{"ahead":249,"behind":38,"ready":false,"action":"deadlock-tripped",
 "reconcile":{"surfaced":"rematch-bookkeeping","ticks":129},
 "deadlock":{"active":true,"reason":"rematch-bookkeeping",
   "tripped_at":"2026-08-25T15:27:08.409317009Z"}}
```

Coordinator on **BL-568** (QA tip `db574e4a40` on `origin/main`, not on
local HEAD) correctly refuses close/`ready_for_next`:

> Not idle – BL-568 still deadlock-tripped (behind=38). Did not run ready_for_next.

`behind` keeps growing (19 → 27 → 38) while local bookkeeping tip stays
ahead ~249. Human join is again the only recovery — the exact residual
BL-1135 was supposed to end.

## Goal

1. Ticket **BL-1138** (already soft-minted, prioritized) — residual of
   BL-1135 / BL-1131: **`rematch-bookkeeping` must not leave standing
   `deadlock-tripped` that freezes coordinator bookkeep until a human
   rematches main.**
2. Spec live recovery: when reconcile surfaces `rematch-bookkeeping`, the
   bookkeeping owner (or land path) rematches / replays so master reaches
   `behind=0` / `proceed` without Cursor `git merge` / Complete-origin/main.
3. Spec deadlock clear: after successful rematch/replay,
   `main-sync-deadlock.json` clears and `main_sync_status_cli` returns
   ready/proceed (or ff-only), not stuck `deadlock-tripped`.
4. Preserve BL-1130 (no MERGE_HEAD left for an editor) and BL-1120 (no
   abort of foreign MERGE_HEAD).

## Locked human decisions

1. **Priority 0 / queue-jump / approved** — this blocks every close while
   lands advance origin; promote ahead of ordinary active work.
2. Residual of BL-1135 — do not reopen BL-1135; new id.
3. Designed recovery remains rematch lander / rematch bookkeeping owner —
   never "page human to Complete origin/main merge" as standing path.
4. One-shot ops rematch of today's 249/38 tip is **ops**, not this ticket's
   acceptance (ticket must stop recurrence).

## Related

- Live: BL-568 parcel `001259` in_process; NOTE-BL-568-bookkeep-blocked-…
- BL-1135 / BL-1131 / BL-1130 / BL-1120 / BL-891 (done)
- `.swarmforge/daemon/main-sync-deadlock.json`
