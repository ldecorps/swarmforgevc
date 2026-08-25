# BL-1134 — architect pass — 20260825

**Tip:** cleaner `ceda945b23` (coder `d810135e5e` / `357e9cf5e`)
**Handoff:** `00_20260825T133141Z_000814_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

`origin/main...ceda945b23` = **8 paths**, BL-1134-only. Hitchhike CLEAN.

## Architecture

- Mute widened in `master_checkout_drift_lib.bb`: `commit-in-flight?` =
  `.git/index.lock` OR live `git add`/`git commit` argv mentioning this root
  (pure `git-add-or-commit-argv-for-root?` + `should-alarm-on-result?`).
- Process argv snapshot via shared `process_table_lib` (no one-off `ps`).
- Read-only check path unchanged; mute not sticky; no ancestry-as-primary mute.
- Extension/webview untouched. Dep-gate on APS step + `index.js`: PASSED
  (absolute paths). Co-change: expected APS/lib coupling with BL-1122 sibling;
  no new structural concern.

## Invariants (4) — encoded, green, non-vacuous

| # | Encoding | Verified |
|---|---|---|
| 1 | Durable staged + no in-flight still alarms (BL-839) | HOLD |
| 2 | In-flight detection read-only (lock/argv; no `.git` writes) | HOLD |
| 3 | Mute clears → same staged shape alarms again | HOLD |
| 4 | Primary mute is observable in-flight, not ancestry | HOLD |

`bl1134_post_add_mute_property: ALL PROPERTIES HOLD` (vacuity probe: forcing
`should-alarm-on-result?` → false yields zero alarms → I1 would fail).
Lib unit ALL PASSED; APS **6/6**.

## Property support (undeclared)

No additional undeclared properties on touched pure modules — declared I1–I4
already cover alarm/mute/read-only/argv classification.

## Prior bounce (main)

None for BL-1134 (`main` ahead of `origin/main`; no bounce evidence).

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1134-master-checkout-drift-mute-covers-post-add-window`, commit = this tip.
Authorize BL-1134 paths only.

By architect.
