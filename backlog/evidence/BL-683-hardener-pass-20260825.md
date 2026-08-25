# BL-683 — hardener pass — 2026-08-25

Architect tip: `0335498da1`. Recreated `swarmforge-hardender` on tip.
Authorize **BL-683 paths** only. Product counter already on main (BL-808);
this hop hardens APS + property arming.

## Gates

| Check | Result |
|---|---|
| Acceptance | **3/3** |
| `bl683_backlog_folder_count_property_runner.bb` | **ALL PROPERTIES HOLD** |
| Surgical | **killed** — strip `.yaml` filter from `count-active-tickets` (acceptance 0/3 + property FAIL) |
| Soft Gherkin | N/A for further progress this hop (plain scenarios + outline-free APS); hand surgical covers the yaml-vs-entry invariant |
| CRAP / Stryker TS | N/A — bb APS only |

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-683-handoff-depth-warning-counts-non-tickets`, commit = this tip.

By hardener.
