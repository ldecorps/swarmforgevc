# BL-781 — architect pass — 20260827

**Tip:** tip-pure `5ab769107` + rematch `85c2de2816` + `23aa89ba7b` → architect `8da797377`
**Handoffs:** `001221` (git) then `001222` (note: rematch excludes `extension/test/`)

## Verdict

**Pass** — forward to QA (cleaner/hardender/documenter skipped per ticket). Inventory NONE.

Earlier bounce `6b5bfa3a1` / handoff `001036` is **superseded** by coder rematch
`23aa89ba7b` (same D1 class; filter now covers `extension/test/`).

## Scope / tip purity

BL-781 paths only: delete dead wake-runtime (`babysitter_{lib,assess,enqueue_wake}`
+ lib test runner), trim BL-611 allowlist, live-grep filter + APS/property encoding.

## Architecture

- Deletion, not revival — matches ticket shape.
- Salvaged `*_lib` / nudge_resident untouched on disk.
- Live-grep filter excludes history/docs/steps/scripts-test/features/**and**
  `extension/test/` so retirement prose and property fixtures do not self-fail
  scenario 07. Product paths under `swarmforge/scripts/` remain live offenders.

## Invariants

Property suite asserts: features non-live; product scripts live; allowlist omits
deleted wake paths; salvaged libs present (5/5).

## Verification

| Check | Result |
|-------|--------|
| unit `bl781LiveGrepOffender.test.js` | 3/3 |
| property `bl781LiveGrepOffender.property.test.js` | 5/5 |
| APS BL-781 feature | **13/13** |
| Dead paths absent / salvaged present | OK |

By architect.
