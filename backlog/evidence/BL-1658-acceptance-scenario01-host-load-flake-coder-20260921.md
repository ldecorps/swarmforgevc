# BL-1658 — acceptance scenario 01 host-load flake observed post-merge, coder, 2026-09-21

## What happened

Re-running `node specs/pipeline/cli.js` on this ticket's own feature
after merging origin/main (host load average 17-18, up from ~13-16
earlier in this shift) surfaced 4 new failures, all in scenario 01
("a named handler required alone... costs under the per-handler
budget"), all naming the same four handlers:
`bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js` (593-790ms),
`bl674EpicDrilldownUiSteps.js` (589-743ms),
`bl686EpicDrilldownSlugMatchSteps.js` (589-711ms),
`bl687EpicReorderIncludesActiveChildrenSteps.js` (570-654ms) - all over
the 400ms budget even confirmed alone (best-of-3).

## Not caused by this parcel

`git log -1` on all four files: last touched by `eae448e6c9` (this
ticket's OWN first pass, hours earlier this shift) and `91382b2c7a`
(the sibling seat's D1/D2 bounce fix for BL-687 scenario 06) -
neither commit is in this parcel's own diff (the fourteen-handler QA
bounce fix, `3657cf8f2a`). Reproduced on three separate runs of the
unmodified acceptance CLI, always naming the same four files, host load
17.3-18.4 throughout.

## Mechanism (documented in this same file's own comment)

These four are among the seven original jsdom handlers whose OWN
`bridgeServer.js` import (unchanged by this ticket, present since before
BL-1658 existed) transitively reaches `cursorBridgeAgentSession` via
`letsTalkCore`/`telegramCursorBridgeLive` - `HEAVY_MODULE_CHECK`'s own
comment names this exact fact ("bridgeServer's OWN pre-existing
dependency graph... for reasons that have nothing to do with jsdom or
this parcel"). Scenario 01 measures each Example row in total isolation
(`censusOneHandler`, a fresh child process per handler) rather than the
unit-lane guard's sequential amortized reading
(`stepHandlerModuleLoadBudget.test.js`'s own comment: "a handler with
its own genuinely heavy, unrelated dependency... can read anywhere from
~140ms to 470ms+... purely from host scheduling contention" - today's
extreme load pushed that ceiling higher still, 580-790ms).

## The fourteen handlers this parcel's own bounce fix touches are unaffected

Every one of the fourteen files this parcel migrates passed scenario 01
and 03 cleanly across the same runs (only the four PRE-EXISTING jsdom
handlers flake). The module-load census with an empty allowlist over the
whole real tree (`checkHandlerBudgets`, sequential + confirm-alone-only-
when-flagged) names zero violations among the twenty-two on every check
this session, including immediately before this observation - the
sequential amortization the unit-lane guard uses does not expose this
flake; only scenario 01's per-row isolated measurement does, under
today's unusually severe contention.

## Disposition

Not a regression, not part of this parcel's own diff, and this
scenario/those four handlers are this same ticket's (BL-1658's) own
population from its first pass - recording here rather than filing a
separate unowned-red note. Forwarding as-is; QA's own procedure already
runs the feature once (not "N times") and the full unit lane (the
gate that actually governs the merge) is unaffected and green.

By coder.
