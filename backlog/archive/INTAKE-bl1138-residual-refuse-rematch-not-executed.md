# Raw intake — BL-1138 residual: refuse-rematch still waits for Cursor instead of rematching

Status: **soft-mint as BL-1141** (human via Cursor 2026-08-25 ~18:08 BST).
Specifier: fill/confirm acceptance feature; do not remint.

## Why this is in front of you

BL-1138 closed the `rematch-bookkeeping` / `:replay-bookkeeping` path by
executing `git reset --hard origin/main` in
`handoffd.bb::master-main-reconcile-merge!`. Same evening, live master sync
again blocked coordinator / Process B on **`refuse-rematch`**:

```json
{"ahead":12,"behind":3,"ready":false,"action":"wait-reconcile",
 "reconcile":{"surfaced":"refuse-rematch","ticks":13,"escalated":false},
 "deadlock":{}}
```

`handoffd` maps `:refuse-rematch` to a hard failure that only surfaces —

```clojure
:refuse-rematch
{:success false :error "refuse-rematch" :outcome :refuse-rematch}
```

— and `post_hotfix_merge_origin_lib.bb` likewise prints refuse and exits 1
without rematching. Human Cursor had to `git merge origin/main` (this
episode the join was clean under ort) to restore `behind=0` / `proceed`.

So rematch-owner recovery is still incomplete: **`refuse-rematch` is named
as designed recovery but not executed on the live absorb path.**

## Goal

1. Soft-mint **BL-1141** — residual of BL-1138 / BL-1135 / BL-1130:
   when absorb-dispatch chooses `:refuse-rematch`, live recovery must drive
   rematch (or an equivalent automatic rematch onto `origin/main`) to
   `behind=0` without Cursor Completing origin/main merge.
2. After successful recovery, clear reconcile surfaced state;
   `main_sync_status_cli` returns `proceed` | `ff-only`, not standing
   `wait-reconcile` / `refuse-rematch`.
3. Preserve BL-1130 (no editor `MERGE_HEAD`) and BL-1120 (do not abort a
   foreign `MERGE_HEAD` this tick did not start).
4. Optional honesty: if foresight `:would-conflict?` refuses a join that
   plain `git merge --no-edit origin/main` would complete cleanly, fix the
   foresight or retry path so false refuse-rematch does not stick.

## Locked human decisions

1. **Priority 0 / queue-jump / approved** — same class of freeze as BL-1138;
   human asked Cursor to rematch now and file the defect so it is automated.
2. Residual of BL-1138 — do not reopen BL-1138; new id.
3. Designed recovery remains rematch lander / rematch bookkeeping owner —
   never "page human to Complete origin/main merge" as standing path.
4. Tonight's one-shot merge/rematch is **ops**, not this ticket's acceptance.

## Related

- done / in-flight BL-1138 (replay-bookkeeping execute)
- BL-1135, BL-1131, BL-1130, BL-891
- Live evidence: `refuse-rematch` ticks≥13; Cursor rematch 2026-08-25 ~18:08 BST
