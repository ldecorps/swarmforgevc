# BL-1132 hardener pass — 20260825

**Architect tip:** `793347defd`
**Task:** `BL-1132-headroom-raise-telemetry-path-and-coordinator-duty`

## Product surface

`headroom_cap_raise_lib.bb`: `format-chaser-year-month` via
`(DateTimeFormatter/ofPattern …)` + injectable `telemetry-path`;
coordinator.prompt names `headroom_cap_raise_cli raise`. Babashka — no
Stryker/CRAP/DRY (degraded fallback). Authorize **BL-1132 paths only**.

## Gates

| Gate | Result |
|------|--------|
| `headroom_cap_raise_lib_test_runner.bb` | ALL CHECKS PASSED |
| `bl1132HeadroomRaiseTelemetryInvariants.property.test.js` | 3/3 |
| APS `BL-1132-headroom-raise-telemetry-path-and-coordinator-duty.feature` | 3/3 |
| Soft Gherkin | `outcome: inapplicable` (no Outline) — not a pass |
| Standing step guards (tmuxReaper / bl968 / bl643) | green |

## Soft Gherkin → surgical (BL-638)

| Mutant | Verdict |
|--------|---------|
| bare-ofPattern-interop (pre-BL-1132 throw) | killed |
| format-empty-string | killed |
| format-wrong-pattern | killed |
| ignore-ym-str | killed |
| arity1-hardcode-bad | killed |
| drop-env-override (`SWARMFORGE_HEADROOM_TELEMETRY_PATH`) | **equivalent** — env unset in every test/APS fixture (repo grep 2026-08-25); with unset env both forms resolve the constructed path. JVM has no `System/setenv` to lock the seam in-process without a child. Not forced trivia. |

`mutants: killed=5 survived=0 skipped=0` (1 accepted equivalent).

## Forward

`git_handoff` to `documenter`, priority `00`, same task name.
Authorize BL-1132 paths only.

By hardender.
