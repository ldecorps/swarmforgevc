# BL-1638: acceptance step handler - coder

Following the specifier's ruling (adjudication evidence
`backlog/evidence/BL-1638-spec-gap-register-row-removal-adjudication-specifier-20260921.md`):
`specs/pipeline/steps/bl1638Bl775DeferredMutationGateIsRunSteps.js`
(required_wiring, same commit as the amended feature) drives the real
`hardening_debt_ledger_read.bb`/`standing_red_register_cli.bb` CLIs and
the parcel's own committed evidence files - never a reimplementation.

## Discovered while wiring: the register keys per file_set, not per file

`standing_red_register_cli.bb`'s hardening rows are keyed on the
ledger's own `file_set` CSV string as ONE row (BL-775's two files are one
row, `"...bubbleLiveUiHtml.js,...residentPaneLive.js"`), not one row per
individual file. The handler matches by splitting a row's `file` on `,`
and checking overlap with the scenario's expected file set, rather than
an exact string match against a single path.

## Evidence format alignment

Added explicit `Survivors:`/`Duration:` header lines to
`BL-1638-BL-775-mutation.md` (it already had `Load:`) to match the
established evidence-file convention (`Load:`/`Duration:`/`Survivors:`
lines, same shape as `BL-1638-BL-831-mutation.md` and BL-1488's own
evidence) - content unchanged, just made machine-readable the same way
the sibling row's evidence already is.

## Verification

- `specs/pipeline/scripts/run_acceptance.sh` on the amended feature: 4/4.
- `npx vitest run test/stepHandlerTmpRootGuard.test.js`: 4/4 (handler
  creates no tmp root, so nothing to register).
- `bb swarmforge/scripts/standing_red_register_cli.bb .`: `unowned: []`.
- `bb swarmforge/scripts/effective_backlog_depth_cli.bb .`: `6`
  (unthrottled).
