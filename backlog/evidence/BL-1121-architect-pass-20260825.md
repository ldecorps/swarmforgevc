# BL-1121 — architect pass — 20260825

**Tip:** cleaner `b49b83eec6` (coder `622275440` + shared `incoming_merge_parent_lib`)
**Handoff:** `50_20260825T125440Z_000806_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

`origin/main...b49b83eec6` = **14 paths**, BL-1121-only. Hitchhike CLEAN.
Shared lib extracted from pipeline-on-main + property-suite guards is in-scope
(same MERGE_HEAD / lone-GITHEAD_ contract).

## Architecture

- Standing skip is `skip-reconcile-import` when mid-merge and every suite
  trigger path is byte-identical to the incoming parent — not the env
  override.
- `resolve_incoming_merge_parent` lives in `incoming_merge_parent_lib.sh`
  shared with `check_pipeline_code_on_main.sh` (no forked contract).
- Ordinary extension/src stages still print `property-suite-guard: run`.
- Dep-gate N/A (shell parcel).

## Invariants (2) — encoded, green

| # | Encoding | Verified |
|---|---|---|
| 1 | Env override stays recovery-only; standing skip is skip-reconcile-import | property HOLD |
| 2 | Non-reconcile extension/src still runs the suite | property HOLD |

`bl1121_reconcile_import_property: ALL PROPERTIES HOLD`  
`test_property_suite_drift_guard.sh` → ALL PASS (01–10)  
APS → **3/3**

## Findings

NONE. (Cleaner note: pre-existing `test_pipeline_code_on_main_guard.sh`
BL-925 grep noise on `origin/main` is out of parcel.)

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1121-reconcile-import-skips-property-suite-guard`, commit = this tip.
Authorize BL-1121 paths only.

By architect.
