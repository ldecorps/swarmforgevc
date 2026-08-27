# BL-1166 — architect bounce — cleaner f4b60a6e03 — 20260827

**Received:** `merge_and_process cleaner f4b60a6e03` (handoff
`00_20260827T123239Z_000006_from_cleaner_to_architect`)
**Reviewed:** cleaner `f4b60a6e03` (coder rematch `fe64126a36`) → architect merge
**Task:** BL-1166-bubble-authored-docs-index-and-first-pages

## Verdict

**Bounce → coder.** Extension architecture / dep-gate / read-only wiring OK.
APS regressed — acceptance step handler lost two prior fixes.

## Architecture (not bounce items)

| Check | Result |
|-------|--------|
| Dependency gate | **PASSED** on `operatorDocsCore`, `operatorDocsHtml`, `letsTalkRoutes` |
| required_wiring | `operatorDocs` in `letsTalkRoutes.ts`; index from `docs/index.md` via core |
| Read-only invariant | GET-only route enumeration + property test present |
| Divio taxonomy | `parseDocsIndexSections` uses `DIVIO_MODES` — no rival taxonomy |

## Inventory

### D1 — `acceptance` (blame: coder)

**Repro (with env, 5/7):**
```
specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1166-bubble-authored-docs-index-and-first-pages.feature
```
→ scenarios 03/04 fail at `headings and paragraphs are legible at a phone viewport
width`: `ctx.bl1166Html` is **undefined** because only scenario 01 runs
"the Operator docs remote page is opened from the Bubble pager".

**Regression:** QA bounce pass 2 (`BL-1166-qa-bounce-20260827-2.md`) required
loading shell HTML in that step (or Background). Cleaner merge `f4b60a6e03`
reverted the rematch fix.

**Remediation:** In `bl1166OperatorDocsSteps.js`, ensure
`headings and paragraphs are legible at a phone viewport width` sets
`ctx.bl1166Html` via `operatorDocsHtml.getOperatorDocsUiHtml()` when unset;
assert `ctx.bl1166LatestPageBody.html` exists. Re-run APS **7/7**.

### D2 — `acceptance` (blame: coder)

**Repro (without `CURSOR_API_KEY`, 3/7):**
Same APS command with `env -u CURSOR_API_KEY` → bridge-backed scenarios fail:
`CURSOR_API_KEY is not set for the headless bridge`.

**Regression:** Architect pass `ab6a5758c` / coder rematch APS bounce added
disposable `CURSOR_API_KEY=test-key` stub in `withBridge` (BL-915 posture).
Cleaner merge removed it.

**Remediation:** Restore stub around `startBridge` in `withBridge` (save/restore
env). APS must pass **7/7** without sourcing `.swarmforge/swarm.env`.

## Surfaced (not bounce)

Merge hitchhikers: backlog INTAKE files, BL-832 comment in `bridgeServer.ts`,
briefings bulk, trend/telegram edits, many paused ticket YAML moves — QA
staging (BL-506) only; not architecture defects in the Operator docs slice.

By architect.
