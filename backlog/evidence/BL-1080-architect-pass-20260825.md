# BL-1080 — architect pass (after D1/D2 bounce) — 20260825

**Tip:** cleaner `5ae2890706` (coder rematch dual-literal + property)
**Prior bounce:** `69f9c3bd07` / `BL-1080-architect-bounce-20260825.md`
**Handoff:** `50_20260825T124552Z_000804_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE. D1 and D2 cleared.

## Scope / tip purity

`origin/main...5ae2890706` = **10 paths**, BL-1080-only. Hitchhike CLEAN.

## Bounce clearance

| Item | Status |
|------|--------|
| D1 APS expected >1 site after DRY | **CLEARED** — dual literal refusal lines restored; APS **3/3** |
| D2 invariants unencoded | **CLEARED** — `bl1080_cursor_seat_property_runner.bb` |

## Architecture

- Two refusal sites (validate_agent + launch `*)`) share identical how-to
  pointer text; property forbids collapsing into `refuse_unsupported_agent`
  so APS site-count stays meaningful (feature/BL-1018 family shape).
- Pack + how-to Cursor vs `/pilot` vs Claude present. Dep-gate N/A.

## Invariants — encoded, green

Property: ≥2 literal sites each naming how-to; how-to names Cursor/`/pilot`/Claude.
`bl1080_cursor_seat_property: ALL PROPERTIES HOLD`.
Coordinator provider configurable script → ALL PASS.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1080-a-pack-can-name-cursor-on-a-window-line`, commit = this tip.
Authorize BL-1080 paths only.

By architect.
