# BL-1658: bounce fix (D1, D2) — coder

## D1 — BL-687 scenario 06 retired

`specs/features/BL-687-epic-reorder-includes-active-children.feature`:
scenario 06 (`# BL-687 epic-reorder-includes-active-children-06`, "An
epic whose only child is done drills down to the reorderable-topics
empty state") removed - never reworded, superseded by BL-905's hotfix
0f5394a2d0. Its step
(`the drill-down shows "..."` in
`bl687EpicReorderIncludesActiveChildrenSteps.js`) removed with it:
`grep -rn "the drill-down shows" specs/features/` returns nothing after
the retirement, confirming the step is no longer referenced anywhere.

`node specs/pipeline/cli.js specs/features/BL-687-epic-reorder-includes-active-children.feature`:
8/8 pass (scenario 06 absent, was TAP 8).

The standing-red register row (`backlog/standing-reds.tsv` line 40)
stays untouched - per coder.prompt's standing rule (BL-1663, 2026-09-20)
a parcel never edits that file; QA's land retires it (BL-1631). Same
disposition already used for BL-1638 this session.

## D2 — scenario 01 now uses best-of-three

`specs/pipeline/steps/bl1658SevenJsdomHandlersLoadLazilySteps.js`'s "the
cost is under the per-handler budget" step now calls
`confirmAloneMs(ctx.bl1658Row.file)` (best-of-three, `Math.min` of three
fresh-child `censusOneHandler` calls) instead of reading the single
sample the earlier "is required alone" step took - matching scenario
02's own methodology and the production guard's.

`node specs/pipeline/cli.js specs/features/BL-1658-the-seven-remaining-eager-jsdom-handlers-load-it-lazily.feature`
run twice in a row (matching the cleaner's own repro method): 9/9 pass
both times, including all four previously-flaky Examples rows (bl592,
bl674, bl686, bl687).

## Verification

- `node specs/pipeline/cli.js` on both features: green, twice each.
- `npx vitest run test/stepHandlerModuleLoadBudget.test.js` (the
  production gate): 8/8 pass.
- `bb swarmforge/scripts/standing_red_register_cli.bb .`: the BL-687 row
  still present, owned by BL-1658 (untouched, as expected).
